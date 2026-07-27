#!/usr/bin/env node

import fs from 'node:fs';

const repositoryPath = 'lib/server/repositories/notebook-repository.ts';
const routePath = 'app/api/notebooks/[id]/route.ts';
const dedupePath = 'features/problems/domain/problem-dedupe.ts';
const repository = fs.readFileSync(repositoryPath, 'utf8');
const route = fs.readFileSync(routePath, 'utf8');
const dedupe = fs.readFileSync(dedupePath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function indexOfOrThrow(source, pattern, message) {
  const index = source.search(pattern);
  assert(index >= 0, message);
  return index;
}

assert(
  /courseProblemDedupeKey/.test(repository) &&
    /notebookProblemPublicContentSchema\.safeParse/.test(repository),
  'course moves must compute canonical keys from validated problem content',
);
assert(
  /COURSE_PROBLEM_DEDUPE_VERSION\s*=\s*'v2'/.test(dedupe),
  'the shared canonical helper used by course moves must emit v2 keys',
);
assert(
  /const sortedCourseIds =[\s\S]*?\.sort\(\)[\s\S]*?for \(const courseId of sortedCourseIds\)[\s\S]*?pg_advisory_xact_lock[\s\S]*?course-problem-dedupe:/.test(
    repository,
  ),
  'old and new course advisory locks must use a stable sorted order and the import lock namespace',
);
assert(
  /planNotebookProblemCourseMove[\s\S]*?where:\s*\{\s*notebookId:\s*args\.notebookId[\s\S]*?courseId:\s*args\.targetCourseId/.test(
    repository,
  ) &&
    /kind:\s*'moving_notebook'/.test(repository) &&
    /kind:\s*'target_course'/.test(repository),
  'move preflight must check both notebook-local and target-course key collisions',
);
assert(
  /class NotebookCourseMoveDedupeError[\s\S]*?NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT[\s\S]*?invalidProblemIds/.test(
    repository,
  ),
  'repository must expose a structured, content-safe move error',
);

const clearKeyIndex = indexOfOrThrow(
  repository,
  /data:\s*\{\s*dedupeKey:\s*null\s*\}/,
  'move must clear problem dedupe keys',
);
const notebookMoveIndex = indexOfOrThrow(
  repository.slice(clearKeyIndex),
  /tx\.notebook\.updateMany\(/,
  'notebook course move must happen after key clearing',
);
const childCourseMoveIndex = indexOfOrThrow(
  repository.slice(clearKeyIndex + notebookMoveIndex),
  /tx\.notebookProblem\.updateMany\(\{[\s\S]*?data:\s*\{\s*courseId:\s*updated\.courseId\s*\}/,
  'problem courseId migration must happen after notebook migration',
);
const writeKeyIndex = indexOfOrThrow(
  repository.slice(clearKeyIndex + notebookMoveIndex + childCourseMoveIndex),
  /const keyAssignments = Array\.from\(movingProblemKeys\)[\s\S]*?SET "dedupeKey" = assignment\."dedupeKey"/,
  'target-course keys must be written only after courseId migration',
);
assert(writeKeyIndex >= 0, 'course move write order must be explicit');
assert(
  /if \(updated\.courseId\)\s*\{[\s\S]*?movingProblemKeys/.test(repository),
  'moving a notebook out of a course must leave cleared keys null',
);
assert(
  /error instanceof NotebookCourseMoveDedupeError[\s\S]*?code:\s*error\.code[\s\S]*?conflicts:\s*error\.conflicts[\s\S]*?\{\s*status:\s*409\s*\}/.test(
    route,
  ),
  'route must return structured HTTP 409 for move dedupe conflicts',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'sorted old/new course advisory locks',
        'canonical target and moving-notebook key computation',
        'target-course and intra-notebook conflict rollback',
        'clear key -> move courseId -> write key ordering',
        'null keys when moving out of a course',
        'structured HTTP 409 response',
      ],
    },
    null,
    2,
  )}\n`,
);
