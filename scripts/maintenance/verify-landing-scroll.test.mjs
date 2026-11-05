import assert from 'node:assert/strict';
import test from 'node:test';
import { createWheelGesture, swipeDirection } from '../../components/home/world/scroll-gesture.ts';

test('one wheel gesture advances once, including its inertial tail', () => {
  const step = createWheelGesture();
  assert.equal(step(10, 0, false), 0);
  assert.equal(step(16, 16, false), 1);
  for (let time = 32; time < 4000; time += 100) assert.equal(step(30, time, time < 3000), 0);
  assert.equal(step(30, 4300, false), 1);
});

test('a gesture started during navigation cannot advance when the animation ends', () => {
  const step = createWheelGesture();
  assert.equal(step(120, 0, true), 0);
  assert.equal(step(40, 150, false), 0);
  assert.equal(step(-40, 500, false), -1);
});

test('direction changes do not accumulate opposite deltas or turn jitter into a step', () => {
  const step = createWheelGesture();
  assert.equal(step(15, 0, false), 0);
  assert.equal(step(-15, 16, false), 0);
  assert.equal(step(-15, 32, false), -1);
  assert.equal(step(120, 40, false), 0);
  assert.equal(step(24, 300, false), 1);
});

test('touch navigation requires a deliberate vertical swipe', () => {
  assert.equal(swipeDirection(0, -100), 1);
  assert.equal(swipeDirection(8, 100), -1);
  assert.equal(swipeDirection(100, -60), 0);
  assert.equal(swipeDirection(0, -20), 0);
  assert.equal(swipeDirection(0, 0), 0);
});
