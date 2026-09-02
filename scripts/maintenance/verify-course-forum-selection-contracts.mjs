import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const forumPage = fs.readFileSync(
  path.join(root, 'components/course-forum/course-forum-page-client.tsx'),
  'utf8',
);

const checks = [
  {
    name: 'opening a forum post loads that exact post',
    pass:
      forumPage.includes('const openPost = (postId: string) => {') &&
      forumPage.includes('void load({ postId });'),
  },
  {
    name: 'creating a forum post reloads the new post explicitly',
    pass: forumPage.includes("await load({ postId: payload.postId, quiet: true, status: 'all' });"),
  },
  {
    name: 'selected post changes do not trigger a second default forum load',
    pass: !forumPage.includes('[filter, initialSnapshot, load, mockMode, search, selectedPostId]'),
  },
  {
    name: 'filter and search reloads preserve the currently selected post',
    pass:
      forumPage.includes('const selectedPostIdRef = useRef(') &&
      forumPage.includes(
        'void load({ postId: selectedPostIdRef.current, quiet: true, status: filter });',
      ) &&
      forumPage.includes('void load({ postId: selectedPostIdRef.current });'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
