import assert from 'node:assert/strict';
import test from 'node:test';
import { campusStudentScale } from '../../apps/native/public/games/sandbox-brawl/campus.js';
import {
  advanceScholar,
  poseScholar,
} from '../../apps/native/public/games/sandbox-brawl/scholar.js';

test('a planted shoe stays in place as the body advances, then the other shoe takes over', () => {
  const speed = 5.7;
  for (const [foot, start] of [
    ['footL', 0.12],
    ['footR', 0.62],
  ]) {
    const actor = { scholarGait: 1, scholarPhase: start * 2 * Math.PI };
    const before = poseScholar(actor, 1)[foot].elements[14] * campusStudentScale;
    const travel = speed / 30;
    advanceScholar(actor, travel, 0, 1 / 30, speed);
    const after = poseScholar(actor, 1 + 1 / 30)[foot].elements[14] * campusStudentScale + travel;
    assert.ok(Math.abs(after - before) < 1e-6);
    const otherFoot = foot === 'footL' ? 'footR' : 'footL';
    const bones = poseScholar(actor, 1 + 1 / 30);
    assert.ok(bones[otherFoot].elements[13] > bones[foot].elements[13] + 0.08);
  }
});

test('blocked travel settles to idle without advancing the stride, across frame rates', () => {
  for (const rate of [30, 60, 120]) {
    const actor = { scholarGait: 1, scholarPhase: 0.7, scholarYaw: Math.PI - 0.01 };
    const dt = 1 / rate;
    advanceScholar(actor, 0, -Math.PI + 0.01, dt, 5.7);
    assert.ok(actor.scholarTurn > 0 && actor.scholarTurn < 0.05);
    for (let i = 1; i < rate; i++) advanceScholar(actor, 0, actor.scholarYaw, dt, 5.7);
    assert.equal(actor.scholarGait, 0);
    assert.equal(actor.scholarPhase, 0.7);
    assert.ok(actor.scholarIdle > 0.9);
  }
});

test('the page turns on the cover hinge, and starting a shot preserves the current reading pose', () => {
  const actor = { scholarIdle: 2.2 };
  const reading = poseScholar(actor, 4);
  const cover = reading.cover.clone();
  assert.deepEqual(reading.page.elements.slice(12), cover.elements.slice(12));
  assert.notDeepEqual(reading.page.elements.slice(0, 12), cover.elements.slice(0, 12));
  Object.assign(actor, { scholarIdle: 0, scholarInterruptedIdle: 2.2, scholarShotAt: 4 });
  const interrupted = poseScholar(actor, 4).cover;
  assert.ok(interrupted.elements.every((value, i) => Math.abs(value - cover.elements[i]) < 0.0001));
});
