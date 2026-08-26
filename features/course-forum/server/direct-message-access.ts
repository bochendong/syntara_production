import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireCourseForumReadAccess } from '@/features/course-forum/server/course-forum-access';
import type { CourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';

type DirectMessageAccessResult =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      userId: string;
      accessRole: CourseAccessRole;
      isTeacher: boolean;
      course: {
        id: string;
        ownerId: string;
        name: string;
        courseCode: string | null;
        academicYear: number | null;
        academicTerm: string | null;
      };
      user: {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
      };
    };

export async function requireDirectMessageAccess(courseId: string): Promise<DirectMessageAccessResult> {
  return requireCourseForumReadAccess(courseId);
}

export async function canMessageCommunityMember(
  courseId: string,
  userId: string,
  recipientId: string,
) {
  const community = await prisma.community.findFirst({
    where: {
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: recipientId } } },
      ],
      forumPosts: { some: { courseId } },
    },
    select: { id: true },
  });
  return Boolean(community);
}
