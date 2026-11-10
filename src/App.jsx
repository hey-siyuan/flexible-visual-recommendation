import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { BookOpen, CheckCircle2, Download, Image as ImageIcon, Minus, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import EvaluationEditor from './EvaluationEditor.jsx';
import ScoringRules from './ScoringRules.jsx';
import { DEFAULT_DIMENSIONS, dimensionError } from './evaluation.js';
import { MAX_API_KEY_LENGTH, MAX_MODEL_LENGTH, MODEL_PROVIDERS } from './modelProviders.js';
import { getCardSides, layoutScoredImages } from './scoreLayout.js';
import { MAX_ZOOM, MIN_ZOOM, useCanvasZoom } from './useCanvasZoom.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TICKS = [1, 2, 3, 4, 5, 6];
const CONCEPT_STORAGE_KEY = 'visual-review.concept';
const MODEL_FIELD_CLASS = 'min-w-0 rounded-lg border border-violet-100 bg-white/80 px-2 py-1 text-sm';

async function readImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { imageBase64: dataUrl.split(',')[1], hash };
}

async function scoreImage(entry, settings, apiKey) {
  const { imageBase64, hash } = await readImage(entry.file);
  const response = await fetch('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify({ mimeType: entry.file.type, imageBase64, ...settings }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error || 'Could not reach the local scoring API.');
  }
  return {
    ...result,
    id: `${hash}-${entry.index}`,
    index: entry.index,
    fileName: entry.file.name,
    url: entry.url,
  };
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'visual-evaluation.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RadarLabel({ x, y, textAnchor, payload }) {
  return <text x={x} y={y + (textAnchor === 'middle' ? 0 : 6)} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="#475569">{payload.value}</text>;
}

function ScoreSummary({ image, dimensions }) {
  const showRadar = dimensions.length >= 3;
  const useNumbers = dimensions.length > 3 || dimensions.some(({ name }) => name.length > 12);
  const scores = dimensions.map(({ id, name }, index) => ({
    id, name, label: useNumbers ? String(index + 1) : name, score: image.scores?.[id] ?? image[id],
  }));

  return (
    <div className={showRadar ? 'grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] items-center gap-2' : ''}>
      {showRadar && (
        <div role="img" aria-label="Radar chart of dimension scores on a six-point scale" className="profile-radar min-w-0">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
            <RadarChart data={scores} outerRadius="56%" accessibilityLayer={false}>
              <PolarGrid stroke="#d9d2eb" />
              <PolarAngleAxis dataKey="label" tick={<RadarLabel />} />
              <PolarRadiusAxis domain={[0, 6]} ticks={[1, 2, 3, 4, 5, 6]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="#6D5CE8" strokeWidth={1.6} fill="#6D5CE8" fillOpacity={0.24} isAnimationActive={false} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
      <dl aria-label="Dimension scores" className={`space-y-1.5 text-xs text-slate-700 ${showRadar ? 'border-l border-violet-100 pl-3' : ''}`}>
        {scores.map(({ id, name, label, score }) => (
          <div key={id}>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="min-w-0 break-words">{showRadar && useNumbers && `${label}. `}{name}</dt>
              <dd className="shrink-0 font-bold tabular-nums text-slate-900">{score.toFixed(2)} / 6</dd>
            </div>
            {!showRadar && <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-[#6D5CE8]" style={{ width: `${score / 6 * 100}%` }} /></div>}
          </div>
        ))}
      </dl>
    </div>
  );
}

function ScoreDetails({ image, dimensions, axis, total }) {
  return (
    <div className="space-y-3">
      <ScoreSummary image={image} dimensions={dimensions} />
      <div className="space-y-1 rounded-xl border border-violet-100 bg-white/75 px-3 py-2">
        <p className="break-words text-sm font-semibold text-gray-800">Rank by {axis.name}: <span className="text-violet-800">{image.tied ? 'tied ' : ''}{image.rank} / {total}</span></p>
        {image.tied && dimensions.length > 1 && <p className="text-xs text-slate-600">Other dimensions total: {image.secondaryTotal.toFixed(2)} · Stacking order</p>}
      </div>
      <details className="rounded-xl border border-violet-100 bg-white/75 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-violet-900">Scoring rationale</summary>
        <dl className="mt-3 space-y-3">
          {dimensions.map(({ id: key, name }) => (
            <div key={key} className="rounded-lg bg-gray-50 p-3">
              <dt className="flex justify-between gap-3 text-sm font-semibold">
                <span className="min-w-0 break-words">{name}</span><span className="shrink-0 tabular-nums">{(image.scores?.[key] ?? image[key]).toFixed(2)} / 6</span>
              </dt>
              <dd className="mt-1 break-words text-sm text-gray-700">
                {image.criteria?.[key]?.length ? (
                  <div>
                    <p className="text-[#5848cd]">{image.criteria[key].length === 1 ? 'Criterion score' : `Average of ${image.criteria[key].length} criteria`}</p>
                    <ul className="mt-2 space-y-2">
                      {image.criteria[key].map((criterion, index) => (
                        <li key={index} className="border-t pt-2">
                          <div className="flex justify-between gap-2 font-medium">
                            <span>{criterion.name}</span><span className="shrink-0">{criterion.score} / 6</span>
                          </div>
                          <p>{criterion.evidence}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="whitespace-pre-wrap">{image.rationale[key]}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function positionScoringProfile(panel, anchor, canvas, expandedSide) {
  const margin = 12;
  const gap = 14;
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const x = anchor.left + anchor.width / 2;
  const y = anchor.top + anchor.height / 2;
  const leftEdge = x - expandedSide / 2 - gap;
  const rightEdge = x + expandedSide / 2 + gap;
  const leftRoom = leftEdge - Math.max(margin, canvas.left + margin);
  const rightRoom = width - margin - rightEdge;
  const useLeft = leftRoom > rightRoom;
  const sideRoom = Math.max(leftRoom, rightRoom);

  if (sideRoom >= 310 || leftEdge - margin >= 310) {
    const placeLeft = useLeft || sideRoom < 310;
    const panelWidth = Math.min(420, placeLeft ? Math.max(leftRoom, leftEdge - margin) : rightRoom);
    const top = Math.max(margin, Math.min(y - 145, height - 440 - margin));
    Object.assign(panel.style, { width: `${panelWidth}px`, left: `${placeLeft ? leftEdge - panelWidth : rightEdge}px`, top: `${top}px`, maxHeight: `${height - top - margin}px` });
    return;
  }

  const panelWidth = Math.min(420, width - 2 * margin);
  const left = Math.max(margin, Math.min(x - panelWidth / 2, width - panelWidth - margin));
  const below = y + expandedSide / 2 + gap;
  const above = y - expandedSide / 2 - gap;
  const belowRoom = height - margin - below;
  const aboveRoom = above - margin;
  const placeAbove = aboveRoom > belowRoom;
  const verticalRoom = Math.max(aboveRoom, belowRoom);
  const maxHeight = verticalRoom >= 350 ? verticalRoom : Math.min(430, height - 2 * margin);
  const top = verticalRoom < 350 ? (placeAbove ? margin : height - maxHeight - margin) : placeAbove ? above - maxHeight : below;
  Object.assign(panel.style, { width: `${panelWidth}px`, left: `${left}px`, top: `${top}px`, maxHeight: `${maxHeight}px` });
}

function ScoringProfile({ image, dimensions, axis, total, marked, onClose, onMark, anchor, canvasRef, expandedSide }) {
  const panel = useRef(null);
  const closeButton = useRef(null);

  useLayoutEffect(() => {
    const element = panel.current;
    const canvas = canvasRef.current;
    const update = () => positionScoringProfile(element, anchor.getBoundingClientRect(), canvas.getBoundingClientRect(), expandedSide);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchor, canvasRef, expandedSide, image]);

  useEffect(() => {
    closeButton.current.focus({ preventScroll: true });
  }, []);

  return (
    <aside id="scoring-profile" ref={panel} role="dialog" aria-labelledby="scoring-profile-title" className="glass-surface fixed z-30 flex min-w-0 flex-col overflow-hidden rounded-3xl text-slate-800">
          <div className="flex items-center gap-3 border-b px-4 py-3 md:px-5">
            <div className="min-w-0 flex-1">
              <h2 id="scoring-profile-title" className="font-bold text-[#6D5CE8]">AI Scoring Profile</h2>
              <p className="truncate text-xs text-gray-500" title={image.fileName}>{image.fileName}</p>
            </div>
            <button ref={closeButton} type="button" onClick={onClose} aria-label="Close scoring profile" className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100"><X size={18} /></button>
          </div>
          <div className="profile-content min-h-0 overflow-y-auto overscroll-contain px-4 py-3 md:px-5">
            <ScoreDetails image={image} dimensions={dimensions} axis={axis} total={total} />
          </div>
          <div className="flex shrink-0 justify-end border-t px-4 py-3">
            <button
              type="button"
              onClick={onMark}
              aria-pressed={marked}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${marked ? 'border-orange-300 bg-[#FFF7EC] text-orange-800' : 'border-violet-200 bg-white text-violet-900 hover:bg-violet-50'}`}
            >
              <CheckCircle2 size={16} />{marked ? 'Selected' : 'Mark as Selected'}
            </button>
          </div>
    </aside>
  );
}

export default function VisualRecommendationApp() {
  const [concept, setConcept] = useState(() => sessionStorage.getItem(CONCEPT_STORAGE_KEY) ?? '');
  const [customDimensions, setCustomDimensions] = useState(DEFAULT_DIMENSIONS);
  const [draftAxisId, setDraftAxisId] = useState('aesthetic');
  const [resultAxisId, setResultAxisId] = useState('aesthetic');
  const [provider, setProvider] = useState('ollama');
  const [localModel, setLocalModel] = useState('');
  const [remoteModels, setRemoteModels] = useState({});
  const [apiKeys, setApiKeys] = useState({});
  const [modelRefresh, setModelRefresh] = useState(0);
  const [modelCatalog, setModelCatalog] = useState({ models: [], error: '', version: -1 });
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [failures, setFailures] = useState([]);
  const [batch, setBatch] = useState(null);
  const [progress, setProgress] = useState(null);
  const [fileNotice, setFileNotice] = useState('');
  const [profileTarget, setProfileTarget] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [markedIds, setMarkedIds] = useState([]);
  const [canvasWidth, setCanvasWidth] = useState(900);
  const fileInput = useRef(null);
  const viewport = useRef(null);
  const canvasContent = useRef(null);
  const canvasDrag = useRef(null);
  const { zoom, setZoom, panX, setPanX } = useCanvasZoom(viewport, canvasContent);
  const activeUrls = useRef([]);
  const requestInProgress = useRef(false);
  const rulesDialog = useRef(null);
  const welcomeDialog = useRef(null);

  useEffect(() => {
    if (sessionStorage.getItem(CONCEPT_STORAGE_KEY) === null && !welcomeDialog.current.open) {
      welcomeDialog.current.showModal();
    }
  }, []);

  useEffect(() => {
    if (provider !== 'ollama') return;
    const controller = new AbortController();
    async function loadModels() {
      try {
        const response = await fetch('/api/models', { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.models)) {
          throw new Error(data.error || 'Could not load local models.');
        }
        if (controller.signal.aborted) return;
        setLocalModel(current => {
          if (data.models.includes(current)) return current;
          return data.models.includes(data.defaultModel) ? data.defaultModel : data.models[0] ?? '';
        });
        setModelCatalog({ models: data.models, error: '', version: modelRefresh });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLocalModel('');
        setModelCatalog({ models: [], error: error.message || 'Could not load local models.', version: modelRefresh });
      }
    }
    loadModels();
    return () => controller.abort();
  }, [provider, modelRefresh]);

  useEffect(() => {
    const element = viewport.current;
    const observer = new ResizeObserver(() => {
      setCanvasWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    activeUrls.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const cardSides = useMemo(() => getCardSides(canvasWidth), [canvasWidth]);
  const axisPadding = Math.ceil(cardSides.maxSide / 2) + 16;
  const axisWidth = Math.max(120, canvasWidth - axisPadding * 2);
  const draftDimensions = customDimensions;
  const draftAxis = draftDimensions.find(dimension => dimension.id === draftAxisId) ?? draftDimensions[0];
  const resultDimensions = batch ? batch.dimensions ?? DEFAULT_DIMENSIONS : draftDimensions;
  const axis = batch ? resultDimensions.find(dimension => dimension.id === resultAxisId) ?? resultDimensions[0] : draftAxis;
  const layout = useMemo(() => layoutScoredImages(results, axisWidth, cardSides, axis.id, resultDimensions.map(dimension => dimension.id)), [results, axisWidth, cardSides, axis.id, resultDimensions]);
  const selectedLayers = useMemo(() => {
    const marked = new Set(markedIds);
    const selected = layout.items.filter(image => marked.has(image.id));
    selected.sort((a, b) => (a.axisScore + a.secondaryTotal) - (b.axisScore + b.secondaryTotal) || a.stackOrder - b.stackOrder);
    return new Map(selected.map((image, index) => [image.id, layout.items.length + 2 + index]));
  }, [layout.items, markedIds]);
  const viewingId = profileTarget?.id;
  const viewingImage = layout.items.find(image => image.id === viewingId);
  const previewId = viewingImage ? null : hoveredId ?? focusedId;
  const running = progress !== null;
  const percent = progress ? Math.floor(progress.processed * 100 / progress.total) : 0;
  const localProvider = provider === 'ollama';
  const model = localProvider ? localModel : remoteModels[provider]?.trim() ?? '';
  const modelsLoading = modelCatalog.version !== modelRefresh;
  const modelReady = Boolean(model && (localProvider ? !modelsLoading : apiKeys[provider]?.trim()));
  const settings = {
    provider,
    dimensions: draftDimensions.map(({ id, name, prompt }) => ({ id, name: name.trim(), prompt: prompt.trim() })),
    ...(concept.trim() && { concept: concept.trim() }),
    ...(model && { model }),
  };
  const batchSettings = batch && {
    provider: batch.provider ?? 'ollama',
    ...(batch.dimensions
      ? { dimensions: batch.dimensions, ...(batch.sharedPrompt !== undefined && { sharedPrompt: batch.sharedPrompt }) }
      : { prompt: batch.prompt }),
    ...(batch.concept && { concept: batch.concept }),
    ...(batch.model && { model: batch.model }),
  };
  const canRetry = Boolean(batchSettings && (batchSettings.provider === 'ollama' || apiKeys[batchSettings.provider]?.trim()));
  const promptChanged = batch && JSON.stringify(batchSettings) !== JSON.stringify(settings);
  const settingsError = dimensionError(draftDimensions);
  const contentWidth = (axisWidth + axisPadding * 2) * zoom;
  const panRoom = Math.max(0, (canvasWidth - contentWidth) / 2);
  const contentLeft = panRoom + Math.max(-panRoom, Math.min(panRoom, panX));
  const tickX = tick => contentLeft + (axisPadding + (tick - 1) * axisWidth / 5) * zoom;

  function startCanvasDrag(event) {
    if (running || !layout.items.length || event.pointerType === 'touch' || event.button !== 0 || event.target.closest('button')) return;
    canvasDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    clearPreview();
    closeProfile();
  }

  function moveCanvasDrag(event) {
    const drag = canvasDrag.current;
    if (drag?.id !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (panRoom > 0) {
      setPanX(current => Math.max(-panRoom, Math.min(panRoom, current + deltaX)));
    }
    event.currentTarget.scrollBy(panRoom > 0 ? 0 : -deltaX, -deltaY);
  }

  function endCanvasDrag(event) {
    if (canvasDrag.current?.id === event.pointerId) canvasDrag.current = null;
  }

  function clearPreview() {
    setHoveredId(null);
    setFocusedId(null);
  }

  function closeProfile(restoreFocus = false) {
    setProfileTarget(null);
    if (restoreFocus) profileTarget?.anchor.focus({ preventScroll: true });
  }

  function replaceFiles(list) {
    if (requestInProgress.current || !list.length) return;
    const accepted = list.filter(file => TYPES.includes(file.type) && file.size > 0 && file.size <= MAX_FILE_BYTES);
    const invalid = list.length - accepted.length;
    setFileNotice(invalid ? `${invalid} skipped. Choose nonempty JPG, PNG, or WebP images up to 10 MB each.` : '');
    if (!accepted.length) return;
    activeUrls.current.forEach(url => URL.revokeObjectURL(url));
    const entries = accepted.map((file, index) => ({ file, index, url: URL.createObjectURL(file) }));
    activeUrls.current = entries.map(entry => entry.url);
    setFiles(entries);
    setResults([]);
    setFailures([]);
    setBatch(null);
    setProfileTarget(null);
    setHoveredId(null);
    setFocusedId(null);
    setMarkedIds([]);
  }

  async function runBatch(retryIndices = null) {
    if (requestInProgress.current) return;
    const retry = retryIndices !== null;
    const scoringSettings = retry ? batchSettings : settings;
    const entries = retry ? retryIndices.map(index => files[index]) : files;
    if (!scoringSettings || !entries.length || (retry ? !canRetry : settingsError || !modelReady)) return;
    const apiKey = apiKeys[scoringSettings.provider]?.trim();

    requestInProgress.current = true;
    setProgress({ processed: 0, total: entries.length, fileName: entries[0].file.name, retry });
    setFailures(previous => retry ? previous.filter(failure => !retryIndices.includes(failure.index)) : []);
    setProfileTarget(null);
    setHoveredId(null);
    setFocusedId(null);

    if (!retry) {
      setResults([]);
      setMarkedIds([]);
      setBatch({ ...scoringSettings, startedAt: new Date().toISOString() });
      setResultAxisId(draftAxis.id);
      setZoom(1);
      viewport.current.scrollTo(0, 0);
    }

    try {
      for (const [position, entry] of entries.entries()) {
        try {
          const image = await scoreImage(entry, scoringSettings, apiKey);
          setResults(previous => [...previous, image]);
        } catch (error) {
          setFailures(previous => [...previous, {
            index: entry.index,
            name: entry.file.name,
            message: error instanceof Error ? error.message : 'Scoring failed.',
          }]);
        }
        setProgress({
          processed: position + 1,
          total: entries.length,
          fileName: entries[position + 1]?.file.name,
          retry,
        });
      }
    } finally {
      requestInProgress.current = false;
      setProgress(null);
    }
  }

  function exportResults() {
    downloadReport({
      ...batch,
      exportedAt: new Date().toISOString(),
      model: results[0].model,
      axis: { id: axis.id, name: axis.name },
      axisWidth,
      cardSides,
      layoutHeight: layout.height,
      images: layout.items.map(image => ({
        id: image.id,
        fileName: image.fileName,
        ...(image.scores ? { scores: image.scores } : { aesthetic: image.aesthetic, creativity: image.creativity, expectation: image.expectation }),
        rationale: image.rationale,
        criteria: image.criteria,
        rank: image.rank,
        tied: image.tied,
        selected: markedIds.includes(image.id),
        layout: { x: image.x, y: image.y, size: image.size, stackOrder: image.stackOrder, secondaryTotal: image.secondaryTotal },
      })),
      failures,
    });
  }

  return (
    <div className="visual-app workspace flex h-dvh w-full flex-col overflow-hidden font-sans text-slate-800 md:flex-row">
      <aside className="setup-sidebar max-h-[47dvh] w-full shrink-0 overflow-y-auto border-b border-white/90 bg-white/60 backdrop-blur-xl md:max-h-none md:w-[clamp(22rem,28vw,25rem)] md:border-b-0 md:border-r">
        <header className="flex items-center gap-2.5 border-b border-violet-100/80 px-4 py-3">
          <span className="workspace-icon shrink-0"><Sparkles size={18} /></span>
          <div className="min-w-0">
            <h1 className="workspace-title font-bold text-slate-900">Flexible Visual Recommendation</h1>
            <p className="text-xs text-slate-600">Image evaluation workspace</p>
          </div>
        </header>
        <div className="space-y-3 p-4">
          <EvaluationEditor
            dimensions={draftDimensions}
            onDimensions={setCustomDimensions}
            axisId={draftAxis.id}
            onAxis={setDraftAxisId}
            error={settingsError}
            disabled={running}
          />
          <fieldset className="min-w-0 space-y-1.5" disabled={running}>
            <legend className="text-sm font-semibold">2. Model</legend>
            <select aria-label="Model provider" className={`${MODEL_FIELD_CLASS} w-full`} value={provider} onChange={event => setProvider(event.target.value)}>
              {Object.entries(MODEL_PROVIDERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            {localProvider ? (
              <>
                <div className="flex items-stretch gap-2">
                  <select aria-label="Ollama vision model" className={`${MODEL_FIELD_CLASS} flex-1 truncate`} value={localModel}
                    onChange={event => setLocalModel(event.target.value)} disabled={modelsLoading || !modelCatalog.models.length}>
                    {!localModel && <option value="">{modelsLoading ? 'Loading models…' : 'No vision model available'}</option>}
                    {modelCatalog.models.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button type="button" aria-label="Refresh local models" title="Refresh local models" onClick={() => setModelRefresh(count => count + 1)} disabled={modelsLoading} className="rounded-lg border border-violet-100 bg-white/80 px-2.5 text-violet-900 hover:bg-white disabled:opacity-40">
                    <RotateCcw size={16} />
                  </button>
                </div>
                {!modelsLoading && (modelCatalog.error || !modelCatalog.models.length) && (
                  <p role="status" className="text-xs text-slate-600">{modelCatalog.error || 'Install an Ollama model that supports images, then refresh.'}</p>
                )}
              </>
            ) : (
              <>
                <label className="block space-y-1 text-xs text-slate-600">
                  <span>Model ID</span>
                  <input className={`${MODEL_FIELD_CLASS} w-full`} value={remoteModels[provider] ?? ''} maxLength={MAX_MODEL_LENGTH}
                    spellCheck={false} autoComplete="off" onChange={event => setRemoteModels({ ...remoteModels, [provider]: event.target.value })} />
                </label>
                <label className="block space-y-1 text-xs text-slate-600">
                  <span>API key</span>
                  <input type="password" className={`${MODEL_FIELD_CLASS} w-full`} value={apiKeys[provider] ?? ''} maxLength={MAX_API_KEY_LENGTH}
                    autoComplete="off" onChange={event => setApiKeys({ ...apiKeys, [provider]: event.target.value })} />
                </label>
                <p className="text-xs text-slate-600">Images and prompts are sent to this provider. Charges may apply.</p>
                {provider === 'compatible' && <p className="text-xs text-slate-600">Set the API base URL on the server as described in the README.</p>}
              </>
            )}
          </fieldset>
          <div>
            <h2 className="mb-1 text-sm font-semibold">3. Batch Upload Images</h2>
            <input
              ref={fileInput}
              type="file"
              accept={TYPES.join(',')}
              multiple
              className="hidden"
              aria-label="Upload images"
              disabled={running}
              onChange={event => {
                replaceFiles(Array.from(event.target.files));
                event.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={running}
              onClick={() => fileInput.current.click()}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                replaceFiles(Array.from(event.dataTransfer.files));
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 text-sm disabled:opacity-60 ${files.length ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
            >
              {files.length ? <CheckCircle2 size={21} /> : <ImageIcon size={21} />}
              <span>{files.length ? `${files.length} images added · replace files` : 'Click or drop images here'}</span>
            </button>
            {files.length > 0 && (
              <details className="mt-1 text-xs text-gray-600">
                <summary className="cursor-pointer">View file list</summary>
                <ul className="mt-1 max-h-20 overflow-y-auto">
                  {files.map(entry => <li key={entry.index} className="truncate" title={entry.file.name}>{entry.file.name}</li>)}
                </ul>
              </details>
            )}
            {fileNotice && <p role="status" className="mt-2 text-xs text-orange-800">{fileNotice}</p>}
          </div>
          <button
            type="button"
            onClick={() => runBatch()}
            disabled={running || !files.length || !modelReady || Boolean(settingsError)}
            className="w-full rounded-xl bg-[#6D5CE8] px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#5947d3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Evaluating…' : batch ? 'Evaluate Again' : 'Execute Evaluation'}
          </button>
          {batch && (
            <div className="space-y-2">
              <p role={running ? undefined : 'status'} className="text-sm">
                {results.length} / {files.length} scored{failures.length ? ` · ${failures.length} failed` : ''}
              </p>
              {promptChanged && <p className="text-xs text-gray-600">The current results use the previous scoring setup.</p>}
              {!running && failures.length > 0 && !canRetry && (
                <p className="text-xs text-gray-600">Enter the API key for {MODEL_PROVIDERS[batchSettings.provider]} to retry this batch.</p>
              )}
              {failures.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-y-auto text-xs text-red-700">
                  {failures.map(failure => (
                    <li key={failure.index} className="py-1">
                      <strong className="break-all">{failure.name}</strong> · {failure.message}
                      {!running && (
                        <button
                          type="button"
                          onClick={() => runBatch([failure.index])}
                          disabled={!canRetry}
                          aria-label={`Retry ${failure.name} with the batch setup`}
                          className="ml-2 font-semibold underline disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!running && failures.length > 1 && (
                <button type="button" onClick={() => runBatch(failures.map(failure => failure.index))} disabled={!canRetry} className="rounded-lg border px-3 py-2 text-xs font-semibold text-[#5848cd] disabled:opacity-50">
                  Retry Failed{promptChanged ? ' with Previous Setup' : ''}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="workspace-toolbar flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/90 bg-white/55 px-4 py-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            {results.length > 0 && resultDimensions.length > 1 ? (
              <label className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span className="shrink-0">Horizontal axis</span>
                <select
                  className="min-w-0 max-w-48 truncate rounded-lg border border-[#DFDFFB] bg-white px-2 py-1.5 text-sm font-normal"
                  disabled={running}
                  value={axis.id}
                  onChange={event => {
                    setHoveredId(null);
                    setFocusedId(null);
                    setResultAxisId(event.target.value);
                    viewport.current.scrollTo(0, 0);
                  }}
                >
                  {resultDimensions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            ) : <p className="min-w-0 truncate font-semibold" title={axis.name}>{axis.name.trim() || 'Score'}</p>}
            <span className="shrink-0 text-sm text-gray-500">1–6</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { clearPreview(); closeProfile(); rulesDialog.current.showModal(); }} className="flex items-center gap-2 rounded-xl border border-violet-200/80 bg-white/75 px-3 py-2 text-sm font-medium text-violet-900 hover:bg-white" aria-haspopup="dialog">
              <BookOpen size={16} />Scoring rules
            </button>
            <span className="rounded-lg border border-orange-200 bg-[#FFF7EC] px-3 py-2 text-sm text-orange-800">{markedIds.length} Selected</span>
            <button
              type="button"
              disabled={running || !results.length}
              onClick={exportResults}
              className="flex items-center gap-2 rounded-lg bg-[#6D5CE8] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <Download size={16} />Export Report
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1" onKeyDown={event => {
          if (event.key !== 'Escape') return;
          clearPreview();
          if (profileTarget) closeProfile(true);
        }}>
          <div ref={viewport} onScroll={() => { clearPreview(); closeProfile(); }} onClick={event => {
            if (!event.target.closest('button')) closeProfile();
          }} onPointerDown={startCanvasDrag} onPointerMove={moveCanvasDrag} onLostPointerCapture={endCanvasDrag}
            className={`absolute inset-0 overflow-auto ${layout.items.length && !running ? 'cursor-grab select-none active:cursor-grabbing' : ''}`} aria-label={`${axis.name || 'Image'} score canvas`}>
            {!running && layout.items.length > 0 && (
              <div className="relative flex min-h-full min-w-full flex-col" style={{ width: contentWidth }}>
                <div className="sticky top-0 z-10 h-9 shrink-0 border-b border-violet-100 bg-white/80 text-xs text-slate-600 backdrop-blur-md">
                  {TICKS.map(tick => (
                    <span key={tick} className="absolute top-2 -translate-x-1/2 tabular-nums" style={{ left: tickX(tick) }}>
                      {tick.toFixed(1)}
                    </span>
                  ))}
                </div>
                <div className="relative flex-1" style={{ minHeight: Math.max(220, layout.height * zoom + 64) }}>
                  {TICKS.map(tick => (
                    <span key={tick} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[#DFDFFB]" style={{ left: tickX(tick) }} />
                  ))}
                  <div ref={canvasContent} className="absolute top-1/2 isolate -translate-y-1/2" style={{ left: contentLeft, width: contentWidth, height: layout.height * zoom }}>
                    <span className="pointer-events-none absolute border-t border-[#DFDFFB]" style={{ left: axisPadding * zoom, top: layout.centerY * zoom, width: axisWidth * zoom }} />
                    {layout.items.map(image => {
                      const selectedLayer = selectedLayers.get(image.id);
                      const marked = selectedLayer !== undefined;
                      const viewing = image.id === viewingId;
                      const enlarged = marked || viewing || image.id === previewId;
                      return (
                        <button
                          key={image.id}
                          type="button"
                          aria-label={`View ${image.fileName}, ${axis.name} score ${image.axisScore.toFixed(2)}`}
                          aria-expanded={viewing}
                          aria-haspopup="dialog"
                          aria-controls={viewing ? 'scoring-profile' : undefined}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-2xl bg-white outline-offset-2 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6D5CE8] ${viewingImage && !viewing && !marked ? 'opacity-60' : ''}`}
                          style={{
                            left: (axisPadding + image.x) * zoom,
                            top: image.y * zoom,
                            width: image.size * zoom,
                            height: image.size * zoom,
                            zIndex: selectedLayer ?? (enlarged ? layout.items.length + 1 : image.stackOrder),
                          }}
                          onPointerEnter={event => {
                            if (event.pointerType === 'touch') return;
                            setFocusedId(null);
                            setHoveredId(image.id);
                          }}
                          onPointerLeave={() => setHoveredId(current => current === image.id ? null : current)}
                          onFocus={event => {
                            if (!event.currentTarget.matches(':focus-visible')) return;
                            setFocusedId(image.id);
                          }}
                          onBlur={() => setFocusedId(null)}
                          onClick={event => {
                            clearPreview();
                            setProfileTarget(viewing ? null : { id: image.id, anchor: event.currentTarget });
                          }}
                        >
                          <span
                            className={`image-tile absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white motion-safe:transition-[width,height] motion-safe:duration-150 ${marked ? 'image-tile-selected' : enlarged || viewing ? 'image-tile-active' : 'border-violet-100'}`}
                            style={{ width: enlarged ? layout.hoverSide * zoom : '100%', height: enlarged ? layout.hoverSide * zoom : '100%' }}
                          >
                            <img src={image.url} alt="" draggable={false} className="h-full w-full rounded-[inherit] object-contain" loading="lazy" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {(running || !layout.items.length) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-gray-600">
              <div className="glass-surface w-full max-w-sm space-y-3 rounded-3xl px-6 py-8">
                <span className="workspace-icon mx-auto"><Sparkles size={22} aria-hidden="true" /></span>
                {progress ? (
                  <>
                    <p className="font-semibold text-gray-800">{progress.retry ? 'Retrying images…' : 'Scoring images…'}</p>
                    <progress
                      className="scoring-progress block h-3 w-full appearance-none overflow-hidden rounded-full border border-gray-200 bg-white"
                      max={progress.total}
                      value={progress.processed}
                      aria-label={progress.retry ? 'Retry progress' : 'Scoring progress'}
                    />
                    <div role="status" aria-atomic="true" className="space-y-2 text-sm">
                      <p className="tabular-nums">{progress.processed} of {progress.total} processed · {percent}%</p>
                      {progress.fileName && <p className="break-all">Current image: {progress.fileName}</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{batch ? 'No images scored' : 'Ready for Visual Evaluation'}</p>
                    <p className="text-sm">{batch ? 'Check the errors in the sidebar, then retry.' : 'Add images and execute an evaluation to see them on the score axis.'}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {!running && layout.items.length > 0 && (
            <div className="glass-surface absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-xl px-2 py-1.5">
              <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(zoom - 0.1)} className="p-1 disabled:opacity-40"><Minus size={16} /></button>
              <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(zoom + 0.1)} className="p-1 disabled:opacity-40"><Plus size={16} /></button>
              <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)} className="p-1"><RotateCcw size={15} /></button>
            </div>
          )}

          {viewingImage && !running && (
            <ScoringProfile
              key={viewingImage.id}
              image={viewingImage}
              dimensions={resultDimensions}
              axis={axis}
              total={layout.items.length}
              marked={markedIds.includes(viewingImage.id)}
              onClose={() => closeProfile(true)}
              onMark={() => setMarkedIds(previous => previous.includes(viewingImage.id) ? previous.filter(id => id !== viewingImage.id) : [...previous, viewingImage.id])}
              anchor={profileTarget.anchor}
              canvasRef={viewport}
              expandedSide={layout.hoverSide * zoom}
            />
          )}
        </div>
      </main>
      <ScoringRules dialogRef={rulesDialog} settings={settings} dimensions={resultDimensions} axis={axis} batch={batch} concept={concept} onConcept={value => {
        setConcept(value);
        sessionStorage.setItem(CONCEPT_STORAGE_KEY, value);
      }} running={running} />
      <dialog ref={welcomeDialog} aria-labelledby="welcome-title" className="glass-surface rules-dialog welcome-dialog m-auto rounded-3xl text-slate-800"
        onClose={event => {
          const value = event.currentTarget.returnValue === 'use' ? concept.trim() : '';
          setConcept(value);
          sessionStorage.setItem(CONCEPT_STORAGE_KEY, value);
        }}>
        <form method="dialog" className="space-y-4 p-6">
          <span className="workspace-icon"><Sparkles size={21} aria-hidden="true" /></span>
          <div>
            <h2 id="welcome-title" className="text-lg font-bold text-slate-900">What are you evaluating?</h2>
            <p className="mt-1 text-sm text-slate-600">Give the model a little context about this batch, such as its subject, intended audience, or design goal.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Image concept or design brief <span className="text-slate-500">(optional)</span></span>
            <textarea value={concept} onChange={event => setConcept(event.target.value)} maxLength={1000} rows={3} placeholder="Example: A series of posters for a nighttime museum exhibition." className="w-full resize-y rounded-xl border border-violet-200 bg-white/95 px-3 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button value="skip" className="rounded-xl px-4 py-2 text-sm text-slate-700 hover:bg-white/80">Skip for now</button>
            <button value="use" className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800">Continue</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
