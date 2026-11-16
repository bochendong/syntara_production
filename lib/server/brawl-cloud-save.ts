import { z } from 'zod';

import type { PrismaClient } from '@/lib/server/generated-prisma';

const MAX_POINTS = 1_000_000_000;
const counter = z.number().int().min(0).max(MAX_POINTS);
const key = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_:.-]*$/);
const list = z.array(key).max(450).default([]);
const counters = z.record(key, counter).default({});
const growth = z.record(key, z.number().int().min(0).max(5)).default({});
const saveSchema = z.object({
  pts: counter.default(0),
  heroes: list,
  arts: list,
  relics: list,
  seen: list,
  ach: list,
  skins: list,
  ults: list,
  weapons: list,
  unread: list,
  clearedDifficulties: list,
  top: z
    .array(z.object({ t: counter, h: key, d: key.default('easy') }))
    .max(5)
    .default([]),
  skinOn: z.record(key, z.union([key, z.literal('')])).default({}),
  growth,
  fragments: counters,
  itemLevels: counters,
  stat: z
    .object({
      runs: counter.default(0),
      kills: counter.default(0),
      wins: counter.default(0),
      hardWin: counter.default(0),
      pulls: counter.default(0),
      pity: z.number().int().min(0).max(79).default(0),
    })
    .default({ runs: 0, kills: 0, wins: 0, hardWin: 0, pulls: 0, pity: 0 }),
  best: counter.default(0),
});

type Save = z.infer<typeof saveSchema>;
const legacySchema = z.object({
  deviceId: z.string().uuid(),
  transferId: z.string().uuid().optional(),
  data: saveSchema,
});
export const brawlCloudActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('open'),
    account: z.string().min(1).max(200),
    legacy: legacySchema.optional(),
  }),
  z.object({
    action: z.literal('save'),
    account: z.string().min(1).max(200),
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    data: saveSchema,
  }),
]);
type Open = Extract<z.infer<typeof brawlCloudActionSchema>, { action: 'open' }>;
type Write = Extract<z.infer<typeof brawlCloudActionSchema>, { action: 'save' }>;

function maxEntries(current: Record<string, number>, legacy: Record<string, number>) {
  const merged = { ...current };
  for (const [id, value] of Object.entries(legacy))
    merged[id] = Math.max(Object.hasOwn(merged, id) ? merged[id] : 0, value);
  return merged;
}

const growthSize = (levels: Save['growth']) =>
  Object.values(levels).reduce((sum, level) => sum + level, 0);

function mergeLegacy(current: Save, legacy: Save, first: boolean, growthTouched: boolean): Save {
  if (first) return legacy;
  const merged = {
    ...current,
    growth:
      !growthTouched && growthSize(legacy.growth) > growthSize(current.growth)
        ? legacy.growth
        : current.growth,
    skinOn: { ...legacy.skinOn, ...current.skinOn },
    fragments: maxEntries(current.fragments, legacy.fragments),
    itemLevels: maxEntries(current.itemLevels, legacy.itemLevels),
    stat: {
      runs: Math.max(current.stat.runs, legacy.stat.runs),
      kills: Math.max(current.stat.kills, legacy.stat.kills),
      wins: Math.max(current.stat.wins, legacy.stat.wins),
      hardWin: Math.max(current.stat.hardWin, legacy.stat.hardWin),
      pulls: Math.max(current.stat.pulls, legacy.stat.pulls),
      pity: current.stat.pity,
    },
    best: Math.max(current.best, legacy.best),
  };
  const sets = [
    'heroes',
    'arts',
    'relics',
    'seen',
    'ach',
    'skins',
    'ults',
    'weapons',
    'clearedDifficulties',
  ] as const;
  for (const field of sets) merged[field] = [...new Set([...current[field], ...legacy[field]])];
  merged.unread = [...new Set([...current.unread, ...legacy.unread])];
  const best = new Map([...current.top, ...legacy.top].map((run) => [JSON.stringify(run), run]));
  merged.top = [...best.values()].sort((a, b) => b.t - a.t).slice(0, 5);
  return merged;
}

export async function openBrawlSave(db: PrismaClient, userId: string, input: Open) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const current = await tx.brawlCloudSave.findUnique({ where: { userId } });
    const account = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { brawlPracticePoints: true },
    });
    let data = saveSchema.parse(current?.data ?? {});
    const previousPoints = data.pts;
    let legacyBalance = current?.legacyBalance ?? 0;
    const imported = new Set(current?.imported ?? []);
    let transferred = 0;
    let importedLegacy = false;
    const legacy = input.legacy;
    if (legacy && !imported.has(legacy.deviceId)) {
      imported.add(legacy.deviceId);
      importedLegacy = true;
      const increase = Math.max(0, legacy.data.pts - legacyBalance);
      legacyBalance = Math.max(legacyBalance, legacy.data.pts);
      data = mergeLegacy(data, legacy.data, !current, current?.growthTouched ?? false);
      data.pts = previousPoints + increase;
      if (legacy.transferId && !imported.has(legacy.transferId)) {
        const receipt = await tx.brawlPointTransfer.findUnique({
          where: { userId_id: { userId, id: legacy.transferId } },
        });
        transferred = receipt?.points ?? 0;
        imported.add(legacy.transferId);
      }
    }
    const practicePoints = account.brawlPracticePoints + transferred;
    if (account.brawlPracticePoints)
      await tx.user.update({
        where: { id: userId },
        data: { brawlPracticePoints: { decrement: account.brawlPracticePoints } },
      });
    if (current && !practicePoints && !importedLegacy)
      return { revision: current.revision, data, practicePoints };
    data.pts = Math.min(MAX_POINTS, data.pts + practicePoints);
    const revision = (current?.revision ?? 0) + 1;
    const fields = { revision, data, legacyBalance, imported: [...imported] };
    await tx.brawlCloudSave.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
    return { revision, data, practicePoints };
  });
}

export async function writeBrawlSave(db: PrismaClient, userId: string, input: Write) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const current = await tx.brawlCloudSave.findUniqueOrThrow({ where: { userId } });
    const receipt = await tx.brawlCloudWrite.findUnique({
      where: { userId_id: { userId, id: input.id } },
    });
    if (receipt) return { kind: 'saved' as const, revision: receipt.revision };
    if (current.revision !== input.revision)
      return { kind: 'conflict' as const, revision: current.revision };
    const revision = current.revision + 1;
    const priorGrowth = saveSchema.parse(current.data).growth;
    const changedGrowth = [
      ...new Set([...Object.keys(priorGrowth), ...Object.keys(input.data.growth)]),
    ].some((id) => (priorGrowth[id] ?? 0) !== (input.data.growth[id] ?? 0));
    await tx.brawlCloudSave.update({
      where: { userId },
      data: { data: input.data, revision, growthTouched: current.growthTouched || changedGrowth },
    });
    await tx.brawlCloudWrite.create({ data: { userId, id: input.id, revision } });
    return { kind: 'saved' as const, revision };
  });
}
