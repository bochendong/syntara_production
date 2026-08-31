import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const header = read('components/course-space/course-space-header.tsx');
const problemBank = read('components/problem-bank/course-problem-bank-view.tsx');
const problemBankPage = read('app/course/[id]/problem-bank/page.tsx');
const problemBankController = read('components/problem-bank/use-course-problem-bank-controller.ts');
const teacherStudio = read('components/teacher/teacher-course-studio-client.tsx');

const checks = [
  {
    name: 'shared course header always includes the problem bank entry',
    pass:
      header.includes("key: 'problem-bank' as const") &&
      !header.includes("const showProblemBank = typeof problemCount === 'number'"),
  },
  {
    name: 'teacher course header does not expose student management',
    pass: !header.includes("label: '学生管理'"),
  },
  {
    name: 'empty problem bank keeps a full workspace placeholder',
    pass:
      problemBank.includes('min-h-[calc(100dvh-3rem)]') &&
      problemBank.includes('min-h-[clamp(26rem,58dvh,46rem)]') &&
      problemBank.includes('题库还没有题目'),
  },
  {
    name: 'teacher source library opens the problem upload dialog',
    pass:
      teacherStudio.includes("'?upload=1'") &&
      teacherStudio.includes('上传题目') &&
      problemBankPage.includes('initialImportOpen') &&
      problemBankController.includes('initialImportOpenPendingRef.current') &&
      problemBankController.includes('if (canEditProblems)'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
