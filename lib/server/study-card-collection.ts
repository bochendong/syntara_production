import { randomInt } from 'node:crypto';
import type { Prisma } from './generated-prisma';
import { prisma } from './prisma';
import {
  CARD_RULES,
  STUDY_CARDS,
  rollStudyCard,
  type CardCollection,
  type CardDrawResponse,
  type CardRarity,
} from '../study-cards/catalog';

type Db = Prisma.TransactionClient;
export class CardCollectionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function passedQuestions(db: Db, userId: string) {
  // Count distinct successfully submitted questions, never test runs or answer-view snapshots.
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "problemId") AS count FROM "NotebookProblemAttempt"
    WHERE "userId" = ${userId} AND "status" = 'passed' AND "kind" IN ('submit', 'answer')
      AND COALESCE("resultJson"->>'event', '') NOT IN ('solution_viewed', 'hidden_tests_viewed', 'answer_reset')`;
  return Number(rows[0]?.count ?? 0);
}
function inventory(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, n]) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0,
    ),
  ) as Record<string, number>;
}
async function read(db: Db, userId: string): Promise<CardCollection> {
  const [album, passed] = await Promise.all([
    db.studyCardAlbum.findUnique({ where: { userId } }),
    passedQuestions(db, userId),
  ]);
  const totalDraws = album?.totalDraws ?? 0;
  return {
    owned: inventory(album?.owned),
    favorites: album?.favorites ?? [],
    totalDraws,
    sinceSR: album?.sinceSR ?? 0,
    sinceSSR: album?.sinceSSR ?? 0,
    passedQuestions: passed,
    availableDraws: Math.max(0, Math.floor(passed / CARD_RULES.questionsPerDraw) - totalDraws),
    nextDrawProgress: passed % CARD_RULES.questionsPerDraw,
  };
}
export function getStudyCardCollection(userId: string) {
  return read(prisma, userId);
}
async function lockAlbum(db: Db, userId: string) {
  // Native conflict handling also serializes simultaneous first-time album creation.
  await db.$executeRaw`INSERT INTO "StudyCardAlbum" ("userId", "updatedAt")
    VALUES (${userId}, CURRENT_TIMESTAMP) ON CONFLICT ("userId") DO NOTHING`;
  await db.$queryRaw`SELECT "userId" FROM "StudyCardAlbum" WHERE "userId" = ${userId} FOR UPDATE`;
}
export async function drawStudyCard(userId: string, requestId: string): Promise<CardDrawResponse> {
  return prisma.$transaction(
    async (db) => {
      await lockAlbum(db, userId);
      const previous = await db.studyCardDraw.findUnique({
        where: { userId_requestId: { userId, requestId } },
      });
      if (previous)
        return {
          collection: await read(db, userId),
          draw: {
            id: previous.id,
            cardId: previous.cardId,
            copies: previous.copies,
            isNew: previous.copies === 1,
            rarity: previous.rarity as CardRarity,
          },
        };
      const state = await read(db, userId);
      if (!state.availableDraws)
        throw new CardCollectionError(409, '再通过几道新题，就能获得下一次抽卡。');
      const roll = () => randomInt(0, 1_000_000) / 1_000_000;
      const picked = rollStudyCard(state.sinceSR, state.sinceSSR, roll(), roll());
      const copies = (state.owned[picked.card.id] ?? 0) + 1;
      const owned = { ...state.owned, [picked.card.id]: copies };
      await db.studyCardAlbum.update({
        where: { userId },
        data: {
          owned,
          totalDraws: { increment: 1 },
          sinceSR: picked.sinceSR,
          sinceSSR: picked.sinceSSR,
        },
      });
      const saved = await db.studyCardDraw.create({
        data: { userId, requestId, cardId: picked.card.id, rarity: picked.card.rarity, copies },
      });
      return {
        collection: {
          ...state,
          owned,
          totalDraws: state.totalDraws + 1,
          availableDraws: state.availableDraws - 1,
          sinceSR: picked.sinceSR,
          sinceSSR: picked.sinceSSR,
        },
        draw: {
          id: saved.id,
          cardId: picked.card.id,
          copies,
          isNew: copies === 1,
          rarity: picked.card.rarity,
        },
      };
    },
    { maxWait: 10000, timeout: 15000 },
  );
}
export async function favoriteStudyCard(userId: string, cardId: string, favorite: boolean) {
  if (!STUDY_CARDS.some((card) => card.id === cardId))
    throw new CardCollectionError(400, '卡片不存在。');
  return prisma.$transaction(async (db) => {
    await lockAlbum(db, userId);
    const state = await read(db, userId);
    if (!state.owned[cardId])
      throw new CardCollectionError(400, '收集到这张卡片后，才能放进展柜。');
    const favorites = state.favorites.filter((id) => id !== cardId);
    if (favorite) favorites.push(cardId);
    if (favorites.length > 6) throw new CardCollectionError(400, '展柜最多放 6 张，先取下一张吧。');
    await db.studyCardAlbum.update({ where: { userId }, data: { favorites } });
    return { ...state, favorites };
  });
}
