import type { DbClient } from '@/lib/server/repositories/types';
import { prisma } from '@/lib/server/prisma';

/**
 * 客户端说「这次提交来自这节课」时核对一下：这个人进过这节课，这节课也有这道题。
 * 下课后再交照样算；核对不上就当普通做题，提交本身不失败。
 */
export async function classSessionForAttempt(
  input: { userId: string; problemId: string; classSessionId?: string | null },
  db: DbClient = prisma,
): Promise<string | null> {
  if (!input.classSessionId) return null;
  const item = await db.classSessionItem.findFirst({
    where: {
      sessionId: input.classSessionId,
      problemId: input.problemId,
      session: {
        status: { in: ['live', 'ended'] },
        participants: { some: { userId: input.userId } },
      },
    },
    select: { sessionId: true },
  });
  return item?.sessionId ?? null;
}
