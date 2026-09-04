import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const legacyRoute = read('app/api/courses/[id]/problems/auto-archive/route.ts');
const archiveRoute = read('app/api/courses/[id]/problem-chapters/archive/route.ts');
const chapterRoute = read('app/api/courses/[id]/problem-chapters/route.ts');
const controller = read('components/problem-bank/use-course-problem-bank-controller.ts');
const view = read('components/problem-bank/course-problem-bank-view.tsx');

const checks = [
  {
    name: 'legacy notebook auto-archive endpoint is retired',
    pass: legacyRoute.includes('status: 410') && legacyRoute.includes('problem-chapters/archive'),
  },
  {
    name: 'AI filing requires teacher-created chapters',
    pass:
      archiveRoute.includes('CHAPTER_REQUIRED') &&
      archiveRoute.includes('chapters.length === 0') &&
      chapterRoute.includes('courseProblemChapter.create'),
  },
  {
    name: 'AI filing only updates unfiled real problems into real chapters',
    pass:
      archiveRoute.includes('Output.object') &&
      archiveRoute.includes('validProblemIds.has') &&
      archiveRoute.includes('validChapterIds.has') &&
      archiveRoute.includes('chapterId: null'),
  },
  {
    name: 'teacher problem bank exposes chapter management and AI filing',
    pass:
      controller.includes('archiveCourseProblems') &&
      view.includes('AI 归档') &&
      view.includes('管理章节') &&
      view.includes('handleChangeProblemChapter'),
  },
  {
    name: 'practice navigation follows the active filtered sequence',
    pass:
      controller.includes('filteredSequenceProblems') &&
      controller.includes('practiceNavigationProblemCount = filteredSequenceProblems.length'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}
if (failed) process.exit(1);
