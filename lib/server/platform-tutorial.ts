import type { PrismaClient } from '@/lib/server/generated-prisma';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { PLATFORM_TUTORIAL_COURSE_ID } from '@/lib/onboarding/spotlight';

const PLATFORM_USER_ID = 'syntara-platform';
const PLATFORM_ORGANIZATION_ID = 'syntara-official';
const TUTORIAL_NOTEBOOK_ID = 'syntara-tutorial-guide';

const TUTORIAL_GUIDE = `# Syntara 使用教程

Syntara 是一个陪你学课程的 AI。每门课都有自己的聊天、笔记、学习进度和学习记忆。

## 平台 AI 能做什么

- **按你的资料回答**：把课程笔记放进「资料」，AI 回答时会引用你的笔记，并标出出处。
- **记住你**：聊天里说「记住：……」，或者在回答下面点「记住」，AI 会把这件事存成一颗学习记忆弹珠，以后回答时会参考。
- **安排复习**：让它「帮我安排今天复习」，它会提出日历安排，你确认后写进日历。
- **开小课堂**：遇到讲不清的地方，可以让它生成一段课堂讲解，一页一页地看。
- **出题和批改**：在电脑和平板上可以让它出小测、批改你的答案（手机上没有题库）。
- **看进度**：在「学习进度」里拖动进度，AI 只参考你已经学到的部分。

## 课程从哪里来

- **自己建课**：点「新课程」，再把自己的笔记放进「资料」。
- **商城**：学校和机构做好的课程在「商城」里，点「获取」就加进你的课程列表，你的聊天和记忆只属于你自己。

## 不需要了怎么办

在左侧课程那一行点开菜单，选「删除」。自己建的课会连同笔记一起删除；从商城加的课只是从你的列表里移除。
`;

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
    select: { id: true },
  });
  if (existing) return;
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
    await tx.course.create({
      data: {
        id: PLATFORM_TUTORIAL_COURSE_ID,
        ownerId: PLATFORM_USER_ID,
        organizationId: PLATFORM_ORGANIZATION_ID,
        name: '使用教程',
        courseCode: '使用教程',
        description: '五分钟了解 Syntara：平台 AI 能做什么、课程从哪里来、怎么删除课程。',
        tags: ['教程', '新手'],
        avatarUrl: pickStableCourseAvatarUrl(PLATFORM_TUTORIAL_COURSE_ID),
        listedInCourseStore: true,
        storePublishedAt: new Date(),
        notebookCount: 1,
      },
    });
    await tx.notebook.create({
      data: {
        id: TUTORIAL_NOTEBOOK_ID,
        ownerId: PLATFORM_USER_ID,
        courseId: PLATFORM_TUTORIAL_COURSE_ID,
        name: '平台 AI 能做什么',
        description: 'Syntara 使用说明',
        tags: ['教程'],
        notebookKind: 'markdown',
        sectionCount: 1,
      },
    });
    await tx.markdownNotebookSection.create({
      data: {
        notebookId: TUTORIAL_NOTEBOOK_ID,
        courseId: PLATFORM_TUTORIAL_COURSE_ID,
        title: '平台 AI 能做什么',
        order: 0,
        markdown: TUTORIAL_GUIDE,
        summary: TUTORIAL_GUIDE.slice(0, 240),
        sourceMeta: { source: 'platform-tutorial' },
      },
    });
  });
}
