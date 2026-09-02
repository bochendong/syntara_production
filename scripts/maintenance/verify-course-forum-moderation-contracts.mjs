import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const postRoute = read('app/api/course-forum/[courseId]/posts/[postId]/route.ts');
const answerRoute = read('app/api/course-forum/[courseId]/answers/[answerId]/route.ts');
const commentRoute = read('app/api/course-forum/[courseId]/comments/[commentId]/route.ts');
const forumPage = read('components/course-forum/course-forum-page-client.tsx');

const checks = [
  {
    name: 'only the post author can edit a regular forum post',
    pass:
      postRoute.includes('post.authorId !== access.userId') &&
      postRoute.includes('只能编辑自己发布的帖子') &&
      postRoute.includes('论坛指南不能编辑'),
  },
  {
    name: 'authors can delete their posts and teachers can moderate every regular post',
    pass:
      postRoute.includes('post.authorId !== access.userId && !access.isTeacher') &&
      postRoute.includes('论坛指南不能删除') &&
      postRoute.includes('prisma.courseForumPost.delete'),
  },
  {
    name: 'only teachers can delete answers and accepted-answer deletion reopens the post',
    pass:
      answerRoute.includes('if (!access.isTeacher)') &&
      answerRoute.includes('prisma.courseForumAnswer.delete') &&
      answerRoute.includes('answer.acceptedAt ? { resolvedAt: null } : {}'),
  },
  {
    name: 'only teachers can delete comments',
    pass:
      commentRoute.includes('if (!access.isTeacher)') &&
      commentRoute.includes('prisma.courseForumComment.delete'),
  },
  {
    name: 'forum UI exposes edit and scoped destructive actions with confirmation',
    pass:
      forumPage.includes('canEditSelectedPost') &&
      forumPage.includes('canDeleteSelectedPost') &&
      forumPage.includes("kind: 'answer'") &&
      forumPage.includes("kind: 'comment'") &&
      forumPage.includes('<AlertDialog') &&
      forumPage.includes('const confirmDelete = async () => {'),
  },
  {
    name: 'deleting the selected post prefers another regular post over the welcome pin',
    pass:
      forumPage.includes('...(snapshot?.posts || []), ...(snapshot?.pinnedPosts || [])') &&
      forumPage.includes('commitSelectedPostId(nextPostId);') &&
      forumPage.includes('await load({ postId: nextPostId, quiet: true });'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
