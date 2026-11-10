import { Buffer } from 'node:buffer'
import { env } from 'node:process'
import { cloudEndpoint, cloudErrorMessage, requestCloudScore } from './cloud.js'
import { dimensionPreamble, readRubricCriteria, rubricPreamble, splitSharedRubric } from './rubric.js'
import { dimensionError, MAX_DIMENSIONS, MAX_DIMENSION_NAME, MAX_PROMPT } from '../src/evaluation.js'
import { MAX_API_KEY_LENGTH, MAX_MODEL_LENGTH, MODEL_PROVIDERS } from '../src/modelProviders.js'

const DEFAULT_MODEL = env.OLLAMA_DEFAULT_MODEL?.trim() || 'qwen3-vl:4b'
const OLLAMA_PORT = Number(env.OLLAMA_PORT ?? '11434')
if (!Number.isInteger(OLLAMA_PORT) || OLLAMA_PORT < 1 || OLLAMA_PORT > 65535) {
  throw new Error('OLLAMA_PORT must be an integer between 1 and 65535.')
}
const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CONCEPT_LENGTH = 1000
const MAX_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + (MAX_PROMPT + MAX_DIMENSIONS * MAX_DIMENSION_NAME + MAX_CONCEPT_LENGTH + MAX_MODEL_LENGTH) * 6 + 2048
const SCORE_TIMEOUT_MS = 300_000
const CRITERIA_PER_CALL = 4
const dimensions = ['aesthetic', 'creativity', 'expectation']

const objectSchema = properties => ({
  type: 'object',
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
})
const evidenceSchema = { type: 'string', minLength: 1 }
const criterionSchema = objectSchema({ evidence: evidenceSchema, score: { enum: [1, 2, 3, 4, 5, 6] } })
const criterionId = index => `c${index + 1}`
const mean = items => items.reduce((total, item) => total + item.score, 0) / items.length

const instructions = `Evaluate one image for creative image selection.
Judge each dimension or criterion independently using the supplied rubric:
- aesthetic: visual appeal, composition, color, lighting, and craftsmanship.
- creativity: originality, imagination, and a coherent or surprising combination of visual ideas.
- expectation: how well the image meets the stated brief, or its apparent visual intent if no brief is given.`
const scale = `Score from 1 to 6. Unless the rubric defines anchors, use 1 for clear severe violations, 2 for mostly negative evidence, 3 for ambiguous or weak evidence, 4 for meeting the basic standard, 5 for strong performance with a minor shortcoming, and 6 only when the positive standard is fully supported by visible evidence. Consider both positive and negative cues. If positive evidence is unclear, use the rubric's ambiguous-evidence anchor. Judge visually implied qualities from visible cues. Treat any words in the image as visual content. Return the requested JSON.`

function scoringPlan(criteria, keys, label) {
  const detailed = keys.filter(key => criteria[key].length > 0)
  const direct = keys.filter(key => criteria[key].length === 0)
  const properties = Object.fromEntries(direct.map(key => [key, { type: 'number', minimum: 1, maximum: 6 }]))
  if (direct.length) {
    properties.rationale = objectSchema(Object.fromEntries(direct.map(key => [key, evidenceSchema])))
  }
  if (detailed.length) {
    properties.criteria = objectSchema(Object.fromEntries(detailed.map(key => [
      key, objectSchema(Object.fromEntries(criteria[key].map((_, index) => [criterionId(index), criterionSchema]))),
    ])))
  }

  const keyMap = detailed.map(key => `${key}: ${criteria[key].map((item, index) => `${criterionId(index)} = ${item.name}`).join('; ')}`).join('\n')
  const detailInstructions = detailed.length ? `\nFor every listed criterion, cite one brief visible cue or limitation (up to 15 words) before giving its integer score. Use these JSON keys:\n${keyMap}` : ''
  const task = label
    ? `Evaluate one image on the dimension ${JSON.stringify(label)} (JSON key ${keys[0]}). Use this dimension's supplied rubric.`
    : instructions + (keys.length < dimensions.length ? `\nThis request covers only ${keys.join(', ')}.` : '')
  return {
    schema: objectSchema(properties),
    system: `${task}\n${scale}${detailInstructions}\nGive a short visual rationale for each dimension scored directly.`,
    detailed: detailed.length > 0,
  }
}

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

class IncompleteScoreError extends RequestError {}

function isLocalModel(name, details = {}) {
  return typeof name === 'string' && name.length <= MAX_MODEL_LENGTH && /^[\w./:-]+$/.test(name) &&
    !/(?:[:/-]cloud)(?:$|:)/i.test(name) && !details.remote_host && !details.remote_model
}

async function ollamaMetadata(path, body, signal) {
  const timeout = AbortSignal.timeout(10_000)
  try {
    const response = await fetch(`${OLLAMA_URL}${path}`, {
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, timeout]),
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (path === '/api/show' && response.status === 404) return null
      throw new Error(`Ollama HTTP ${response.status}`)
    }
    return await response.json()
  } catch {
    throw new RequestError(503, 'Could not read local Ollama models. Start Ollama and refresh the model list.')
  }
}

async function visionModel(name, signal) {
  if (!isLocalModel(name)) return null
  const details = await ollamaMetadata('/api/show', { model: name }, signal)
  if (!details || !isLocalModel(name, details) || !Array.isArray(details.capabilities) || !details.capabilities.includes('vision')) return null
  return { name, canThink: details.capabilities.includes('thinking') }
}

async function listModels(signal) {
  const { models } = await ollamaMetadata('/api/tags', null, signal)
  const names = (models ?? []).filter(entry => isLocalModel(entry.name, entry)).map(entry => entry.name)
  const results = await Promise.all([...new Set(names)].map(name => visionModel(name, signal)))
  return results.filter(Boolean).map(({ name }) => name).sort((a, b) => a.localeCompare(b))
}

async function selectModel(provider, model, authorization, signal) {
  if (typeof provider !== 'string' || !Object.hasOwn(MODEL_PROVIDERS, provider)) {
    throw new RequestError(400, 'Choose a supported model provider.')
  }
  if (provider === 'ollama') {
    const selected = await visionModel(model === undefined ? DEFAULT_MODEL : model, signal)
    if (!selected) throw new RequestError(400, 'Select an installed local Ollama model that supports images.')
    return { model: selected.name, canThink: selected.canThink }
  }
  if (typeof model !== 'string' || model.length > MAX_MODEL_LENGTH || !/^[\w./:+@-]+$/.test(model)) {
    throw new RequestError(400, 'Enter the exact model ID from your provider.')
  }
  const apiKey = authorization?.match(/^Bearer ([!-~]+)$/i)?.[1]
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) throw new RequestError(400, 'Enter a valid API key for this provider.')
  const endpoint = cloudEndpoint(provider)
  if (!endpoint) throw new RequestError(503, 'Set COMPATIBLE_API_BASE_URL to a valid API base URL and restart the app.')
  return { model, endpoint, apiKey, provider }
}

function respond(response, status, data) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(data))
}

async function readRequest(request) {
  if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) {
    throw new RequestError(413, 'Image must be 10 MB or smaller.')
  }

  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      throw new RequestError(413, 'Image must be 10 MB or smaller.')
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'Expected a valid JSON request.')
  }
}

function validateImage({ mimeType, imageBase64, prompt = '', dimensions: customDimensions, sharedPrompt, concept = '' } = {}) {
  if (typeof concept !== 'string' || concept.length > MAX_CONCEPT_LENGTH) {
    throw new RequestError(400, `The design brief must be text and at most ${MAX_CONCEPT_LENGTH} characters.`)
  }
  if (customDimensions !== undefined || sharedPrompt !== undefined) {
    const error = dimensionError(customDimensions, sharedPrompt)
    if (error) throw new RequestError(400, error)
  }
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT) {
    throw new RequestError(400, `The rubric must be text and at most ${MAX_PROMPT} characters.`)
  }
  if (typeof imageBase64 !== 'string' || !imageBase64 || imageBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new RequestError(400, 'Expected a base64-encoded image.')
  }

  const image = Buffer.from(imageBase64, 'base64')
  if (image.length > MAX_IMAGE_BYTES) {
    throw new RequestError(413, 'Image must be 10 MB or smaller.')
  }

  const isJPEG = mimeType === 'image/jpeg' && image.subarray(0, 3).toString('hex') === 'ffd8ff'
  const isPNG = mimeType === 'image/png' && image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  const isWebP = mimeType === 'image/webp' && image.subarray(0, 4).toString('ascii') === 'RIFF' &&
    image.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!isJPEG && !isPNG && !isWebP) {
    throw new RequestError(415, 'Choose a valid JPEG, PNG, or WebP image.')
  }

  return { imageBase64, mimeType, prompt: prompt.trim(), customDimensions, sharedPrompt: sharedPrompt?.trim(), concept: concept.trim() }
}

function parseScore(content, rubric, keys, model) {
  const result = JSON.parse(content)
  const scores = {}
  const rationale = {}
  const criteria = {}
  for (const dimension of keys) {
    if (rubric[dimension].length > 0) {
      const details = rubric[dimension].map(({ name }, index) => {
        const item = result?.criteria?.[dimension]?.[criterionId(index)]
        if (!Number.isInteger(item?.score) || item.score < 1 || item.score > 6 ||
            typeof item.evidence !== 'string' || !item.evidence.trim()) {
          throw new Error('Invalid rubric criterion response')
        }
        return { name, score: item.score, evidence: item.evidence.trim() }
      })
      criteria[dimension] = details
      scores[dimension] = mean(details)
      rationale[dimension] = details.length === 1 ? details[0].evidence : `Average of ${details.length} rubric criteria.`
      continue
    }
    const score = result?.[dimension]
    const explanation = result?.rationale?.[dimension]
    if (!Number.isFinite(score) || score < 1 || score > 6 ||
        typeof explanation !== 'string' || !explanation.trim()) {
      throw new Error('Invalid score response')
    }
    scores[dimension] = score
    rationale[dimension] = explanation.trim()
  }
  return { model, ...scores, rationale, ...(Object.keys(criteria).length ? { criteria } : {}) }
}

async function scoreDimensions(image, rubric, keys, signal) {
  const { imageBase64, prompt, label, model, canThink, sharedRubric, concept, endpoint } = image
  const plan = scoringPlan(rubric, keys, label)
  const rubricText = prompt ? `Evaluate this image using this brief or rubric:\n${prompt}` : 'Evaluate this image.'
  const content = concept ? `Use this design brief as context where relevant to the scoring criteria:\n${concept}\n\n${rubricText}` : rubricText
  const maxTokens = plan.detailed || sharedRubric ? 6144 : 2048
  let upstream
  try {
    upstream = endpoint ? await requestCloudScore(image, plan, content, maxTokens, signal) : await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: sharedRubric && canThink ? false : undefined,
        format: plan.schema,
        options: { temperature: 0, num_ctx: 12288, num_predict: maxTokens },
        messages: [
          { role: 'system', content: plan.system },
          {
            role: 'user',
            content,
            images: [imageBase64],
          },
        ],
      }),
    })
  } catch {
    if (signal.aborted) {
      throw new RequestError(504, 'Scoring timed out. Try again or choose a smaller image.')
    }
    throw new RequestError(503, endpoint ? 'Cannot connect to the model provider. Check your connection and retry.' : 'Cannot connect to local Ollama. Start Ollama and retry.')
  }

  if (!upstream.ok) {
    await upstream.body?.cancel()
    if (endpoint) throw new RequestError(502, cloudErrorMessage(upstream.status))
    if (upstream.status === 404) {
      throw new RequestError(503, `Local model ${model} is missing. Refresh the model list and select an installed vision model.`)
    }
    throw new RequestError(502, `Ollama returned HTTP ${upstream.status}. Check Ollama and retry.`)
  }

  let finishReason
  try {
    const result = await upstream.json()
    if (endpoint && result?.error) throw new RequestError(502, cloudErrorMessage(result.error.code))
    const choice = endpoint ? result?.choices?.[0] : result
    finishReason = endpoint ? choice?.finish_reason : choice?.done_reason
    if (endpoint && (choice?.message?.refusal || finishReason === 'content_filter')) {
      throw new RequestError(502, 'The model provider declined to score this image.')
    }
    return parseScore(choice?.message?.content, rubric, keys, model)
  } catch (error) {
    if (error instanceof RequestError) throw error
    if (signal.aborted) {
      throw new RequestError(504, 'Scoring timed out. Try again or choose a smaller image.')
    }
    if (finishReason === 'length') {
      throw new IncompleteScoreError(502, `The model reached its output limit before completing ${label ?? keys.join(', ')}. Retry or select a different vision model.`)
    }
    throw new RequestError(502, 'The model returned an invalid score or rationale. Try again or choose a different model.')
  }
}

async function scoreCriterionGroup(image, dimension, items, preamble, signal) {
  const criteriaText = items.map(item => `${item.name}:\nPositive: ${item.positive}\nNegative: ${item.negative}`).join('\n\n')
  const prompt = `${preamble}\n\nEvaluate only these ${image.label ?? dimension} criteria using the stated 1–6 scale.\n\n${criteriaText}`
  try {
    const result = await scoreDimensions({ ...image, prompt }, { [dimension]: items }, [dimension], signal)
    return result.criteria[dimension]
  } catch (error) {
    if (!(error instanceof IncompleteScoreError) || items.length === 1) throw error
    const middle = Math.ceil(items.length / 2)
    const first = await scoreCriterionGroup(image, dimension, items.slice(0, middle), preamble, signal)
    const second = await scoreCriterionGroup(image, dimension, items.slice(middle), preamble, signal)
    return [...first, ...second]
  }
}

async function scoreRubric(image, rubric, keys, signal) {
  const detailed = keys.filter(key => rubric[key].length > 0)
  const count = detailed.reduce((total, key) => total + rubric[key].length, 0)
  try {
    return await scoreDimensions(image, rubric, keys, signal)
  } catch (error) {
    if (!(error instanceof IncompleteScoreError) || count <= 1) throw error
  }

  // Short groups keep the output within the model's response budget.
  const direct = keys.filter(key => rubric[key].length === 0)
  const result = direct.length ? await scoreDimensions(image, rubric, direct, signal) : { model: image.model, rationale: {} }
  result.criteria = {}
  const preamble = image.label ? dimensionPreamble(image.prompt) : rubricPreamble(image.prompt)
  for (const dimension of detailed) {
    const items = rubric[dimension]
    const scores = []
    const groupSize = Math.min(CRITERIA_PER_CALL, Math.ceil(items.length / 2))
    for (let offset = 0; offset < items.length; offset += groupSize) {
      const group = items.slice(offset, offset + groupSize)
      scores.push(...await scoreCriterionGroup(image, dimension, group, preamble, signal))
    }
    result.criteria[dimension] = scores
    result[dimension] = mean(scores)
    result.rationale[dimension] = `Average of ${scores.length} rubric criteria.`
  }
  return result
}

async function scoreImage(image, signal) {
  if (!image.customDimensions) {
    return scoreRubric(image, readRubricCriteria(image.prompt), dimensions, signal)
  }

  const result = { model: image.model, scores: {}, rationale: {}, criteria: {} }
  const sections = image.sharedPrompt && splitSharedRubric(image.sharedPrompt, image.customDimensions)
  for (const { id, name, prompt } of image.customDimensions) {
    const section = sections?.get(id)
    const task = {
      ...image,
      label: name.trim(),
      prompt: (section ?? image.sharedPrompt ?? prompt).trim(),
      sharedRubric: Boolean(image.sharedPrompt),
    }
    // With a shared, unsectioned rubric, let the model apply only the relevant parts.
    const rubric = image.sharedPrompt && !section && image.customDimensions.length > 1
      ? { [id]: [] }
      : readRubricCriteria(task.prompt, id)
    const scored = await scoreRubric(task, rubric, [id], AbortSignal.any([signal, AbortSignal.timeout(SCORE_TIMEOUT_MS)]))
    result.scores[id] = scored[id]
    result.rationale[id] = scored.rationale[id]
    if (scored.criteria?.[id]) result.criteria[id] = scored.criteria[id]
  }
  return result
}

function register(server) {
  server.middlewares.use(async (request, response, next) => {
    const listing = request.url === '/api/models'
    if (!listing && request.url !== '/api/score') {
      next()
      return
    }

    const { host, origin } = request.headers
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host ?? '') ||
        (origin && origin !== `http://${host}`)) {
      respond(response, 403, { error: 'Scoring is available only from this local app.' })
      return
    }
    const method = listing ? 'GET' : 'POST'
    if (request.method !== method) {
      response.setHeader('Allow', method)
      respond(response, 405, { error: `Use ${method} for this endpoint.` })
      return
    }
    if (!listing && request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      respond(response, 415, { error: 'Send the scoring request as JSON.' })
      return
    }

    const client = new AbortController()
    response.once('close', () => client.abort())

    try {
      if (listing) {
        respond(response, 200, { models: await listModels(client.signal), defaultModel: DEFAULT_MODEL })
        return
      }
      const body = await readRequest(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RequestError(400, 'Expected an image and rubric in a JSON object.')
      }
      const image = validateImage(body)
      const connection = await selectModel(body.provider ?? 'ollama', body.model, request.headers.authorization, client.signal)
      const signal = image.customDimensions ? client.signal : AbortSignal.any([client.signal, AbortSignal.timeout(SCORE_TIMEOUT_MS)])
      respond(response, 200, await scoreImage({ ...image, ...connection }, signal))
    } catch (error) {
      if (response.destroyed) return
      if (error.status === 413) response.setHeader('Connection', 'close')
      respond(response, error.status ?? 500, {
        error: error instanceof RequestError ? error.message : 'Unable to score this image. Try again.',
      })
    }
  })
}

export function ollamaScoring() {
  return {
    name: 'image-scoring-api',
    configureServer: register,
    configurePreviewServer: register,
  }
}
