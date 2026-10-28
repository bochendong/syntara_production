import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { createInkGlassMap, refractInkGlass } = await jiti.import(
  '../../apps/native/src/lib/ink-glass.ts',
);

test('glass sampling stays within its local backdrop at desktop, wrapped and retina sizes', () => {
  for (const [w, h, d] of [
    [812, 56, 1],
    [812, 56, 2],
    [812, 56, 1.5],
    [585, 104, 2],
    [60, 60, 2],
  ]) {
    const map = createInkGlassMap(w, h, d);
    assert.equal(map.source.length, map.width * map.height);
    assert.equal(map.alpha[0], 0);
    assert.equal(
      map.alpha[Math.floor(map.height / 2) * map.width + Math.floor(map.width / 2)],
      255,
    );
    for (const offset of map.source)
      assert.ok(offset >= 0 && offset + 3 < map.sampleWidth * map.sampleHeight * 4);
  }
});
test('curved rims refract inward and have opposing specular light rather than a colored border', () => {
  const map = createInkGlassMap(240, 56);
  const xOf = (i) => ((map.source[i] / 4) % map.sampleWidth) - map.padding;
  const yOf = (i) => Math.floor(map.source[i] / 4 / map.sampleWidth) - map.padding;
  const left = 28 * map.width + 2,
    right = 28 * map.width + 237;
  assert.ok(xOf(left) > 2);
  assert.ok(xOf(right) < 237);
  assert.ok(yOf(2 * map.width + 120) > 2);
  assert.ok(map.light[2 * map.width + 120] > 0);
  assert.ok(map.light[53 * map.width + 120] < 0);
});
test('live ink changes the optical result without mutating the answer pixels or obscuring icons', () => {
  const map = createInkGlassMap(240, 56);
  const paper = new Uint8ClampedArray(map.sampleWidth * map.sampleHeight * 4).fill(255);
  const result = new Uint8ClampedArray(map.width * map.height * 4);
  const i = 28 * map.width + 120;
  refractInkGlass(paper, map, result);
  const white = Array.from(result.slice(i * 4, i * 4 + 3));
  assert.deepEqual(white, [255, 255, 255]);
  const at = map.source[i];
  paper.set([16, 35, 71, 255], at);
  const before = paper.slice();
  refractInkGlass(paper, map, result);
  const blue = Array.from(result.slice(i * 4, i * 4 + 3));
  assert.ok(blue[0] < white[0] && blue[2] > blue[0]);
  assert.ok(
    blue.every((value) => value > 112),
    'neutral veil preserves contrast over dark ink',
  );
  assert.deepEqual(paper, before);
  assert.equal(result[3], 0, 'capsule corners stay transparent');
});

test('diffusion softens background ink while preserving its color and source data', async () => {
  const { diffuseInkGlass } = await jiti.import('../../apps/native/src/lib/ink-glass.ts');
  const w = 15,
    h = 15;
  const source = new Uint8ClampedArray(w * h * 4).fill(255);
  source.set([16, 35, 71, 255], (7 * w + 7) * 4);
  const before = source.slice(),
    scratch = new Uint8ClampedArray(source.length),
    output = new Uint8ClampedArray(source.length);
  diffuseInkGlass(source, w, h, 2, scratch, output);
  const center = (7 * w + 7) * 4,
    neighbor = (7 * w + 8) * 4;
  assert.ok(output[center] > source[center] && output[center] < 255);
  assert.ok(output[neighbor] < 255, 'ink softly influences nearby background');
  assert.ok(output[center + 2] > output[center]);
  assert.deepEqual(source, before);
  assert.equal(output[0], 255);
});
