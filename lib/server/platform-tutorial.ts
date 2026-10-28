import type { PrismaClient } from '@/lib/server/generated-prisma';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { PLATFORM_TUTORIAL_COURSE_ID } from '@/lib/onboarding/spotlight';
import {
  TUTORIAL_NOTEBOOK_ID,
  tutorialSections,
  tutorialTitle,
} from '@/lib/onboarding/tutorial-content';

const PLATFORM_USER_ID = 'syntara-platform';
const PLATFORM_ORGANIZATION_ID = 'syntara-official';
const TUTORIAL_REVISION = 'platform-tutorial-v2';

let ensured: Promise<void> | null = null;

/**
 * 商城里平台自己的「使用教程」课程。第一次用到时建好：平台账号、官方机构、课程和一本说明笔记。
 * 重复调用只查一次。
 */
export function ensurePlatformTutorial(prisma: PrismaClient): Promise<void> {
  ensured ??= createPlatformTutorial(prisma).catch((cause) => {
    ensured = null;
    console.warn('[platform-tutorial] could not create the tutorial course', cause);
  });
  return ensured;
}

async function createPlatformTutorial(prisma: PrismaClient) {
  const existing = await prisma.course.findUnique({
    where: { id: PLATFORM_TUTORIAL_COURSE_ID },
    select: { id: true, ownerId: true, tags: true },
  });
  if (existing?.ownerId !== undefined && existing.ownerId !== PLATFORM_USER_ID)
    throw new Error('Platform tutorial ID is owned by another account.');
  if (existing?.tags.includes(TUTORIAL_REVISION)) return;
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: PLATFORM_USER_ID },
      create: { id: PLATFORM_USER_ID, name: 'Syntara', role: 'USER', isActive: false },
      update: {},
    });
    await tx.organization.upsert({
      where: { id: PLATFORM_ORGANIZATION_ID },
      create: {
        id: PLATFORM_ORGANIZATION_ID,
        slug: 'syntara',
        name: 'Syntara 官方',
        verified: true,
      },
      update: {},
    });
    await tx.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: PLATFORM_ORGANIZATION_ID,
          userId: PLATFORM_USER_ID,
        },
      },
      create: { organizationId: PLATFORM_ORGANIZATION_ID, userId: PLATFORM_USER_ID, role: 'owner' },
      update: {},
    });
    const courseContent = {
      name: 'Syntara 演示课程',
      courseCode: null,
      description:
        '从这里认识平台：资料、AI 聊天、练习、记忆球和复习安排。内含可以点开的示例记忆。',
      tags: ['平台入门', '记忆球', TUTORIAL_REVISION],
      listedInCourseStore: true,
      notebookCount: 1,
    };
    await tx.course.upsert({
      where: { id: PLATFORM_TUTORIAL_COURSE_ID },
      create: {
        ...courseContent,
        id: PLATFORM_TUTORIAL_COURSE_ID,
        ownerId: PLATFORM_USER_ID,
        organizationId: PLATFORM_ORGANIZATION_ID,
        avatarUrl: pickStableCourseAvatarUrl(PLATFORM_TUTORIAL_COURSE_ID),
        storePublishedAt: new Date(),
      },
      update: courseContent,
    });
    const notebookContent = {
      name: tutorialTitle,
      description: 'Syntara 平台入门指南',
      tags: ['教程'],
      notebookKind: 'markdown' as const,
      sectionCount: tutorialSections.length,
    };
    await tx.notebook.upsert({
      where: { id: TUTORIAL_NOTEBOOK_ID },
      create: {
        ...notebookContent,
        id: TUTORIAL_NOTEBOOK_ID,
        ownerId: PLATFORM_USER_ID,
        courseId: PLATFORM_TUTORIAL_COURSE_ID,
      },
      update: notebookContent,
    });
    for (const [order, section] of tutorialSections.entries()) {
      const content = {
        title: section.title,
        markdown: section.markdown,
        summary: section.markdown.slice(0, 240),
        sourceMeta: { source: 'platform-tutorial', revision: TUTORIAL_REVISION },
      };
      await tx.markdownNotebookSection.upsert({
        where: { notebookId_order: { notebookId: TUTORIAL_NOTEBOOK_ID, order } },
        create: {
          ...content,
          notebookId: TUTORIAL_NOTEBOOK_ID,
          courseId: PLATFORM_TUTORIAL_COURSE_ID,
          order,
        },
        update: content,
      });
    }
  });
}
