import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import {
  CLASS_STANDING_ILLUSTRATIONS,
  selectStandingIllustration,
  standingArtState,
} from '../../apps/native/src/components/problem-bank/class-standing-art.ts';

const base = {
  courseId: 'art-check-course',
  period: 'week',
  scope: 'class',
  className: null,
  size: 23,
  rank: 9,
  metrics: {
    solved: { me: 12, average: 9, top: 30, max: 100 },
    firstTry: { me: 0.62, average: 0.55, top: 0.91, max: null },
    streak: { me: 3, average: 2, top: 14, max: null },
    chapters: { me: 4, average: 3, top: 8, max: 12 },
  },
  hint: null,
  generatedAt: 0,
};
const start = {
  ...base,
  rank: 1,
  metrics: { ...base.metrics, solved: { ...base.metrics.solved, me: 0 } },
};
const leader = { ...base, rank: 1 };
assert.equal(
  standingArtState(start, true),
  'start',
  'an empty start is not treated as first place',
);
assert.equal(standingArtState(base, false), 'practice');
assert.equal(standingArtState(leader, false), 'leader');
assert.equal(
  standingArtState(leader, true),
  'progress',
  'new progress is acknowledged before the leading-state reminder',
);
assert.equal(
  standingArtState(base, true),
  'progress',
  'more solved problems count even when rank is unchanged',
);

assert.equal(CLASS_STANDING_ILLUSTRATIONS.length, 40);
assert.equal(new Set(CLASS_STANDING_ILLUSTRATIONS.map((item) => item.id)).size, 40);
assert.equal(new Set(CLASS_STANDING_ILLUSTRATIONS.map((item) => item.quote)).size, 40);
const morning = new Date(2026, 10, 5, 0, 1);
const evening = new Date(2026, 10, 5, 23, 59);
assert.equal(
  selectStandingIllustration(base, false, morning).id,
  selectStandingIllustration(base, false, evening).id,
  'artwork is stable throughout the local day',
);
const reached = new Set();
const negativeForStart = new Set([
  '03-honesty',
  '12-time-wastes-me',
  '21-no-self-deception',
  '29-ignorance-confidence',
  '31-highest-throne',
  '33-wise-fool',
]);
for (let day = 0; day < 400; day += 1) {
  const date = new Date(2026, 0, 1 + day, 12);
  for (const [standing, hasProgress] of [
    [start, false],
    [base, false],
    [base, true],
    [leader, false],
  ]) {
    const item = selectStandingIllustration(standing, hasProgress, date);
    reached.add(item.id);
    if (standing === start)
      assert.ok(!negativeForStart.has(item.id), 'a fresh start gets an inviting scene');
  }
}
assert.equal(reached.size, 40, 'all approved images participate in the rotation');
let totalBytes = 0;
for (const item of CLASS_STANDING_ILLUSTRATIONS) {
  assert.ok(item.quote && item.attribution && item.source.startsWith('https://') && item.alt);
  const url = new URL(
    `../../apps/native/src/assets/class-standing/${item.id}.webp`,
    import.meta.url,
  );
  const bytes = await readFile(url);
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  const size = (await stat(url)).size;
  assert.ok(size < 500_000, `${item.id} should load as a card asset`);
  totalBytes += size;
}
console.log(
  JSON.stringify({ ok: true, illustrations: 40, reachableIllustrations: reached.size, totalBytes }),
);
