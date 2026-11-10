const MIN_SCORE = 1;
const MAX_SCORE = 6;
const MIN_CARD_SIDE = 100;
const MAX_CARD_SIDE = 280;
const NARROW_CANVAS_WIDTH = 360;
const DESKTOP_CANVAS_WIDTH = 1400;
const NARROW_CARD_SCALE = 0.46;
const CARD_GAP = 8;
const VERTICAL_PADDING = 16;
const MAX_HOVER_OVERLAP = 0.2;
const TIED_CARD_OVERLAP = 0.16;
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
    const baseClearance = card.axisScore === other.axisScore
      ? halfSum - card.size * TIED_CARD_OVERLAP
      : halfSum + CARD_GAP;
    const neighborSide = Math.max(card.size, other.size);
    // Either card can be enlarged. Keep at least 80% of its neighbor visible.
    const hoverClearance = (hoverSide + neighborSide) / 2 - neighborSide * MAX_HOVER_OVERLAP;
    const clearance = Math.max(baseClearance, hoverClearance);
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
  if (!conflict) return target;
  return target - conflict.start <= conflict.end - target ? conflict.start : conflict.end;
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

  // Paint lower secondary totals first within a tie. Stable IDs break exact ties.
  const paintOrder = [...placementOrder].sort((a, b) => a.axisScore - b.axisScore || a.secondaryTotal - b.secondaryTotal);
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
