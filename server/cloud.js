import { env } from 'node:process'

export function cloudEndpoint(provider) {
  if (provider === 'openai') return 'https://api.openai.com/v1/chat/completions'
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions'
  if (provider !== 'compatible') return null

  const base = URL.parse(env.COMPATIBLE_API_BASE_URL ?? '')
  if (!base || base.username || base.password || base.search || base.hash) return null
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) return null
  base.pathname = base.pathname.replace(/\/+$/, '') + '/chat/completions'
  return base.href
}

export function requestCloudScore({ endpoint, provider, apiKey, model, mimeType, imageBase64 }, plan, content, maxTokens, signal) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    redirect: 'error',
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      ...(provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(provider === 'openrouter' && { provider: { require_parameters: true } }),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${plan.system}\nReturn a JSON object matching this schema:\n${JSON.stringify(plan.schema)}` },
        { role: 'user', content: [
          { type: 'text', text: content },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ] },
      ],
    }),
  })
}

export function cloudErrorMessage(status) {
  switch (status) {
    case 400:
    case 422: return 'The provider rejected the request. Check that the model supports image inputs and JSON mode.'
    case 401:
    case 403: return 'The provider denied access. Check your API key and model permissions.'
    case 402: return 'The provider requires more credit for this request.'
    case 404: return 'The model or endpoint was not found. Check the model ID and provider settings.'
    case 429: return 'The provider rate limit or quota was reached. Check your account or retry later.'
    default: return 'The model provider could not complete the request. Try again.'
  }
}
