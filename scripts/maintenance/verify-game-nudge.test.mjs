import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const nudge = jiti('../../apps/native/src/lib/game-nudge.ts');
const DAY = '2026-11-17';
const study = jiti('../../lib/server/brawl-study.ts');
const notify = jiti('../../apps/native/src/lib/practice-game-notify.ts');
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

const status = (over = {}) => ({
  gamePoints: 0,
  pendingPoints: 0,
  freeDraw: false,
  claimable: [],
  streak: 1,
  ...over,
});

test('practice notices stay quiet on the first status', () => {
  const events = notify.practiceGameEvents(null, status({ pendingPoints: 40, freeDraw: true }));
  assert.deepEqual(events, { gained: 0, banner: null, reward: null });
});

test('practice notices report the real server gain and the draw threshold', () => {
  const before = status({ gamePoints: 20, pendingPoints: 5 });
  const small = notify.practiceGameEvents(before, status({ gamePoints: 20, pendingPoints: 8 }));
  assert.deepEqual([small.gained, small.banner], [3, null]);
  const enough = notify.practiceGameEvents(before, status({ gamePoints: 20, pendingPoints: 10 }));
  assert.equal(enough.gained, 5);
  assert.equal(enough.banner?.kind, 'draw');
  assert.equal(enough.banner?.title, '够抽一次了！');
  const ten = notify.practiceGameEvents(
    status({ gamePoints: 265 }),
    status({ gamePoints: 265, pendingPoints: 8 }),
  );
  assert.equal(ten.banner?.kind, 'ten');
});

test('free draw beats the points banner and new rewards pop once', () => {
  const reward = { id: 'scholar_s', days: 7, name: '学霸 · 晨读之星', label: '限定皮肤' };
  const events = notify.practiceGameEvents(
    status({ gamePoints: 25 }),
    status({ gamePoints: 25, pendingPoints: 5, freeDraw: true, claimable: [reward] }),
  );
  assert.equal(events.banner?.kind, 'free');
  assert.equal(events.reward?.name, reward.name);
  const again = notify.practiceGameEvents(
    status({ claimable: [reward], freeDraw: true }),
    status({ claimable: [reward], freeDraw: true }),
  );
  assert.deepEqual([again.banner, again.reward], [null, null]);
});

test('the points bar counts problems left to the next draw', () => {
  assert.equal(notify.gameDrawProgress(22).label, '再 2 题就能抽一次');
  assert.equal(notify.gameDrawProgress(0).label, '再 6 题就能抽一次');
  assert.equal(notify.gameDrawProgress(65).label, '能抽 2 次 · 再 5 题多一次');
  const gacha = /const GACHA = \{ one: (\d+), ten: (\d+)/.exec(gameSource);
  assert.deepEqual(
    [notify.GAME_SINGLE_DRAW, notify.GAME_TEN_DRAW],
    [Number(gacha?.[1]), Number(gacha?.[2])],
  );
});
