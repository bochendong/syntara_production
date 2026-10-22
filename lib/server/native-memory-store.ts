import { z } from 'zod';

import type { PrismaClient } from '@/lib/server/generated-prisma';
import { upsertMemoryFact } from '@/lib/server/memory-fact-store';
import { resolveReadableStudyMemoryTarget } from '@/lib/server/study-memory-store';

/**
 * App（手机 / iPad / 电脑）自己写的学习记忆。网页端不读这个 namespace：
 * 网页的记忆页和网页 AI 都看不到，只在三端 App 之间同步。
 * 每门课一条 MemoryFact，里面是这门课全部 App 记忆和复习时间；按条目“较新的覆盖较旧的”合并。
 */
const NAMESPACE = 'syntara.native.memories';
const MAX_MEMORIES_PER_COURSE = 600;
const MAX_REVIEWS_PER_COURSE = 2000;

function courseKey(courseId: string): string {
  return `course:${courseId}`;
}

export const nativeMemorySchema = z.object({
  id: z.string().trim().min(1).max(200),
  courseId: z.string().trim().max(200).nullable(),
  notebookId: z.string().trim().max(200).nullable(),
  targetType: z.string().trim().max(40),
  scope: z.string().trim().max(40),
  kind: z.string().trim().max(80),
  status: z.string().trim().max(40),
  source: z.string().trim().max(80),
  /** 在 App 哪条对话里记下的；那条对话删掉时，App 会推一条已归档的记忆过来。 */
  conversationId: z.string().trim().max(200).nullable().optional(),
  title: z.string().max(300),
  text: z.string().max(4000),
  reason: z.string().max(2000).nullable(),
  question: z.string().max(4000).nullable(),
  sourceReferences: z.array(z.string().max(300)).max(40),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

export type NativeMemory = z.infer<typeof nativeMemorySchema>;

export const nativeMemorySyncSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  memories: z.array(nativeMemorySchema).max(MAX_MEMORIES_PER_COURSE).default([]),
  /** 记忆 id → 最近一次在 App 上复习的时间。 */
  reviews: z
    .record(z.string().max(200), z.number().int().min(0))
    .refine((value) => Object.keys(value).length <= MAX_REVIEWS_PER_COURSE * 2)
    .default({}),
});

export type NativeMemorySync = z.infer<typeof nativeMemorySyncSchema>;

type StoredValue = { memories: NativeMemory[]; reviews: Record<string, number> };

function storedValue(value: unknown): StoredValue {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const memories = Array.isArray(record.memories)
    ? record.memories.flatMap((item) => {
        const parsed = nativeMemorySchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const reviews: Record<string, number> = {};
  if (record.reviews && typeof record.reviews === 'object') {
    for (const [id, at] of Object.entries(record.reviews as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) reviews[id] = at;
    }
  }
  return { memories, reviews };
}

async function loadStored(prisma: PrismaClient, userId: string, courseId: string) {
  const fact = await prisma.memoryFact.findFirst({
    where: {
      ownerId: userId,
      scopeType: 'user',
      scopeId: null,
      namespace: NAMESPACE,
      key: courseKey(courseId),
      status: 'active',
    },
    orderBy: { updatedAt: 'desc' },
    select: { valueJson: true },
  });
  return storedValue(fact?.valueJson);
}

/** 两边按条目合并：updatedAt 新的胜出；复习时间取较晚的。 */
export function mergeNativeMemories(base: StoredValue, incoming: StoredValue): StoredValue {
  const byId = new Map(base.memories.map((memory) => [memory.id, memory]));
  for (const memory of incoming.memories) {
    const existing = byId.get(memory.id);
    if (!existing || memory.updatedAt > existing.updatedAt) byId.set(memory.id, memory);
  }
  // 复习时间也包括从网页同步下来的记忆，所以不限于这里存的 App 记忆。
  const reviews = { ...base.reviews };
  for (const [id, at] of Object.entries(incoming.reviews)) {
    if (at > (reviews[id] ?? 0)) reviews[id] = at;
  }
  const memories = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_MEMORIES_PER_COURSE);
  return {
    memories,
    reviews: Object.fromEntries(
      Object.entries(reviews)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_REVIEWS_PER_COURSE),
    ),
  };
}

export async function readNativeMemories(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<StoredValue | null> {
  const target = await resolveReadableStudyMemoryTarget(prisma, userId, 'course', courseId);
  if (!target) return null;
  return loadStored(prisma, userId, courseId);
}

/** App 推上来的记忆和服务器上的合并后存回，返回合并结果给 App。 */
export async function syncNativeMemories(
  prisma: PrismaClient,
  userId: string,
  input: NativeMemorySync,
): Promise<StoredValue | null> {
  const target = await resolveReadableStudyMemoryTarget(prisma, userId, 'course', input.courseId);
  if (!target) return null;
  const stored = await loadStored(prisma, userId, input.courseId);
  const merged = mergeNativeMemories(stored, {
    memories: input.memories.map((memory) => ({ ...memory, courseId: input.courseId })),
    reviews: input.reviews,
  });
  if (JSON.stringify(merged) !== JSON.stringify(stored)) {
    await upsertMemoryFact({
      prisma,
      ownerId: userId,
      scopeType: 'user',
      namespace: NAMESPACE,
      key: courseKey(input.courseId),
      valueJson: merged,
      confidence: 1,
      source: 'native-app',
      sourceRef: { courseId: input.courseId, count: merged.memories.length },
    });
  }
  return merged;
}
