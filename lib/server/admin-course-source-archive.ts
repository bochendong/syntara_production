import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/lib/server/generated-prisma';

export class CourseSourceArchiveConflict extends Error {}

/** Preserve reviewed originals without extracting, generating, replacing or publishing answers. */
export async function archiveAdminCourseSource(
  db: PrismaClient,
  input: {
    courseId: string;
    actorId: string;
    name: string;
    mime: 'application/pdf' | 'application/zip';
    bytes: Uint8Array;
    apply: boolean;
    expectedHash?: string;
  },
) {
  const sourceHash = createHash('sha256').update(input.bytes).digest('hex');
  const payloadHash = createHash('sha256')
    .update(JSON.stringify([input.courseId, input.name, input.mime, sourceHash]))
    .digest('hex');
  if (input.apply && input.expectedHash !== payloadHash)
    throw new CourseSourceArchiveConflict('Preview hash mismatch.');
  return db.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, ownerId: true },
    });
    if (!course) throw new CourseSourceArchiveConflict('Course not found.');
    const where = {
      courseId_ownerId_sourceHash: {
        courseId: course.id,
        ownerId: course.ownerId,
        sourceHash,
      },
    };
    const existing = await tx.courseSource.findUnique({ where });
    if (
      existing &&
      (existing.removedAt ||
        existing.title !== input.name ||
        existing.fileMime !== input.mime ||
        existing.sourceCategory !== 'problem_bank' ||
        !existing.fileData ||
        !Buffer.from(existing.fileData).equals(Buffer.from(input.bytes)))
    )
      throw new CourseSourceArchiveConflict('An existing source differs; nothing overwritten.');
    let sourceId = existing?.id ?? null;
    if (input.apply && !existing) {
      const row = await tx.courseSource.create({
        data: {
          courseId: course.id,
          ownerId: course.ownerId,
          sourceHash,
          title: input.name,
          kind: 'teacher_upload',
          fileMime: input.mime,
          fileData: Buffer.from(input.bytes),
          fileSize: input.bytes.byteLength,
          sourceCategory: 'problem_bank',
          ingestStatus: 'uploaded',
          indexStatus: 'skipped',
          metadataJson: {
            sourceCategory: 'problem_bank',
            archiveOnly: true,
            uploadedByAdmin: input.actorId,
            payloadHash,
          },
        },
        select: { id: true },
      });
      sourceId = row.id;
    }
    return {
      courseId: course.id,
      sourceId,
      name: input.name,
      sourceHash,
      payloadHash,
      bytes: input.bytes.byteLength,
      mode: input.apply ? 'saved' : 'preview',
      replayed: Boolean(existing),
    };
  });
}
