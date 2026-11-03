import { contentDrafts, draftAuthority } from '@/lib/server/course-content-drafts';
import { NextRequest, NextResponse } from 'next/server';

import { buildNativeNotebookArchive } from '@/lib/server/native-course-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 打开一本网页笔记时下载它的完整内容，存到本机后离线可读。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Notebook storage is unavailable.',
    );
  }
  const notebookId = request.nextUrl.searchParams.get('id')?.trim();
  if (!notebookId || notebookId.length > 200) {
    return publicApiError(requestId, 400, 'invalid_request', 'id is required.');
  }
  const managedCourseId = request.nextUrl.searchParams.get('managedCourseId');
  const management = managedCourseId
    ? await draftAuthority(prisma, principal.userId, managedCourseId)
    : null;
  const live = await prisma.notebook.findUnique({
    where: { id: notebookId },
    select: { courseId: true },
  });
  if (management && live && live.courseId !== managedCourseId)
    return publicApiError(requestId, 404, 'not_found', 'Notebook not found.');
  let archive = await buildNativeNotebookArchive(
    prisma,
    management?.ownerId || principal.userId,
    notebookId,
  );
  if (managedCourseId) {
    await draftAuthority(prisma, principal.userId, managedCourseId);
    const draft = (await contentDrafts(prisma, managedCourseId)).find(
      (row) => row.kind === 'notes' && row.targetId === notebookId,
    );
    if (draft) {
      const p = draft.payload;
      const now = draft.updatedAt.getTime();
      archive = {
        ...(archive || {
          notebookPages: [],
          assets: [],
          pageAssets: [],
          notebookAssets: [],
          missingAssetPaths: [],
        }),
        notebook: {
          ...(archive?.notebook || {
            id: notebookId,
            courseId: managedCourseId,
            description: '',
            kind: 'markdown' as const,
            tags: [],
            sectionCount: p.markdownSections.length,
            contentVersion: 1,
            createdAt: now,
          }),
          name: p.name,
          updatedAt: now,
        },
        markdownSections: p.markdownSections.map(
          (section: { id: string; title: string; order: number; markdown: string }) => ({
            ...section,
            notebookId,
            courseId: managedCourseId,
            summary: section.markdown.slice(0, 240),
            sourceMeta: {},
            createdAt: now,
            updatedAt: now,
          }),
        ),
      };
    }
  }
  if (!archive) return publicApiError(requestId, 404, 'not_found', 'Notebook not found.');
  return publicApiSuccess(requestId, archive, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
