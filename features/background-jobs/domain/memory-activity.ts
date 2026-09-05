import { z } from 'zod';

export const MEMORY_JOB_ACTIVITY_PREFIX = 'background-memory:';
export const MEMORY_ACTIVITY_RECENT_MS = 90_000;

export const memoryJobActivitySchema = z.object({
  id: z.string(),
  courseId: z.string().nullable(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'skipped']),
  title: z.string(),
  description: z.string(),
  chips: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().optional(),
});

export const memoryActivitySnapshotSchema = z.object({
  ownerId: z.string(),
  activities: z.array(memoryJobActivitySchema),
});

export type MemoryJobActivity = z.infer<typeof memoryJobActivitySchema>;
export type MemoryActivitySnapshot = z.infer<typeof memoryActivitySnapshotSchema>;

export function memoryJobStatusLabel(status: MemoryJobActivity['status']) {
  if (status === 'queued') return '等待处理';
  if (status === 'running') return '整理中';
  if (status === 'completed') return '已更新';
  if (status === 'failed') return '未完成';
  return '无新增';
}
