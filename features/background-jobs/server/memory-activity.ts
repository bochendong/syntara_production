import type { Prisma } from '@/lib/server/generated-prisma';
import type { MemoryJobActivity } from '../domain/memory-activity';
import { type JobDb, unpackResult } from './store';

const select = {
  id: true,
  courseId: true,
  kind: true,
  status: true,
  attempts: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  result: true,
} satisfies Prisma.BackgroundJobSelect;

type MemoryJobRow = Prisma.BackgroundJobGetPayload<{ select: typeof select }>;

type MemoryWriteResult = {
  notes?: string[];
  updates?: Array<{ title: string; text: string; operation: 'created' | 'updated' }>;
  summary?: string;
  conversationId?: string;
  skipped?: string;
};
type LegacyMemoryContent = {
  notes: Map<string, { title: string; text: string }>;
  summaries: Map<string, string>;
};

/** Show committed memory content, never input prompts, evidence excerpts, or provider errors. */
export function memoryJobActivity(
  job: MemoryJobRow,
  legacy?: LegacyMemoryContent,
): MemoryJobActivity {
  const conversation = job.kind === 'conversation-memory';
  const activity: MemoryJobActivity = {
    id: job.id,
    courseId: job.courseId,
    status: 'queued',
    title: job.attempts ? '记忆整理等待重试' : '学习记忆等待整理',
    description: job.attempts
      ? '这次整理暂未完成，系统会自动重试。你可以继续学习。'
      : '新的学习信息已收到，稍后会整理需要记住的内容。',
    chips: [conversation ? '课程对话' : '学习互动'],
    createdAt: job.createdAt.getTime(),
    updatedAt: job.updatedAt.getTime(),
  };
  if (job.status === 'queued') return activity;
  if (job.status === 'running') {
    return {
      ...activity,
      status: 'running',
      title: '正在整理学习记忆',
      description: '正在核对这次互动中的学习信息，确认哪些内容值得记住。',
    };
  }
  activity.finishedAt = (job.completedAt ?? job.updatedAt).getTime();
  if (job.status === 'failed') {
    return {
      ...activity,
      status: 'failed',
      title: '学习记忆整理未完成',
      description: '多次尝试后仍未完成这次整理，原有记忆不受影响。',
    };
  }
  const result = job.result ? unpackResult<MemoryWriteResult>(job.result) : null;
  if (job.status !== 'completed' || !result) {
    return {
      ...activity,
      status: 'failed',
      title: '学习记忆结果暂不可用',
      description: '暂时无法确认这次记忆更新的结果。',
    };
  }
  const count = result.notes?.length ?? 0;
  if (!result.skipped && (count || result.conversationId)) {
    const updates =
      result.updates?.map((note) => ({
        ...note,
        label: note.operation === 'created' ? '新增' : '更新',
      })) ??
      (result.notes ?? []).flatMap((id) => {
        const note = legacy?.notes.get(id);
        // Older jobs only saved IDs: do not present today's text as a historical snapshot.
        return note ? [{ ...note, label: '当前内容' }] : [];
      });
    const summary =
      result.summary || (result.conversationId && legacy?.summaries.get(result.conversationId));
    return {
      ...activity,
      status: 'completed',
      title:
        updates.length === 1
          ? `${updates[0].label} · ${updates[0].title}`
          : count
            ? `已更新 ${count} 条学习记忆`
            : '对话摘要已更新',
      description: updates.length
        ? updates
            .map((note) =>
              updates.length === 1 ? note.text : `${note.label} · ${note.title}\n${note.text}`,
            )
            .join('\n\n')
        : summary
          ? `${result.summary ? '记住的对话要点' : '当前对话摘要'}：\n${summary}`
          : '这条历史记录只保存了更新结果，具体内容已不可用。',
    };
  }
  return {
    ...activity,
    status: 'skipped',
    title: '本次没有新增记忆',
    description:
      result.skipped === 'source-changed'
        ? '对话内容已变化，这次整理结果没有写入。'
        : result.skipped === 'already-summarized'
          ? '这段对话已有摘要，无需重复保存。'
          : result.skipped
            ? '这次没有可保存的新内容，原有记忆保持不变。'
            : '没有发现需要新增或更新的学习信息。',
  };
}

export async function readMemoryJobActivities(
  db: JobDb,
  ownerId: string,
  courseId: string,
  now = Date.now(),
): Promise<MemoryJobActivity[]> {
  // Index tasks are implementation steps of the same write, not additional memories.
  const where = { ownerId, courseId, kind: { in: ['learner-note', 'conversation-memory'] } };
  const [active, recent] = await Promise.all([
    db.backgroundJob.findMany({
      where: { ...where, status: { in: ['queued', 'running'] } },
      select,
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    db.backgroundJob.findMany({
      where: {
        ...where,
        status: { in: ['completed', 'failed'] },
        updatedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      },
      select,
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
  ]);
  // A job can finish between the two reads; prefer its terminal result.
  const jobs = [...new Map([...active, ...recent].map((job) => [job.id, job])).values()];
  const legacyResults = jobs
    .filter((job) => job.status === 'completed' && job.result)
    .map((job) => unpackResult<MemoryWriteResult>(job.result!))
    .filter((result) => !result.skipped);
  const noteIds = [
    ...new Set(
      legacyResults.filter((result) => !result.updates).flatMap((result) => result.notes ?? []),
    ),
  ];
  const conversationIds = [
    ...new Set(
      legacyResults.flatMap((result) =>
        !result.summary && result.conversationId ? [result.conversationId] : [],
      ),
    ),
  ];
  const [notes, summaries] = await Promise.all([
    noteIds.length
      ? db.studyMemory.findMany({
          where: { id: { in: noteIds }, ownerId, courseId, scope: 'private', status: 'active' },
          select: { id: true, title: true, text: true },
        })
      : [],
    conversationIds.length
      ? db.courseConversation.findMany({
          where: { id: { in: conversationIds }, ownerId, courseId, deletedAt: null },
          select: { id: true, summaryText: true },
        })
      : [],
  ]);
  const legacy: LegacyMemoryContent = {
    notes: new Map(notes.map((note) => [note.id, note])),
    summaries: new Map(
      summaries.map((conversation) => [conversation.id, conversation.summaryText || '']),
    ),
  };
  return jobs
    .map((job) => memoryJobActivity(job, legacy))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
