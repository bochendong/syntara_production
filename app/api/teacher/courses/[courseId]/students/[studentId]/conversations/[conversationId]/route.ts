import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

const MESSAGE_LIMIT = 1000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; studentId: string; conversationId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, studentId, conversationId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
      select: { id: true },
    });
    if (!enrollment) return NextResponse.json({ error: '学生未加入该课程' }, { status: 404 });

    const courseConversation = await prisma.courseConversation.findFirst({
      where: { id: conversationId, ownerId: studentId, courseId, deletedAt: null },
      select: {
        title: true,
        messageCount: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { sequence: 'asc' },
          take: MESSAGE_LIMIT,
          select: { id: true, role: true, plainText: true, content: true, createdAt: true },
        },
      },
    });
    if (courseConversation) {
      return NextResponse.json({
        conversation: {
          title: courseConversation.title,
          messageCount: courseConversation.messageCount,
        },
        messages: courseConversation.messages,
        messagesTruncated: courseConversation.messages.length < courseConversation.messageCount,
      });
    }

    const legacy = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerId: studentId,
        AND: [
          { OR: [{ courseId }, { courseId: null, notebook: { courseId } }] },
          { OR: [{ targetId: null }, { NOT: { targetId: { startsWith: 'learn:' } } }] },
        ],
      },
      select: {
        title: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: MESSAGE_LIMIT,
          select: { id: true, role: true, plainText: true, content: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });
    if (!legacy) return NextResponse.json({ error: '对话不存在' }, { status: 404 });
    return NextResponse.json({
      conversation: { title: legacy.title || '新对话', messageCount: legacy._count.messages },
      messages: legacy.messages,
      messagesTruncated: legacy.messages.length < legacy._count.messages,
    });
  });
}
