import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url);
const catalog = await jiti.import('../../lib/study-cards/catalog.ts');
const { STUDY_CARDS, rollStudyCard, cardLevel, collectorLevel } = catalog;
test('every series has distinct R/SR/SSR artwork and the 40 original R cards remain', () => {
  assert.equal(STUDY_CARDS.length, 100);
  assert.equal(new Set(STUDY_CARDS.map((card) => card.id)).size, 100);
  assert.equal(STUDY_CARDS.filter((card) => card.rarity === 'R').length, 80);
  assert.equal(
    STUDY_CARDS.filter((card) => card.id.startsWith('r-') && card.rarity === 'R').length,
    40,
  );
  for (const [series, count] of [
    ['everyday', 44],
    ['mbti', 20],
    ['zodiac', 16],
    ['dream', 10],
    ['city', 10],
  ]) {
    const cards = STUDY_CARDS.filter((c) => c.series === series);
    assert.equal(cards.length, count);
    assert.deepEqual(new Set(cards.map((c) => c.rarity)), new Set(['R', 'SR', 'SSR']));
    assert.equal(new Set(cards.map((c) => `${c.art}:${c.index}`)).size, cards.length);
  }
  for (const card of STUDY_CARDS) {
    const path = card.artColumns
      ? `apps/native/src/assets/study-cards/${card.art}.png`
      : `apps/native/src/assets/class-standing/${card.art}.webp`;
    assert.ok(existsSync(path), `${card.id} has a real artwork file`);
    if (card.artColumns) assert.ok(card.index < card.artColumns * card.artRows);
  }
});
test('base rate boundaries and both pity counters apply without overriding natural SSR', () => {
  const counts = { R: 0, SR: 0, SSR: 0 };
  for (let n = 0; n < 10000; n++) counts[rollStudyCard(0, 0, n / 10000, 0.9).card.rarity]++;
  assert.deepEqual(counts, { R: 7500, SR: 2200, SSR: 300 });
  assert.equal(rollStudyCard(9, 12, 0.99, 0.2).card.rarity, 'SR');
  assert.equal(rollStudyCard(9, 29, 0.99, 0.2).card.rarity, 'SSR');
  assert.equal(rollStudyCard(9, 12, 0.02, 0.2).card.rarity, 'SSR');
  assert.equal(rollStudyCard(0, 0, 0.25, 0.99).card.rarity, 'R');
  assert.equal(rollStudyCard(9, 12, 0.99, 0.2).sinceSSR, 13);
  assert.equal(rollStudyCard(9, 29, 0.99, 0.2).sinceSR, 0);
  assert.throws(() => rollStudyCard(0, 0, 1, 0));
  assert.throws(() => rollStudyCard(0, 0, NaN, 0));
});
test('duplicate copies and unique-card milestones advance the displayed levels', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 6, 7, 10, 11, 99].map(cardLevel),
    [0, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  );
  assert.deepEqual(
    [0, 5, 15, 30, 60].map((n) => collectorLevel(n).level),
    [1, 2, 3, 4, 5],
  );
});
test(
  'real PostgreSQL: migration, distinct rewards, concurrency, replay, duplicates, and account isolation',
  { skip: !process.env.STUDY_CARD_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.STUDY_CARD_TEST_DATABASE_URL);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/study_cards_qa');
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: url.href } } });
    const source = ts.transpileModule(readFileSync('lib/server/study-card-collection.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', source)(
      (id) =>
        id === './prisma'
          ? { prisma: db }
          : id === '../study-cards/catalog'
            ? catalog
            : id === 'node:crypto'
              ? { randomInt: () => 500000 }
              : require(id),
      mod,
      mod.exports,
    );
    const api = mod.exports;
    const suffix = randomUUID();
    const userA = `a-${suffix}`,
      userB = `b-${suffix}`,
      userC = `c-${suffix}`;
    try {
      await db.$executeRaw`INSERT INTO "User" (id) VALUES (${userA}),(${userB}),(${userC})`;
      for (const [user, total] of [
        [userA, 15],
        [userB, 5],
      ]) {
        await db.$executeRaw`INSERT INTO "NotebookProblemAttempt" (id,"userId","problemId",status,kind,"resultJson") SELECT ${user} || '-attempt-' || n, ${user}, 'q-' || n, 'passed', 'answer','{}'::jsonb FROM generate_series(1,${total}::integer) n`;
      }
      await db.$executeRaw`INSERT INTO "NotebookProblemAttempt" (id,"userId","problemId",status,kind,"resultJson") VALUES (${userB} || '-repeat',${userB},'q-1','passed','answer','{}'),(${userB} || '-run',${userB},'run-only','passed','run','{}'),(${userB} || '-view',${userB},'view-only','passed','answer','{"event":"solution_viewed"}')`;
      assert.equal((await api.getStudyCardCollection(userB)).availableDraws, 1);
      assert.equal((await api.getStudyCardCollection(userB)).passedQuestions, 5);
      const requestId = randomUUID();
      const replayed = await Promise.all(
        Array.from({ length: 8 }, () => api.drawStudyCard(userB, requestId)),
      );
      assert.equal(new Set(replayed.map((r) => r.draw.id)).size, 1);
      assert.equal((await api.getStudyCardCollection(userB)).totalDraws, 1);
      const raced = await Promise.allSettled(
        Array.from({ length: 10 }, () => api.drawStudyCard(userA, randomUUID())),
      );
      assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 3);
      for (const result of raced) {
        if (result.status === 'rejected') assert.equal(result.reason.status, 409);
      }
      const state = await api.getStudyCardCollection(userA);
      assert.equal(state.totalDraws, 3);
      assert.equal(state.availableDraws, 0);
      assert.equal(Object.values(state.owned)[0], 3);
      assert.equal(state.sinceSR, 3);
      assert.equal(state.sinceSSR, 3);
      assert.equal((await api.getStudyCardCollection(userC)).totalDraws, 0);
      await assert.rejects(api.drawStudyCard(userC, requestId), /再通过/);
      const card = Object.keys(state.owned)[0];
      assert.deepEqual((await api.favoriteStudyCard(userA, card, true)).favorites, [card]);
      await assert.rejects(api.favoriteStudyCard(userC, card, true), /收集到/);
      assert.deepEqual((await api.favoriteStudyCard(userA, card, false)).favorites, []);
      assert.equal(await db.studyCardDraw.count({ where: { userId: userA } }), 3);
      // Simultaneous additions cannot overfill the six-card display cabinet.
      const displayCards = STUDY_CARDS.slice(0, 7).map((c) => c.id);
      await db.studyCardAlbum.update({
        where: { userId: userA },
        data: { owned: Object.fromEntries(displayCards.map((id) => [id, 1])) },
      });
      const additions = await Promise.allSettled(
        displayCards.map((id) => api.favoriteStudyCard(userA, id, true)),
      );
      assert.equal(additions.filter((r) => r.status === 'fulfilled').length, 6);
      assert.equal((await api.getStudyCardCollection(userA)).favorites.length, 6);
    } finally {
      await db.$disconnect();
    }
  },
);
