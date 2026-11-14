import { BookOpen, X } from 'lucide-react';
import { MODEL_PROVIDERS } from './modelProviders.js';

export default function ScoringRules({ dialogRef, settings, dimensions, axis, batch, concept, onConcept, running }) {
  const rubric = batch ?? settings;
  const sharedPrompt = rubric.sharedPrompt ?? rubric.prompt;

  return (
    <dialog ref={dialogRef} aria-labelledby="rules-title" className="glass-surface rules-dialog m-auto max-h-[86dvh] overflow-y-auto rounded-3xl text-slate-800">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/90 bg-white/95 px-5 py-4">
        <span className="workspace-icon"><BookOpen size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="rules-title" className="font-semibold">Scoring rules</h2>
          <p className="text-xs text-slate-600">{batch ? 'Rubric used for this batch' : 'Setup for the next batch'}</p>
        </div>
        <form method="dialog"><button type="submit" className="rounded-lg p-2 hover:bg-violet-50" aria-label="Close scoring rules"><X size={19} /></button></form>
      </div>
      <div className="space-y-5 p-5">
        <section aria-label="Image concept">
          <label className="block space-y-1.5">
            <span className="block font-semibold">{batch ? 'Image concept for the next batch' : 'Image concept'}</span>
            <textarea value={concept} onChange={event => onConcept(event.target.value)} maxLength={1000} disabled={running} rows={2} placeholder="What should these images communicate? Add the subject, audience, or design goal." className="w-full resize-y rounded-xl border border-violet-200 bg-white/90 px-3 py-2 text-sm" />
          </label>
          {batch && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">Concept used for this batch: {batch.concept || 'No concept supplied'}</p>}
        </section>
        <section className="rounded-2xl border border-white bg-white/65 p-4" aria-label="Score calculation">
          <h3 className="font-semibold">How scores are calculated</h3>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {rubric.model && <li>Model: {rubric.model} · {MODEL_PROVIDERS[rubric.provider ?? 'ollama']}.</li>}
            <li>{dimensions.length} {dimensions.length === 1 ? 'dimension' : 'dimensions'} · Scale from 1 to 6.</li>
            <li>When a dimension has scored criteria, add their scores and divide by the number of criteria. Each criterion counts equally.</li>
            <li>For a dimension without scored criteria, the model gives one score and a visual rationale.</li>
            <li>{axis.name || 'The selected dimension'} determines horizontal position, card size, and rank. Each additional point adds the same amount to the card’s side length.</li>
            <li>Results automatically fit the available canvas after scoring, switching the axis, or resizing the window. Use Fit all to return to the complete overview after zooming or panning.</li>
            <li>Overlapping thumbnails cover at most 25% of any thumbnail's square area in total. Hovered and selected images enlarge toward the largest thumbnail size, with enlargement limited when needed to retain that visibility.</li>
            <li>The hovered, keyboard-focused, or inspected image is temporarily foremost. Selected images appear above ordinary images. Within each persistent group, a higher sum across all dimensions appears in front; ending inspection or deselecting restores the corresponding group.</li>
          </ul>
        </section>
        <section aria-label="Rubric details" className="space-y-2">
          <h3 className="font-semibold">Rubric details</h3>
          {sharedPrompt !== undefined ? (
            <details className="rounded-xl border border-white bg-white/65 p-3">
              <summary className="cursor-pointer font-medium">Shared rubric</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{sharedPrompt || 'Add a shared rubric in the scoring setup.'}</p>
            </details>
          ) : dimensions.map((dimension, index) => (
            <details key={dimension.id} className="rounded-xl border border-white bg-white/65 p-3">
              <summary className="cursor-pointer break-words font-medium">{dimension.name || `Dimension ${index + 1}`}</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{dimension.prompt || 'Add a prompt in the scoring setup.'}</p>
            </details>
          ))}
          {sharedPrompt !== undefined && <p className="break-words text-sm text-slate-700">{dimensions.map((dimension, index) => dimension.name || `Dimension ${index + 1}`).join(' · ')}</p>}
        </section>
      </div>
    </dialog>
  );
}
