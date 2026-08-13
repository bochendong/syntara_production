import { prisma } from '@/lib/server/prisma';

export const COURSE_FORUM_WELCOME_SYSTEM_KEY = 'welcome-v1';

export function courseForumWelcomeMarkdown(courseLabel: string) {
  return `欢迎来到 **${courseLabel} 课程论坛**。这里用于师生交流课程知识、学习方法和一般性概念问题。

## 重要规则

> **本机构严禁在公开论坛讨论任何考试或作业内容。**

- 不得发布、转述或索取考试题目、考试范围、考点、答案、提示或评分细节。
- 不得发布、转述或索取作业题目、答案、解题步骤、代码或可直接提交的内容。
- 不要上传包含考试或作业内容的截图、照片、附件或链接。
- 如果不确定某个问题是否涉及考试或作业，请不要公开发布，改为私下联系老师。

违反规则的内容可能被老师移除；请勿通过改写题目、隐藏课程信息等方式绕过限制。

## 可以讨论什么

- 课程中的公开概念、定义和通用学习方法
- 与具体考试、作业无关的自拟例子
- 论坛使用、Markdown、公式和图片上传问题
- 课程安排等老师明确允许公开讨论的信息

## 如何发帖

1. 使用清楚、具体的标题。
2. 说明你对相关概念的理解以及卡住的位置，但不要粘贴考试或作业内容。
3. 代码请放进代码块，数学公式可使用 \`$...$\` 或 \`$$...$$\`。
4. 图片会作为帖子附件显示，每个帖子最多上传 5 张。

友善交流，尊重同学和老师；发帖即表示你已阅读并同意以上规则。`;
}

export async function ensureCourseForumWelcomePost(course: {
  id: string;
  ownerId: string;
  name: string;
  courseCode: string | null;
}) {
  const now = new Date();
  const courseLabel = course.courseCode?.trim() || course.name;
  await prisma.courseForumPost.upsert({
    where: {
      courseId_systemKey: {
        courseId: course.id,
        systemKey: COURSE_FORUM_WELCOME_SYSTEM_KEY,
      },
    },
    update: {},
    create: {
      courseId: course.id,
      authorId: course.ownerId,
      title: '欢迎使用课程论坛｜发帖前请先阅读',
      bodyMarkdown: courseForumWelcomeMarkdown(courseLabel),
      pinnedAt: now,
      pinnedById: course.ownerId,
      systemKey: COURSE_FORUM_WELCOME_SYSTEM_KEY,
    },
  });
}
