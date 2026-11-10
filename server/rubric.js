import { dimensionHeading, rubricLine } from '../src/rubricSections.js'
export { splitSharedRubric } from '../src/rubricSections.js'

const anchorHeading = /^(positive|negative)(?:\s+(?:standard|evidence|indicators?))?\s*[:：]\s*(.*)$/i
const criterionHeading = /^(?:\d+[.)]\s*)?([\p{L}\p{N}][^:：]{0,79})\s*[:：]$/u
const inlineCriterion = /^(?:\d+[.)]\s*)?([\p{L}\p{N}][^:：]{0,79})\s*[:：]\s*\(\s*\+\s*\)\s*(.+?)\s*[;；]?\s*\(\s*[-−–]\s*\)\s*(.+)$/u

export function rubricPreamble(prompt) {
  const lines = prompt.split(/\r\n?|\n|\f/)
  const start = lines.findIndex(line => dimensionHeading.test(rubricLine(line)))
  return lines.slice(0, start < 0 ? lines.length : start).join('\n').trim()
}

export function readRubricCriteria(prompt, dimensionId) {
  const criteria = dimensionId ? { [dimensionId]: [] } : { aesthetic: [], creativity: [], expectation: [] }
  if (typeof prompt !== 'string') return criteria

  const lines = prompt.split(/\r\n?|\n|\f/).map(rubricLine).filter(Boolean)
  const incomplete = new Set()
  let dimension = dimensionId
  let criterion
  let anchor

  function finishCriterion() {
    if (!criterion) return
    if (criterion.positive && criterion.negative) {
      criteria[dimension].push(criterion)
    } else {
      incomplete.add(dimension)
    }
    criterion = undefined
    anchor = undefined
  }

  for (const [index, line] of lines.entries()) {
    const heading = !dimensionId && line.match(dimensionHeading)
    if (heading) {
      finishCriterion()
      dimension = heading[1].toLowerCase().replace(/^aesthetics$/, 'aesthetic')
      continue
    }
    if (!dimension) continue

    const inline = line.match(inlineCriterion)
    if (inline) {
      finishCriterion()
      const [, name, positive, negative] = inline
      criteria[dimension].push({ name: name.trim(), positive: positive.trim(), negative: negative.trim() })
      continue
    }

    const marker = line.match(anchorHeading)
    if (marker) {
      if (criterion) {
        anchor = marker[1].toLowerCase()
        criterion[anchor] = marker[2]
      }
      continue
    }

    const label = line.match(criterionHeading)
    if (label) {
      finishCriterion()
      if (anchorHeading.test(lines[index + 1] ?? '')) {
        criterion = { name: label[1].trim(), positive: '', negative: '' }
      }
    } else if (anchor) {
      const separator = criterion[anchor] && !/^["”]$/.test(line) ? ' ' : ''
      criterion[anchor] += separator + line
    }
  }

  finishCriterion()
  for (const dimension of incomplete) criteria[dimension] = []
  return criteria
}

export function dimensionPreamble(prompt) {
  const lines = prompt.split(/\r\n?|\n|\f/)
  const start = lines.findIndex((line, index) => inlineCriterion.test(rubricLine(line)) ||
    (criterionHeading.test(rubricLine(line)) &&
      anchorHeading.test(rubricLine(lines.slice(index + 1).find(next => next.trim()) ?? ''))))
  return lines.slice(0, start < 0 ? lines.length : start).join('\n').trim()
}
