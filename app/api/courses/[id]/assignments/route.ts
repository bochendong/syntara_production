import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { extractAssignmentFile } from '@/lib/server/course-assignment-review';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    const role = await findCourseAccessRole(prisma, auth.userId, courseId);
    if (!role) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const [course, assignments] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { name: true, courseCode: true },
      }),
      prisma.courseAssignment.findMany({
        where: { courseId, ...(role === 'enrolled' ? { published: true } : {}) },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          instructions: true,
          published: true,
          exemplarFileName: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { submissions: true } },
          ...(role === 'enrolled'
            ? {
                submissions: {
                  where: { studentId: auth.userId },
                  orderBy: { createdAt: 'desc' as const },
                  take: 1,
                  select: {
                    id: true,
                    fileName: true,
                    reviewStatus: true,
                    feedbackJson: true,
                    createdAt: true,
                  },
                },
              }
            : {}),
        },
      }),
    ]);
    return NextResponse.json(
      {
        role,
        course,
        assignments: assignments.map((item) => ({
          id: item.id,
          title: item.title,
          instructions: item.instructions,
          published: item.published,
          exemplarFileName: role === 'owner' ? item.exemplarFileName : undefined,
          version: item.version,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          submissionCount: role === 'owner' ? item._count.submissions : undefined,
          latestSubmission: 'submissions' in item ? (item.submissions[0] ?? null) : undefined,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireTeacher();
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    if ((await findCourseAccessRole(prisma, auth.userId, courseId)) !== 'owner') {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const form = await request.formData();
    const title = String(form.get('title') ?? '').trim();
    const instructions = String(form.get('instructions') ?? '').trim();
    const file = form.get('file');
    if (!title || title.length > 200 || !instructions || instructions.length > 20_000) {
      return NextResponse.json({ error: '请填写标题和检查要点。' }, { status: 400 });
    }
    let extracted: Awaited<ReturnType<typeof extractAssignmentFile>> | null = null;
    if (file instanceof File && file.size > 0) {
      try {
        extracted = await extractAssignmentFile(file);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : '范本读取失败。' },
          { status: 400 },
        );
      }
    }
    const assignment = await prisma.courseAssignment.create({
      data: {
        courseId,
        title,
        instructions,
        published: form.get('published') === 'true',
        exemplarFileName: extracted?.fileName ?? null,
        exemplarMimeType: extracted?.mimeType ?? null,
        exemplarFileData: extracted ? Uint8Array.from(extracted.data) : null,
        exemplarText: extracted?.text ?? null,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: assignment.id }, { status: 201 });
  });
}
