import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const header = read('components/course-space/course-space-header.tsx');
const problemBank = read('components/problem-bank/course-problem-bank-view.tsx');
const problemBankPage = read('app/course/[id]/problem-bank/page.tsx');
const problemBankController = read('components/problem-bank/use-course-problem-bank-controller.ts');
const problemBankHelpers = read('components/problem-bank/course-problem-bank-helpers.tsx');
const problemBankApi = read('lib/utils/notebook-problem-api.ts');
const problemBankService = read('lib/server/notebook-problems/service.ts');
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
    name: 'teacher course header exposes student management',
    pass: header.includes("label: '学生管理'"),
  },
  {
    name: 'empty problem bank keeps a full workspace placeholder',
    pass:
      problemBank.includes('min-h-[calc(100dvh-3rem)]') &&
      problemBank.includes('min-h-0 flex-1 place-items-center') &&
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
    name: 'student review filters expose completed and retry-focused learning states',
    pass:
      problemBank.includes("'做题进度筛选'") &&
      problemBank.includes('practiceFilterOptions.map') &&
      problemBankHelpers.includes("review: '尝试过但没做对'") &&
      problemBankHelpers.includes("wrong: '已完成但做错'") &&
      problemBankHelpers.includes("unattempted: '未完成'") &&
      problemBankHelpers.includes("mastered: '已完成'") &&
      problemBankHelpers.includes('attemptedCount > 0 && passedCount === 0'),
  },
  {
    name: 'problem bank uses teacher-defined chapters with an unfiled filter',
    pass:
      problemBank.includes("'管理章节'") &&
      problemBank.includes('chapterFilterOptions.map') &&
      problemBankController.includes("value: '__unfiled__'") &&
      problemBankController.includes('problem.chapterId !== chapterFilter'),
  },
  {
    name: 'problem bank sidebar spans the content height and reports chapter completion',
    pass:
      problemBank.includes('ProblemBankStatsSidebar') &&
      problemBank.includes('absolute inset-y-0 right-0') &&
      problemBank.includes('xl:mr-[312px]') &&
      problemBank.includes("'章节完成度'") &&
      problemBank.includes('item.percent') &&
      problemBankController.includes('item.attemptedCount / Math.max(1, item.totalCount)') &&
      problemBankController.includes('.slice(0, 5)') &&
      problemBankController.includes('chapterProgressById'),
  },
  {
    name: 'problem bank sidebar stays compact without an internal scroll region',
    pass:
      problemBank.includes('grid grid-cols-4 gap-1.5 p-3') &&
      problemBank.includes('mt-3 min-h-0 flex-1 overflow-hidden') &&
      !problemBank.includes('mt-4 min-h-0 flex-1 overflow-y-auto'),
  },
  {
    name: 'each problem bank list item exposes class pass rate and teacher deletion',
    pass:
      problemBank.includes("'全班通过率'") &&
      problemBank.includes('classPassRatePresentation(problem, locale)') &&
      problemBank.includes('handleDeleteProblem(problem)') &&
      problemBank.includes('deletingProblemId === problem.id') &&
      problemBankController.includes('setDeletingProblemId(targetProblem.id)'),
  },
  {
    name: 'problem bank list loads one server-filtered page instead of the full payload',
    pass:
      problemBankController.includes('listCourseProblemPage(courseId') &&
      problemBankController.includes('pageSize: PROBLEM_BANK_PAGE_SIZE') &&
      problemBankApi.includes('export async function listCourseProblemPage(') &&
      problemBankService.includes('COUNT(*) OVER()::int AS "filteredCount"') &&
      problemBankService.includes('LIMIT ${pageSize} OFFSET ${offset}'),
  },
  {
    name: 'empty problem banks show guidance instead of a zero-percent chart',
    pass:
      problemBank.includes('stats.total === 0') &&
      problemBank.includes("'暂无题目可统计'") &&
      problemBank.includes("'有题目后才计算完成率'") &&
      problemBank.includes("canEditProblems\n                  ? '导入第一批题目后"),
  },
  {
    name: 'fill-blank problems have inline inputs, symbol entry, submission, and grading support',
    pass:
      problemBank.includes('InlineFillBlankPrompt') &&
      problemBank.includes('fill-blank-${selectedProblem.id}-${selectedActiveBlank.id}') &&
      problemBank.includes('CommonMathSymbols') &&
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
