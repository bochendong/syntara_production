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

const study = jiti('../../lib/server/brawl-study.ts');
const gameSource = (await import('node:fs')).readFileSync(
  new URL('../../apps/native/public/games/sandbox-brawl/game.js', import.meta.url),
  'utf8',
);

test('study streaks keep yesterday alive, break on a gap and remember the best run', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-15', '2026-11-16'];
  assert.deepEqual(study.brawlStudyStreaks(days, '2026-11-16'), {
    streak: 2,
    best: 4,
    studiedToday: true,
  });
  assert.equal(study.brawlStudyStreaks(days, '2026-11-17').streak, 2);
  assert.equal(study.brawlStudyStreaks(days, '2026-11-18').streak, 0);
  assert.equal(study.brawlStudyStreaks(['2026-02-28', '2026-03-01'], '2026-03-01').streak, 2);
  assert.deepEqual(study.brawlStudyStreaks([], '2026-11-16'), {
    streak: 0,
    best: 0,
    studiedToday: false,
  });
});

test('study days follow the student time zone and bad zones fall back', () => {
  const lateEvening = new Date('2026-11-17T03:30:00Z');
  assert.equal(study.brawlStudyDay(lateEvening, 'America/Toronto'), '2026-11-16');
  assert.equal(study.brawlStudyDay(lateEvening, 'Asia/Shanghai'), '2026-11-17');
  assert.equal(study.brawlStudyTimeZone("x'; DROP"), 'America/Toronto');
  assert.equal(study.brawlStudyTimeZone('Not/AZone'), 'America/Toronto');
  assert.equal(study.brawlStudyTimeZone('America/Vancouver'), 'America/Vancouver');
});

test('every streak reward exists in the game with the same day count', () => {
  for (const reward of study.BRAWL_STREAK_REWARDS) {
    const line = gameSource
      .split('\n')
      .find((text) => text.trimStart().startsWith(`${reward.id}:`));
    assert.ok(line, `${reward.id} is defined in game.js`);
    assert.match(line, new RegExp(`study: ${reward.days}\\b`));
  }
});

test('App prompts list only what is still unclaimed', () => {
  const base = { day: DAY, streak: 7, best: 7, passedToday: true, earned: [] };
  const fresh = study.brawlStudyPrompts(base, null);
  assert.deepEqual(
    fresh.claimable.map((reward) => reward.id),
    ['attendance', 'scholar_s'],
  );
  assert.equal(fresh.freeDraw, true);
  assert.equal(fresh.next.days, 14);
  const claimed = study.brawlStudyPrompts(base, {
    relics: ['attendance'],
    skins: ['scholar_s'],
    study: { freeDay: DAY },
  });
  assert.deepEqual([claimed.claimable.length, claimed.freeDraw], [0, false]);
});

test('each reward and each free draw is prompted once', () => {
  const status = {
    day: DAY,
    streak: 3,
    pendingPoints: 0,
    claimable: [{ id: 'attendance', days: 3, label: '限定饰品' }],
    freeDraw: true,
    next: { days: 7, label: '限定皮肤' },
  };
  let seen = { rewards: [], drawDay: '' };
  const first = nudge.nextGameStudyPrompt(status, seen);
  assert.deepEqual(
    [first.kind, first.eyebrow, first.title],
    ['reward', '连续学习 3 天', '去领限定饰品'],
  );
  seen = nudge.markGameStudyPromptSeen(status, seen);
  assert.equal(nudge.nextGameStudyPrompt(status, seen), null);
  assert.equal(
    nudge.nextGameStudyPrompt({ ...status, claimable: [], day: '2026-11-18' }, seen).kind,
    'draw',
  );
  assert.equal(nudge.gameStreakHint(status), '连续学习 3 天 · 再 4 天解锁限定皮肤');
  assert.equal(nudge.gameStreakHint({ ...status, next: null }), null);
});
