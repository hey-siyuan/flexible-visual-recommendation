const MIN_SCORE = 1;
const MAX_SCORE = 6;
const MIN_CARD_SIDE = 80;
const MAX_CARD_SIDE = 224;
const NARROW_CANVAS_WIDTH = 360;
const DESKTOP_CANVAS_WIDTH = 1400;
const NARROW_CARD_SCALE = 0.46;
const VERTICAL_PADDING = 16;
export const MAX_OVERLAP_FRACTION = 0.25;
const PACKING_STEP = 4;
const DEFAULT_DIMENSIONS = ['aesthetic', 'creativity', 'expectation'];

export function getCardSides(canvasWidth) {
  if (!Number.isFinite(canvasWidth) || canvasWidth < 0) {
    throw new RangeError('The canvas width must be a finite nonnegative number.');
  }
  const fraction = Math.min(1, Math.max(0,
    (canvasWidth - NARROW_CANVAS_WIDTH) / (DESKTOP_CANVAS_WIDTH - NARROW_CANVAS_WIDTH),
  ));
  const scale = NARROW_CARD_SCALE + fraction * (1 - NARROW_CARD_SCALE);
  return { minSide: MIN_CARD_SIDE * scale, maxSide: MAX_CARD_SIDE * scale };
}

function preferredY(id, hoverSide) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  const fraction = ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
  return (fraction - 0.5) * hoverSide * 0.8;
}

function nearestFreeY(card, placedCards, hoverSide) {
  const target = preferredY(card.id, hoverSide);
  const blocked = [];
  for (const other of placedCards) {
    const halfSum = (card.size + other.size) / 2;
    const clearance = halfSum - MAX_OVERLAP_FRACTION * Math.min(card.size, other.size);
    if (Math.abs(card.x - other.x) < clearance) {
      blocked.push({ start: other.y - clearance, end: other.y + clearance });
    }
  }

  blocked.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of blocked) {
    const last = merged.at(-1);
    // Intervals are open: touching endpoints are valid positions.
    if (last && interval.start < last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push(interval);
    }
  }

  const conflict = merged.find(({ start, end }) => start < target && end > target);
  let y = !conflict ? target
    : target - conflict.start <= conflict.end - target ? conflict.start : conflict.end;
  // Pairwise clearance alone cannot bound the area covered by several neighbors.
  // Check their union, independently of drawing order, so later selection is safe.
  while (!withinOverlapLimit({ ...card, y }, placedCards)) y += PACKING_STEP;
  return y;
}

function intersects(first, second) {
  const halfSum = (first.size + second.size) / 2;
  return Math.abs(first.x - second.x) < halfSum && Math.abs(first.y - second.y) < halfSum;
}

/** Fraction of a square thumbnail intersected by the union of other thumbnails. */
export function coveredFraction(card, others) {
  const rectangles = others.filter(other => intersects(card, other)).map(other => ({
    left: Math.max(card.x - card.size / 2, other.x - other.size / 2),
    right: Math.min(card.x + card.size / 2, other.x + other.size / 2),
    top: Math.max(card.y - card.size / 2, other.y - other.size / 2),
    bottom: Math.min(card.y + card.size / 2, other.y + other.size / 2),
  }));
  const edges = [...new Set(rectangles.flatMap(rectangle => [rectangle.left, rectangle.right]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 1; index < edges.length; index++) {
    const left = edges[index - 1];
    const right = edges[index];
    const intervals = rectangles.filter(rectangle => rectangle.left < right && rectangle.right > left)
      .map(rectangle => [rectangle.top, rectangle.bottom]).sort((a, b) => a[0] - b[0]);
    let previousBottom = -Infinity;
    let height = 0;
    for (const [top, bottom] of intervals) {
      height += Math.max(0, bottom - Math.max(top, previousBottom));
      previousBottom = Math.max(previousBottom, bottom);
    }
    area += (right - left) * height;
  }
  return area / (card.size * card.size);
}

function withinOverlapLimit(card, others) {
  const neighbors = others.filter(other => intersects(card, other));
  const limit = MAX_OVERLAP_FRACTION + 1e-9;
  if (coveredFraction(card, neighbors) > limit) return false;
  // Only intersecting neighbors can acquire extra overlap when this card changes.
  return neighbors.every(neighbor => coveredFraction(neighbor,
    [...others.filter(other => other !== neighbor), card]) <= limit);
}

/** Active inspection > selected > ordinary; totals order each persistent tier. */
export function getImageLayers(items, selectedIds = [], activeId) {
  const selected = new Set(selectedIds);
  return new Map(items.map(image => [image.id,
    image.id === activeId ? items.length * 2 + 1
      : image.stackOrder + (selected.has(image.id) ? items.length : 0),
  ]));
}

/** Enlarge in place toward the batch maximum while preserving the overlap limit. */
export function getDisplaySizes(items, maximumSide, layers, enlargedIds = []) {
  const enlarged = new Set(enlargedIds);
  const cards = items.map(image => ({ ...image, layer: layers.get(image.id) }));
  for (const card of [...cards].sort((a, b) => b.layer - a.layer)) {
    if (!enlarged.has(card.id) || card.size >= maximumSide) continue;
    const others = cards.filter(other => other !== card);
    const base = card.size;
    if (withinOverlapLimit({ ...card, size: maximumSide }, others)) {
      card.size = maximumSide;
      continue;
    }
    let low = base;
    let high = maximumSide;
    for (let step = 0; step < 18; step++) {
      const size = (low + high) / 2;
      if (withinOverlapLimit({ ...card, size }, others)) low = size;
      else high = size;
    }
    card.size = low;
  }
  return new Map(cards.map(card => [card.id, card.size]));
}

/** Zoom fits the complete axis and layout, leaving the tick strip and controls free. */
export function getFitZoom(viewportWidth, viewportHeight, contentWidth, layoutHeight, maximumZoom = 1.6) {
  if (![viewportWidth, viewportHeight, contentWidth, layoutHeight, maximumZoom].every(Number.isFinite)
    || contentWidth <= 0 || layoutHeight <= 0 || maximumZoom <= 0) return 1;
  return Math.min(maximumZoom, Math.max(1, viewportWidth) / contentWidth,
    Math.max(1, viewportHeight - 36 - 64) / layoutHeight);
}

export function layoutScoredImages(images, axisWidth, cardSides, axisId = 'aesthetic', dimensionIds = DEFAULT_DIMENSIONS) {
  if (!Number.isFinite(axisWidth) || axisWidth < 0) {
    throw new RangeError('The score axis width must be a finite nonnegative number.');
  }
  const { minSide, maxSide } = cardSides ?? getCardSides(axisWidth);
  if (!Number.isFinite(minSide) || !Number.isFinite(maxSide) || minSide <= 0 || maxSide < minSide) {
    throw new RangeError('Card sides must be finite positive numbers in ascending order.');
  }
  const secondaryIds = dimensionIds.filter(id => id !== axisId);

  const scoreCounts = new Map();
  const items = images.map((image) => {
    const axisScore = image.scores?.[axisId] ?? image[axisId];
    if (!Number.isFinite(axisScore) || axisScore < MIN_SCORE || axisScore > MAX_SCORE) {
      throw new RangeError('Every image must have a finite horizontal axis score between 1 and 6.');
    }
    scoreCounts.set(axisScore, (scoreCounts.get(axisScore) ?? 0) + 1);
    const fraction = (axisScore - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
    const secondaryTotal = secondaryIds.reduce((total, id) => total + (image.scores?.[id] ?? image[id] ?? 0), 0);
    return {
      ...image,
      axisScore,
      secondaryTotal,
      x: fraction * axisWidth,
      y: 0,
      size: minSide + fraction * (maxSide - minSide),
    };
  });

  const rankByScore = new Map();
  let nextRank = 1;
  for (const score of [...scoreCounts.keys()].sort((a, b) => b - a)) {
    rankByScore.set(score, nextRank);
    nextRank += scoreCounts.get(score);
  }
  for (const card of items) {
    card.rank = rankByScore.get(card.axisScore);
    card.tied = scoreCounts.get(card.axisScore) > 1;
  }
  const hoverSide = items.reduce((largest, card) => Math.max(largest, card.size), 0);

  // Keep the packing order independent of score and model completion order.
  const placementOrder = [...items].sort((a, b) => {
    const first = String(a.id);
    const second = String(b.id);
    if (first < second) return -1;
    if (first > second) return 1;
    return 0;
  });

  // Paint lower totals first across all dimensions. Stable IDs break exact ties.
  const paintOrder = [...placementOrder].sort((a, b) => (a.axisScore + a.secondaryTotal) - (b.axisScore + b.secondaryTotal));
  for (const [index, card] of paintOrder.entries()) card.stackOrder = index + 1;

  const placedCards = [];
  let top = 0;
  let bottom = 0;
  for (const card of placementOrder) {
    card.y = nearestFreeY(card, placedCards, hoverSide);
    placedCards.push(card);
    top = Math.min(top, card.y - hoverSide / 2);
    bottom = Math.max(bottom, card.y + hoverSide / 2);
  }

  const centerY = VERTICAL_PADDING - top;
  for (const card of items) card.y += centerY;

  return { items, height: bottom - top + 2 * VERTICAL_PADDING, centerY, hoverSide };
}
