import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const header = read('components/course-space/course-space-header.tsx');
const problemBank = read('components/problem-bank/course-problem-bank-view.tsx');
const problemBankPage = read('app/course/[id]/problem-bank/page.tsx');
const problemBankController = read('components/problem-bank/use-course-problem-bank-controller.ts');
const problemDraftForm = read('components/problem-bank/problem-draft-form.tsx');
const problemEvaluator = read('lib/server/notebook-problems/evaluate.ts');
const teacherStudio = read('components/teacher/teacher-course-studio-client.tsx');
const forum = read('components/course-forum/course-forum-page-client.tsx');
const headerCache = read('lib/course-space/course-space-header-cache.ts');

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
    name: 'teacher problem imports use only the shared source-library upload flow',
    pass:
      teacherStudio.includes("sourceCategory === 'problem_bank'") &&
      teacherStudio.includes('上传题目') &&
      teacherStudio.includes('void handleUpload(files)') &&
      !problemBankPage.includes('initialImportOpen') &&
      !problemBankController.includes('handlePreviewImport'),
  },
  {
    name: 'course tab transitions keep the shared header while destination content loads',
    pass:
      header.includes('useSyncExternalStore') &&
      header.includes('readCourseSpaceHeaderCache') &&
      headerCache.includes('window.sessionStorage') &&
      forum.includes('courseTitle="课程论坛"') &&
      forum.includes('正在打开课程论坛'),
  },
  {
    name: 'problem bank loading state fills the workspace instead of a thin row',
    pass:
      problemBank.includes('正在加载课程题库') &&
      problemBank.includes('题目、章节与作答记录准备好后会显示在这里。') &&
      problemBank.includes('aria-busy="true"'),
  },
  {
    name: 'fill-blank problems have numbered inputs, structured submission, and grading support',
    pass:
      problemBank.includes('fill-blank-${selectedProblem.id}-${blank.id}') &&
      problemBank.includes('setBlankAnswers') &&
      problemBankController.includes('blanks: selectedBlankAnswers') &&
      problemDraftForm.includes("currentType === 'fill_blank'") &&
      problemDraftForm.includes('acceptedAnswers') &&
      problemEvaluator.includes('isNotebookFillBlankProblemRecord(problem)'),
  },
  {
    name: 'calculation problems without a reference answer wait for manual grading',
    pass:
      problemEvaluator.includes("status: 'pending'") &&
      problemEvaluator.includes('这道计算题缺少标准答案'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
