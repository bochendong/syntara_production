import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import {
  findCourseAccessRole,
  type CourseAccessRole,
} from '@/lib/server/repositories/course-enrollment-repository';
import { reconcileSpeedupCourseMembershipsIfAvailable } from '@/lib/server/speedup-course-provisioning';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const COURSE_FORUM_MAX_IMAGES = 5;
export const COURSE_FORUM_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type CourseForumAccessResult =
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
        problemCount: number;
      };
      user: {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
      };
    };

export function courseForumDisplayName(user: { name: string | null; email: string | null }) {
  const name = user.name?.trim();
  if (name && !/^\d{6,}$/u.test(name)) return name;
  const email = user.email?.trim();
  if (email) return email.split('@')[0] || email;
  return '课程成员';
}

export function isSameForumIdentity(
  a: { id: string; email: string | null },
  b: { id: string; email: string | null },
) {
  if (a.id === b.id) return true;
  const aEmail = a.email?.trim().toLowerCase() || '';
  const bEmail = b.email?.trim().toLowerCase() || '';
  if (aEmail && bEmail && aEmail === bEmail) return true;
  const localDemoStudentEmails = new Set(['student@example.com', 'student@test.local']);
  return localDemoStudentEmails.has(aEmail) && localDemoStudentEmails.has(bEmail);
}

export async function requireCourseForumAccess(courseId: string): Promise<CourseForumAccessResult> {
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) return { ok: false, response: auth.response };

  await reconcileSpeedupCourseMembershipsIfAvailable(auth.userId, { maxAgeMs: 15_000 });
  const accessRole = await findCourseAccessRole(prisma, auth.userId, courseId);
  if (!accessRole) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '课程不存在，或该课程的 AI 访问权限已由机构关闭。' },
        { status: 404 },
      ),
    };
  }

  const [course, user] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        ownerId: true,
        name: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        problemCount: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, image: true, role: true },
    }),
  ]);
  if (!course || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Course not found' }, { status: 404 }),
    };
  }

  return {
    ok: true,
    userId: user.id,
    accessRole,
    isTeacher: accessRole === 'owner',
    course,
    user,
  };
}

export async function requireCourseForumReadAccess(
  courseId: string,
): Promise<CourseForumAccessResult> {
  const courseAccess = await requireCourseForumAccess(courseId);
  if (courseAccess.ok) return courseAccess;

  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) return { ok: false, response: auth.response };

  const [course, user, community] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        ownerId: true,
        name: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        problemCount: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, image: true, role: true },
    }),
    prisma.community.findFirst({
      where: {
        OR: [{ visibility: 'public' }, { members: { some: { userId: auth.userId } } }],
        forumPosts: { some: { courseId } },
      },
      select: { id: true },
    }),
  ]);

  if (!course || !user || !community) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Course not found' }, { status: 404 }),
    };
  }

  return {
    ok: true,
    userId: user.id,
    accessRole: 'enrolled',
    isTeacher: user.id === course.ownerId,
    course,
    user,
  };
}

export async function parseCourseForumImages(formData: FormData) {
  const files = formData
    .getAll('images')
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > COURSE_FORUM_MAX_IMAGES) {
    throw new Error(`每次最多上传 ${COURSE_FORUM_MAX_IMAGES} 张图片`);
  }

  return Promise.all(
    files.map(async (file) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        throw new Error('只支持 JPG、PNG、WebP 或 GIF 图片');
      }
      if (file.size > COURSE_FORUM_MAX_IMAGE_BYTES) {
        throw new Error('单张图片不能超过 5 MB');
      }
      const data = Buffer.from(await file.arrayBuffer());
      return {
        fileName: file.name.trim().slice(0, 255) || 'forum-image',
        mimeType: file.type,
        byteSize: data.byteLength,
        contentSha: createHash('sha256').update(data).digest('hex'),
        data,
      };
    }),
  );
}

export function forumAuthor(
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role?: string | null;
  },
  teacherId: string,
) {
  const isTeacher = user.id === teacherId;
  const forumRole =
    user.role === 'ADMIN' ? 'admin' : user.role === 'TEACHER' || isTeacher ? 'teacher' : 'student';
  const forumRoleLabel =
    forumRole === 'admin' ? '管理员' : forumRole === 'teacher' ? '老师' : '学生';
  const displayName = courseForumDisplayName(user);
  return {
    id: user.id,
    name: displayName === '课程成员' ? (isTeacher ? '课程老师' : '课程同学') : displayName,
    image: user.image,
    isTeacher,
    forumRole,
    forumRoleLabel,
  };
}

export function forumAttachment(
  courseId: string,
  attachment: {
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  },
) {
  const base = `/api/course-forum/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachment.id)}`;
  return {
    ...attachment,
    url: base,
    downloadUrl: `${base}?download=1`,
  };
}
