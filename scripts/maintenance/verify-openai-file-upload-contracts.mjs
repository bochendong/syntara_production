import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  {
    name: 'browser upload chunks stay below Vercel request limit',
    pass: /OPENAI_BROWSER_UPLOAD_PART_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/.test(
      read('lib/server/openai-user-files.ts'),
    ),
  },
  {
    name: 'OpenAI Uploads create parts complete are all implemented',
    pass: ['/uploads`', '/parts`', '/complete`'].every((needle) =>
      read('lib/server/openai-user-files.ts').includes(needle),
    ),
  },
  {
    name: 'chat file_id selects native Responses model',
    pass:
      read('features/chat/server/stateless-chat.ts').includes('requestHasOpenAIFileInput') &&
      read('features/chat/server/stateless-chat.ts').includes('useOpenAIResponses'),
  },
  {
    name: 'course problem import clears notebook assignment at preview and commit',
    pass:
      read('app/api/courses/[id]/problems/import-preview/route.ts').includes('notebookId: null') &&
      read('app/api/courses/[id]/problems/import-commit/route.ts').includes(
        'const courseLevelDrafts',
      ),
  },
  {
    name: 'teacher problem-bank processing does not create a notebook',
    pass:
      read('app/api/teacher/courses/[courseId]/sources/[sourceId]/process/route.ts').includes(
        "source.sourceCategory === 'problem_bank'",
      ) &&
      read('app/api/teacher/courses/[courseId]/sources/[sourceId]/process/route.ts').includes(
        'notebookId: null',
      ),
  },
  {
    name: 'course chat keeps files ephemeral and cannot upload them into course sources',
    pass:
      read('components/learn/learn-page-client.tsx').includes(
        'const canUploadCourseContentFromChat = false;',
      ) &&
      !read('components/learn/learn-page-client.tsx')
        .slice(
          read('components/learn/learn-page-client.tsx').indexOf('<footer'),
          read('components/learn/learn-page-client.tsx').indexOf('</footer>'),
        )
        .includes('上传为课程资料'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}
if (failed) process.exit(1);
