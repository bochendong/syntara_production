import { prisma } from '@/lib/server/prisma';

export const COURSE_FORUM_WELCOME_SYSTEM_KEY = 'welcome-v1';

export function courseForumWelcomeMarkdown(courseLabel: string) {
  return `欢迎来到 **${courseLabel}**！这里是你查看课程资料、练习和交流知识点的学习空间。

## 进入课程前：请先修改自己的名字

请在个人资料中，把显示名字改为老师能够识别的姓名，并保存。这样老师才能在课程名单、练习记录和论坛中认出你。

## 平台怎么用

- **资料库 / AI 笔记本**：查看老师整理的讲义、笔记和课堂讲解，按课程顺序学习与复习。
- **聊天**：围绕课程知识提问，说明你正在学习的概念以及不理解的地方；结合老师的讲义核对 AI 的解释。
- **题库**：按章节选择练习，独立作答后提交，查看反馈与提交历史，再回到相关知识点复习。
- **论坛**：与老师、同学交流知识点和学习方法，也可以反馈平台使用问题。

## 向老师提问时，请注意

**老师不会回复作业答案，也不会代写作业或提供可以直接提交的代码；老师会帮助你解答知识点相关的问题。**

请围绕概念、原理和方法提问，写清楚自己的理解、已经尝试的思路，以及具体卡在哪里。需要举例时，可以使用与作业、考试无关的自拟例子。不要在公开论坛上传或转述作业、考试题目及答案。

## 发帖小提示

1. 使用具体的标题，例如「为什么字符串不能直接修改某个位置？」。
2. 在正文中说明知识点与困惑，方便老师和同学理解。
3. 代码请使用代码块，保留换行与缩进；数学公式可以使用 Markdown 公式语法。
4. 避免重复发帖，友善交流，尊重彼此。

祝你学习顺利，也欢迎分享你理解一个知识点的过程！`;
}

export async function ensureCourseForumWelcomePost(course: {
  id: string;
  ownerId: string;
  name: string;
  courseCode: string | null;
}) {
  const now = new Date();
  const courseLabel = course.courseCode?.trim() || course.name;
  const post = await prisma.courseForumPost.upsert({
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
      title: 'Welcome｜开始学习前请先阅读',
      bodyMarkdown: courseForumWelcomeMarkdown(courseLabel),
      pinnedAt: now,
      pinnedById: course.ownerId,
      systemKey: COURSE_FORUM_WELCOME_SYSTEM_KEY,
    },
  });
  // Upgrade the untouched legacy system post; never overwrite a teacher's customized welcome.
  if (
    post.title === '欢迎使用课程论坛｜发帖前请先阅读' &&
    post.bodyMarkdown.includes('**本机构严禁在公开论坛讨论任何考试或作业内容。**')
  ) {
    await prisma.courseForumPost.updateMany({
      where: { id: post.id, title: post.title, bodyMarkdown: post.bodyMarkdown },
      data: {
        title: 'Welcome｜开始学习前请先阅读',
        bodyMarkdown: courseForumWelcomeMarkdown(courseLabel),
      },
    });
  }
}
