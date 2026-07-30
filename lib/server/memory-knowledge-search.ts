import type { PrismaClient } from '@/lib/server/generated-prisma';
import type { MemorySearchProgressFilter } from '@/lib/server/memory-search-intent';
import {
  searchProblemSourceEvidence,
  type MemoryEvidencePacket,
} from '@/lib/server/memory-source-evidence';

export type MemoryKnowledgeMatch = {
  id: string;
  sourceType: 'problem_bank';
  title: string;
  text: string;
  score: number;
  metadata: {
    courseId: string | null;
    notebookId: string | null;
    problemType: string;
    difficulty: string;
    tags: string[];
    status: string;
    notebookName: string | null;
    attemptStatus: string | null;
    attemptScore: number | null;
    attemptedCount: number;
    lastAttemptAt: string | null;
  };
};

function stringMetadata(metadata: Record<string, unknown>, key: string, fallback: string): string {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function nullableStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableNumberMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberMetadata(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function tagsMetadata(metadata: Record<string, unknown>): string[] {
  const tags = metadata.tags;
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
    : [];
}

export function problemEvidenceToKnowledgeMatch(
  packet: MemoryEvidencePacket,
): MemoryKnowledgeMatch {
  const metadata = packet.metadata;
  return {
    id: packet.sourceId,
    sourceType: 'problem_bank',
    title: packet.title,
    text: packet.renderedText.replace(/\s+/g, ' ').trim().slice(0, 520) || packet.title,
    score: packet.score,
    metadata: {
      courseId: packet.courseId,
      notebookId: packet.notebookId,
      problemType: stringMetadata(metadata, 'problemType', 'unknown'),
      difficulty: stringMetadata(metadata, 'difficulty', 'medium'),
      tags: tagsMetadata(metadata),
      status: stringMetadata(metadata, 'status', 'published'),
      notebookName: nullableStringMetadata(metadata, 'notebookName'),
      attemptStatus: nullableStringMetadata(metadata, 'attemptStatus'),
      attemptScore: nullableNumberMetadata(metadata, 'attemptScore'),
      attemptedCount: numberMetadata(metadata, 'attemptedCount'),
      lastAttemptAt: nullableStringMetadata(metadata, 'lastAttemptAt'),
    },
  };
}

/**
 * Problem-bank recall and source evidence deliberately share one retrieval
 * implementation. This keeps index coverage checks, query embeddings, raw
 * fallback bounds, and ranking policy from being paid twice by one answer.
 */
export async function searchProblemBankKnowledge(args: {
  prisma: PrismaClient;
  query: string;
  notebookId?: string | null;
  courseId?: string | null;
  viewerUserId?: string | null;
  progressFilter?: MemorySearchProgressFilter | null;
  limit?: number;
}): Promise<MemoryKnowledgeMatch[]> {
  const packets = await searchProblemSourceEvidence({
    prisma: args.prisma,
    query: args.query,
    notebookId: args.notebookId,
    courseId: args.courseId,
    viewerUserId: args.viewerUserId,
    progressFilter: args.progressFilter,
    includeAttemptDetails: Boolean(args.progressFilter),
    limit: args.limit,
  });
  return packets.map(problemEvidenceToKnowledgeMatch);
}
