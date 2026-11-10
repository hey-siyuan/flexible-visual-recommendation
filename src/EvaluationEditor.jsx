import { MAX_DIMENSIONS, MAX_DIMENSION_NAME, MAX_PROMPT } from './evaluation.js';

const fieldClass = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-[#6D5CE8] focus:outline-none';

export default function EvaluationEditor({ dimensions, onDimensions, axisId, onAxis, error, disabled }) {
  function edit(id, field, value) {
    onDimensions(dimensions.map(dimension => dimension.id === id ? { ...dimension, [field]: value } : dimension));
  }

  const dimensionFields = (
    <div className="space-y-1.5">
      {dimensions.map(({ id, name, prompt: text }, index) => (
        <details key={id} open={dimensions.length === 1 || id.startsWith('d-')} className="rounded-lg border border-gray-200 px-2.5 py-1.5">
          <summary className="cursor-pointer break-words text-sm font-medium">{name.trim() || `Dimension ${index + 1}`}</summary>
          <div className="mt-2 space-y-2">
            <label className="block space-y-1 text-xs text-gray-700">
              <span>Dimension {index + 1} name</span>
              <input className={fieldClass} value={name} maxLength={MAX_DIMENSION_NAME} onChange={event => edit(id, 'name', event.target.value)} />
            </label>
            <label className="block space-y-1 text-xs text-gray-700">
              <span>Dimension {index + 1} prompt</span>
              <textarea className={`${fieldClass} h-24 resize-y`} value={text} onChange={event => edit(id, 'prompt', event.target.value)} />
            </label>
            <button type="button" className="text-xs text-red-700 underline disabled:opacity-40" disabled={dimensions.length === 1} onClick={() => onDimensions(dimensions.filter(dimension => dimension.id !== id))}>
              Remove dimension
            </button>
          </div>
        </details>
      ))}
      <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-[#5848cd] disabled:opacity-40" disabled={dimensions.length >= MAX_DIMENSIONS} onClick={() => onDimensions([...dimensions, { id: `d-${crypto.randomUUID()}`, name: '', prompt: '' }])}>
        + Add dimension
      </button>
    </div>
  );

  return (
    <fieldset className="min-w-0 space-y-2 disabled:opacity-70" disabled={disabled}>
      <legend className="font-semibold">1. Scoring dimensions</legend>
      {dimensionFields}
      {dimensions.length > 1 && <label className="block space-y-1 text-xs text-gray-700">
        <span>Horizontal axis for next evaluation</span>
        <select className={fieldClass} value={axisId} onChange={event => onAxis(event.target.value)}>
          {dimensions.map(({ id, name }, index) => <option key={id} value={id}>{name.trim() || `Dimension ${index + 1}`}</option>)}
        </select>
      </label>}
      <p className="text-xs text-gray-500">{dimensions.reduce((sum, dimension) => sum + dimension.prompt.length, 0).toLocaleString()} / {MAX_PROMPT.toLocaleString()} characters</p>
      {error && <p role="status" className="text-xs text-red-700">{error}</p>}
    </fieldset>
  );
}
