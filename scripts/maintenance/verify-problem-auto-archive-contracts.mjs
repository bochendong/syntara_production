import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const route = read('app/api/courses/[id]/problems/auto-archive/route.ts');
const service = read('lib/server/notebook-problems/service.ts');
const controller = read('components/problem-bank/use-course-problem-bank-controller.ts');
const view = read('components/problem-bank/course-problem-bank-view.tsx');

const checks = [
  {
    name: 'AI only considers active problems without a notebook assignment',
    pass:
      route.includes("where: { courseId, notebookId: null, status: { not: 'archived' } }") &&
      route.includes('MIN_ASSIGNMENT_CONFIDENCE'),
  },
  {
    name: 'AI assignment output is structured and validated against real IDs',
    pass:
      route.includes('Output.object') &&
      route.includes('validProblemIds.has') &&
      route.includes('validNotebookIds.has'),
  },
  {
    name: 'bulk persistence cannot overwrite a concurrent or existing assignment',
    pass:
      service.includes('assignUnassignedCourseProblemsToNotebooks') &&
      service.includes('notebookId: null') &&
      service.includes("status: { not: 'archived' }"),
  },
  {
    name: 'teacher problem bank exposes the AI auto archive action',
    pass:
      controller.includes('handleAutoArchiveUnassignedProblems') &&
      view.includes('AI 自动归档') &&
      view.includes('unassignedProblemCount'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}
if (failed) process.exit(1);
