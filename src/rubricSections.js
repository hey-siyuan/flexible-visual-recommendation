export const dimensionHeading = /^(?:\d+[.)]\s*)?(aesthetics?|creativity|expectation)\s*(?:\([^)]*\))?\s*[:：]?$/i

export function rubricLine(line) {
  return line.trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[●○•◦▪‣]\s*|[-*](?:\s+|$))/, '')
    .replace(/\*\*/g, '')
    .trim()
}

export function splitSharedRubric(prompt, dimensions) {
  const idsByName = new Map(dimensions.map(({ id, name }) => [name.trim().toLowerCase(), id]))
  const sections = new Map()
  const preamble = []
  let current = preamble
  for (const raw of prompt.split(/\r\n?|\n|\f/)) {
    const line = rubricLine(raw).replace(/^\d+[.)]\s*/, '').replace(/[:：]$/, '').trim()
    const standard = line.match(dimensionHeading)
    const id = /^\s*#{1,2}\s+/.test(raw) ? idsByName.get(line.toLowerCase()) : undefined
    const standardId = standard && (idsByName.get(standard[1].toLowerCase()) ?? idsByName.get(`${standard[1].toLowerCase()}s`))
    if (id || standardId) {
      current = sections.get(id || standardId) ?? []
      sections.set(id || standardId, current)
    } else {
      current.push(raw)
    }
  }
  return new Map([...sections].filter(([, lines]) => lines.some(line => line.trim()))
    .map(([id, lines]) => [id, [...preamble, '', ...lines].join('\n').trim()]))
}
