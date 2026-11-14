import assert from 'node:assert/strict';
import test from 'node:test';
import { coveredFraction, getCardSides, getDisplaySizes, getFitZoom, getImageLayers, layoutScoredImages } from '../src/scoreLayout.js';

const image = (id, a, c = 3, e = 3) => ({ id, scores: { aesthetic: a, creativity: c, expectation: e } });
const occlusion = cards => Math.max(0, ...cards.map(card => coveredFraction(card,
  cards.filter(other => other.stackOrder > card.stackOrder))));
const overlapping = cards => Math.max(0, ...cards.map(card => coveredFraction(card,
  cards.filter(other => other.id !== card.id))));

test('combined coverage uses the rectangle union, including duplicate coverage', () => {
  const card = { x: 0, y: 0, size: 100 };
  const left = { x: -75, y: 0, size: 100 };
  const right = { x: 75, y: 0, size: 100 };
  assert.equal(coveredFraction(card, [left, right]), 0.5);
  assert.equal(coveredFraction(card, [left, left]), 0.25);
});

test('scores fix the axis and rank, while totals set layer order across axis scores', () => {
  const { items } = layoutScoredImages([image('a', 6, 1, 1), image('b', 6, 5, 5), image('c', 5, 6, 6)], 1000, { minSide: 80, maxSide: 224 });
  const [a, b, c] = items;
  assert.deepEqual(items.map(card => card.rank), [1, 1, 3]);
  assert.equal(a.x, b.x);
  assert.equal(a.size, b.size);
  assert.equal(c.x, 800);
  assert.ok(c.stackOrder > b.stackOrder && b.stackOrder > a.stackOrder);
  const selected = getImageLayers(items, ['a', 'b']);
  assert.ok(selected.get('b') > selected.get('a') && selected.get('a') > selected.get('c'));
  const active = getImageLayers(items, ['a', 'b'], 'c');
  assert.ok(active.get('c') > active.get('b'));
  assert.equal(getImageLayers(items).get('a'), a.stackOrder);
});

for (const count of [5, 10, 20, 60]) {
  test(`${count} tied and mixed-score images fit one viewport and retain the overlap limit through interactions`, () => {
    const images = Array.from({ length: count }, (_, index) => image(`id-${index}`, index % 4 ? 6 : 1 + index % 6, 1 + index % 6, 6 - index % 6));
    for (const width of [360, 900, 1600]) {
      const sides = getCardSides(width);
      const padding = Math.ceil(sides.maxSide / 2) + 16;
      const axisWidth = Math.max(120, width - padding * 2);
      const layout = layoutScoredImages(images, axisWidth, sides);
      assert.ok(overlapping(layout.items) <= 0.25 + 1e-9);
      const reversed = layoutScoredImages([...images].reverse(), axisWidth, sides);
      assert.deepEqual([...layout.items].sort((a, b) => a.id.localeCompare(b.id)),
        [...reversed.items].sort((a, b) => a.id.localeCompare(b.id)));
      for (const selected of [[], images.slice(0, 3).map(card => card.id), images.map(card => card.id)]) {
        const active = images.at(-1).id;
        const layers = getImageLayers(layout.items, selected, active);
        const sizes = getDisplaySizes(layout.items, layout.hoverSide, layers, [...selected, active]);
        const displayed = layout.items.map(card => ({ ...card, size: sizes.get(card.id), stackOrder: layers.get(card.id) }));
        assert.ok(occlusion(displayed) <= 0.25 + 1e-9);
        assert.ok(overlapping(displayed) <= 0.25 + 1e-9);
        for (const card of displayed) {
          assert.ok(card.size >= layout.items.find(base => base.id === card.id).size);
          assert.ok(card.size <= layout.hoverSide);
        }
        const zoom = getFitZoom(width, 650, axisWidth + 2 * padding, layout.height);
        for (const card of displayed) {
          assert.ok((padding + card.x - card.size / 2) * zoom >= 0);
          assert.ok((padding + card.x + card.size / 2) * zoom <= width + 1e-7);
          assert.ok((card.y - card.size / 2) * zoom >= 0);
          assert.ok((card.y + card.size / 2) * zoom <= 650 - 36 - 64 + 1e-7);
        }
      }
    }
  });
}

test('fit is based on actual packed height and can zoom below the old 60% floor', () => {
  assert.equal(getFitZoom(1200, 700, 1200, 2000), 0.3);
  assert.equal(getFitZoom(1200, 700, 1200, 300), 1);
  assert.equal(getFitZoom(600, 700, 1200, 300), 0.5);
});

test('a low-scoring image reaches the batch maximum when there is room', () => {
  const layout = layoutScoredImages([image('low', 1), image('high', 6)], 1200, { minSide: 80, maxSide: 224 });
  const layers = getImageLayers(layout.items, [], 'low');
  const sizes = getDisplaySizes(layout.items, layout.hoverSide, layers, ['low']);
  assert.equal(sizes.get('low'), 224);
  assert.equal(sizes.get('high'), 224);
});

test('custom dimension names use the same layout, rank and total rules', () => {
  const data = [{ id: 'one', scores: { contrast: 2, legibility: 6 } }, { id: 'two', scores: { contrast: 5, legibility: 2 } }];
  const { items } = layoutScoredImages(data, 1000, { minSide: 80, maxSide: 224 }, 'contrast', ['contrast', 'legibility']);
  assert.ok(items[0].stackOrder > items[1].stackOrder);
  assert.deepEqual(items.map(card => card.rank), [2, 1]);
  assert.ok(items.every(card => Number.isFinite(card.y)));
});
