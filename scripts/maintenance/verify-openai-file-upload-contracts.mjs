import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const onlineTeacherStudio = read('lib/teacher/online-course-studio.ts');
const teacherSourceUploadBlock = onlineTeacherStudio.slice(
  onlineTeacherStudio.indexOf('export async function uploadOnlineTeacherSources'),
  onlineTeacherStudio.indexOf('export async function getOnlineTeacherSourcePreview'),
);
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
    name: 'teacher source upload saves the original without starting AI processing',
    pass:
      read('app/api/teacher/courses/[courseId]/sources/route.ts').includes(
        "ingestStatus: 'uploading'",
      ) &&
      read('app/api/teacher/courses/[courseId]/source-uploads/[sourceId]/parts/route.ts').includes(
        '"fileData" = COALESCE("fileData"',
      ) &&
      read(
        'app/api/teacher/courses/[courseId]/source-uploads/[sourceId]/complete/route.ts',
      ).includes("ingestStatus: 'uploaded'") &&
      !teacherSourceUploadBlock.includes('processOnlineSource(') &&
      read('components/teacher/teacher-course-studio-client.tsx').includes(
        'await processOnlineSource(courseId, assetId)',
      ) &&
      !read('app/api/teacher/courses/[courseId]/sources/route.ts').includes(
        'downloadOpenAIUserFile',
      ),
  },
  {
    name: 'teacher Office uploads use idempotent initialization and derived PDF previews',
    pass:
      read('app/api/teacher/courses/[courseId]/sources/route.ts').includes(
        'pending-upload:${uploadId}',
      ) &&
      read('lib/teacher/online-course-studio.ts').includes(
        'const uploadId = crypto.randomUUID()',
      ) &&
      read('app/api/teacher/courses/[courseId]/sources/[sourceId]/process/route.ts').includes(
        "stage: 'converting_to_pdf'",
      ) &&
      read('app/api/teacher/courses/[courseId]/sources/[sourceId]/preview/route.ts').includes(
        'convertOfficeSourceToPdf',
      ) &&
      read('lib/server/office-source-pdf.ts').includes('new PDFDocument'),
  },
  {
    name: 'course chat only receives AI-ready source records',
    pass:
      read('lib/chat/course-chat-context.ts').includes("source.ingestStatus === 'ready'") &&
      read('lib/chat/course-chat-context.ts').includes("source.indexStatus === 'ready'") &&
      read('lib/chat/server-course-question-context.ts').includes(
        "source.ingestStatus === 'ready'",
      ) &&
      read('lib/chat/server-course-question-context.ts').includes("source.indexStatus === 'ready'"),
  },
  {
    name: 'teacher problem import failures are visible in the AI queue',
    pass:
      read('app/api/teacher/courses/[courseId]/studio/route.ts').includes(
        "'teacher_problem_bank_import'",
      ) &&
      read('lib/teacher/online-course-studio.ts').includes("'problem_bank_import'") &&
      read('components/teacher/teacher-course-studio-client.tsx').includes('题目导入失败'),
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
