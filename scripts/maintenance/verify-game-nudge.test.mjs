import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const nudge = jiti('../../apps/native/src/lib/game-nudge.ts');
const DAY = '2026-11-17';
const minutes = (count) => count * 60_000;

test('first prompt needs 25 active minutes, later ones 40', () => {
  let state = nudge.addGameNudgeActiveTime(nudge.freshGameNudgeState(DAY), DAY, minutes(24));
  assert.equal(nudge.gameNudgeDue(state, DAY), false);
  state = nudge.addGameNudgeActiveTime(state, DAY, minutes(1));
  assert.equal(nudge.gameNudgeDue(state, DAY), true);
  state = nudge.markGameNudgeShown(state, DAY);
  assert.deepEqual([state.activeMs, state.shown, state.hint], [0, 1, true]);
  state = nudge.addGameNudgeActiveTime(state, DAY, minutes(39));
  assert.equal(nudge.gameNudgeDue(state, DAY), false);
  assert.equal(nudge.gameNudgeDue(nudge.addGameNudgeActiveTime(state, DAY, minutes(1)), DAY), true);
});

test('dismissing mutes the rest of the day and the daily limit holds', () => {
  let state = nudge.addGameNudgeActiveTime(nudge.freshGameNudgeState(DAY), DAY, minutes(90));
  assert.equal(nudge.gameNudgeDue(nudge.markGameNudgeDismissed(state, DAY), DAY), false);
  for (let shown = 0; shown < nudge.GAME_NUDGE_DAILY_LIMIT; shown += 1) {
    assert.equal(nudge.gameNudgeDue(state, DAY), true);
    state = nudge.addGameNudgeActiveTime(nudge.markGameNudgeShown(state, DAY), DAY, minutes(90));
  }
  assert.equal(nudge.gameNudgeDue(state, DAY), false);
});

test('playing restarts the timer and a new day starts clean', () => {
  let state = nudge.markGameNudgeShown(
    nudge.addGameNudgeActiveTime(nudge.freshGameNudgeState(DAY), DAY, minutes(30)),
    DAY,
  );
  state = nudge.markGamePlayed(nudge.addGameNudgeActiveTime(state, DAY, minutes(20)), DAY);
  assert.deepEqual([state.activeMs, state.hint, state.shown], [0, false, 1]);
  const muted = nudge.markGameNudgeDismissed(state, DAY);
  const next = nudge.addGameNudgeActiveTime(muted, '2026-11-18', minutes(25));
  assert.deepEqual([next.shown, next.muted], [0, false]);
  assert.equal(nudge.gameNudgeDue(next, '2026-11-18'), true);
});
