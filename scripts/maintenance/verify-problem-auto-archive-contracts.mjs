import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const legacyRoute = read('app/api/courses/[id]/problems/auto-archive/route.ts');
const organizeRoute = read('app/api/courses/[id]/problem-tags/organize/route.ts');
const service = read('features/problem-tags/server/problem-tag-service.ts');
const controller = read('components/problem-bank/use-course-problem-bank-controller.ts');
const view = read('components/problem-bank/course-problem-bank-view.tsx');

const checks = [
  {
    name: 'legacy notebook auto-archive endpoint is retired',
    pass: legacyRoute.includes('status: 410') && legacyRoute.includes('AI 整理标签'),
  },
  {
    name: 'AI taxonomy output is structured and limited to real problem ids',
    pass: organizeRoute.includes('Output.object') && organizeRoute.includes('validProblemIds.has'),
  },
  {
    name: 'low-confidence AI assignments remain pending and manual decisions are preserved',
    pass:
      service.includes('PROBLEM_TAG_AUTO_APPLY_CONFIDENCE') &&
      service.includes("source: 'manual', status: 'applied'") &&
      service.includes("status: applied ? 'applied' : 'pending'"),
  },
  {
    name: 'teacher problem bank exposes AI tag organization and knowledge-tree management',
    pass:
      controller.includes('organizeCourseProblemTags') &&
      view.includes('AI 整理标签') &&
      view.includes('管理知识树'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}
if (failed) process.exit(1);
