#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  containsCourseSourceIdentity,
  detachCourseProblemSource,
} from '../../features/memory/server/detach-course-problem-source.mjs';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertMatch(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing contract: ${label}`);
  }
}

const library = read('features/memory/server/source-upload-library.ts');
const singleRoute = read('app/api/courses/[id]/source-uploads/[sourceHash]/route.ts');
const bulkRoute = read('app/api/courses/[id]/source-uploads/route.ts');
const ingestRoute = read('app/api/courses/[id]/source-ingest/route.ts');
const ingestion = read('features/memory/server/source-upload-ingestion.ts');
const problemDedupe = read('features/problems/domain/problem-dedupe.ts');

assertMatch(
  library,
  /preserveProblems\?: boolean/,
  'source deletion service exposes an opt-in problem preservation flag',
);
assertMatch(
  library,
  /if\s*\(\s*args\.preserveProblems\s*\)\s*\{[\s\S]*?\}\s*else if\s*\(\s*deletableProblemIds\.length\s*>\s*0\s*\)\s*\{[\s\S]*?id:\s*\{\s*in:\s*deletableProblemIds\s*\}[\s\S]*?notebookProblem\.deleteMany|if\s*\(\s*args\.preserveProblems\s*\)\s*\{[\s\S]*?\}\s*else if\s*\(\s*deletableProblemIds\.length\s*>\s*0\s*\)\s*\{[\s\S]*?notebookProblem\.deleteMany[\s\S]*?id:\s*\{\s*in:\s*deletableProblemIds\s*\}/,
  'problem deletion is guarded by preserveProblems',
);
assertMatch(
  library,
  /const reusedProblemIdSet = new Set\(source\.reusedProblemIds\);[\s\S]*?const deletableProblemIds = source\.problemIds\.filter\([\s\S]*?!reusedProblemIdSet\.has\(problemId\)/,
  'ordinary source deletion excludes reused course problems',
);
assertMatch(
  library,
  /for \(const otherStoredSource of storedSources \?\? \[\]\)[\s\S]*?otherStoredSource\.sourceHash === sourceHash[\s\S]*?storedSourceRecord\(otherStoredSource\)\.problemIds[\s\S]*?for \(const otherArtifactSource of collection\.records\)[\s\S]*?otherArtifactSource\.sourceHash === sourceHash[\s\S]*?otherArtifactSource\.problemIds/,
  'ordinary source deletion preserves problems associated with another source',
);
assertMatch(
  library,
  /!args\.preserveProblems && retainedProblemIds\.length > 0[\s\S]*?detachCourseProblemSource\([\s\S]*?sourceDigest:\s*sourceHash[\s\S]*?notebookProblem\.update/,
  'ordinary deletion detaches deleted-source provenance from retained shared problems',
);
assertMatch(
  library,
  /const reusedProblemIds = stringArray\(metadata\.reusedProblemIds\);[\s\S]*?const problemIds = Array\.from\([\s\S]*?metadata\.problemIds[\s\S]*?reusedProblemIds/,
  'catalog records expose combined problem IDs and reused problem IDs',
);
assertMatch(
  library,
  /preservedProblems:\s*preservedProblemCount/,
  'source deletion reports the preserved problem count',
);
assertMatch(
  library,
  /if\s*\(\s*args\.preserveProblems\s*\)\s*\{[\s\S]*?detachCourseProblemSource\([\s\S]*?notebookProblem\.update/,
  'preserved problems detach source identity before the source can be ingested again',
);

assertMatch(
  singleRoute,
  /preserveProblemsParam\s*!==\s*null\s*&&\s*preserveProblemsParam\s*!==\s*'1'/,
  'single-source DELETE rejects attempts to disable problem preservation',
);
assertMatch(
  singleRoute,
  /deleteCourseSourceUpload\(\{[\s\S]*?preserveProblems:\s*true,[\s\S]*?\}\)/,
  'single-source DELETE always preserves problems',
);

assertMatch(bulkRoute, /export async function DELETE\(/, 'bulk source DELETE exists');
assertMatch(
  bulkRoute,
  /preserveProblemsParam\s*!==\s*null\s*&&\s*preserveProblemsParam\s*!==\s*'1'/,
  'bulk source DELETE rejects attempts to disable problem preservation',
);
assertMatch(
  bulkRoute,
  /deleteCourseSourceUpload\(\{[\s\S]*?preserveProblems:\s*true,[\s\S]*?\}\)/,
  'bulk source DELETE always preserves problems',
);
assertMatch(
  bulkRoute,
  /listCourseSourceUploads\(\{[\s\S]*?includeArtifacts:\s*true,[\s\S]*?serializeDatabaseReads:\s*true/,
  'bulk source DELETE serializes its source snapshot reads',
);
assertMatch(
  bulkRoute,
  /beforeProblemIds[\s\S]*afterProblemIds[\s\S]*sameIds\(/,
  'bulk source DELETE compares before and after problem IDs',
);
assertMatch(
  bulkRoute,
  /PROBLEM_PRESERVATION_INVARIANT_FAILED/,
  'bulk source DELETE rejects a changed problem invariant',
);
assertMatch(
  library,
  /collectCourseSourceUploads\(\{[\s\S]*?serializeDatabaseReads:\s*true,[\s\S]*?\}\),[\s\S]*?\] as const,[\s\S]*?true,[\s\S]*?\);/,
  'source deletion serializes catalog and legacy artifact preflight reads',
);

const sourceDigest = 'same-source-digest';
const originalProblemMeta = {
  uploadSourceHash: sourceDigest,
  uploadSourceTitle: 'Lecture 1',
  nested: {
    provenance: [
      { sourceHash: sourceDigest, page: 4 },
      { sourceHash: 'unrelated-source', page: 5 },
    ],
  },
  dedupeFingerprint: 'stable-question-fingerprint',
};
const detached = detachCourseProblemSource({
  sourceMeta: originalProblemMeta,
  sourceDigest,
  sourceTitle: 'Lecture 1',
  detachedAt: '2026-07-26T00:00:00.000Z',
});
if (!detached.changed) {
  throw new Error('Preserved problem metadata was not detached from its deleted source');
}
if (containsCourseSourceIdentity(detached.sourceMeta, sourceDigest)) {
  throw new Error('Deleted source identity remains discoverable in preserved problem metadata');
}
if (detached.sourceMeta.nested.provenance[1].sourceHash !== 'unrelated-source') {
  throw new Error('Detaching one source unexpectedly removed unrelated provenance');
}
if (detached.sourceMeta.dedupeFingerprint !== originalProblemMeta.dedupeFingerprint) {
  throw new Error('Problem fingerprint provenance changed during source detachment');
}
if (detached.sourceMeta.detachedSourceDigest !== sourceDigest) {
  throw new Error('Detached problem provenance did not retain the source digest');
}

assertMatch(
  ingestRoute,
  /sourceMeta:\s*\{\s*path:\s*\['uploadSourceHash'\],[\s\S]*?sourceMeta:\s*\{\s*path:\s*\['sourceHash'\]/,
  'legacy duplicate preflight only treats active problem source identity keys as source ownership',
);
assertMatch(
  problemDedupe,
  /function fullProblemFingerprint\([\s\S]*?input\.type[\s\S]*?normalizeProblemDedupeText\(input\.title\)[\s\S]*?problemDedupeStem\(input\.publicContent\)/,
  'problem fingerprinting depends on problem content rather than source metadata',
);
assertMatch(
  problemDedupe,
  /function contentOnlyProblemFingerprint\([\s\S]*?compactStem\.length\s*>=\s*18[\s\S]*?compactStem\.length\s*>=\s*48\s*&&\s*tokens\.length\s*>=\s*7[\s\S]*?uniqueCharacters\s*<\s*8[\s\S]*?return sha256\(`\$\{input\.type\}/,
  'title-independent fingerprint rejects empty, short, and generic stems',
);
assertMatch(
  problemDedupe,
  /replace\(\/\[≤≦⩽\]\/gu,\s*'<='\)[\s\S]*?replace\(\/\[≥≧⩾\]\/gu,\s*'>='\)[\s\S]*?replace\(\/\[≠\]\/gu,\s*'!='\)/,
  'content fingerprint preserves inequality direction and equality operators',
);
if (/take:\s*5000/.test(ingestion)) {
  throw new Error('Existing course problem fingerprint loading is still capped at 5000 rows');
}
assertMatch(
  ingestion,
  /orderBy:\s*\{\s*id:\s*'asc'\s*\}/,
  'existing problem fingerprint selection is deterministic and uncapped',
);
assertMatch(
  ingestion,
  /existingByContentFingerprint[\s\S]*?existingProblemId:\s*existingMatch\.id[\s\S]*?reusedProblemIds:\s*Array\.from\(reusedProblemIds\)\.sort\(\)/,
  're-ingestion records the existing problem IDs matched by full or content-only fingerprint',
);
assertMatch(
  ingestion,
  /const associatedProblemIds = Array\.from\([\s\S]*?insertedProblemIds[\s\S]*?reusedProblemIds[\s\S]*?\)\.sort\(\)/,
  'source ingestion combines inserted and reused problem IDs without writing reused problem provenance',
);
assertMatch(
  ingestRoute,
  /problemIds:\s*result\.problems\.associatedProblemIds,[\s\S]*?insertedProblemIds:\s*result\.problems\.insertedProblemIds,[\s\S]*?reusedProblemIds:\s*result\.problems\.reusedProblemIds/,
  'CourseSource metadata persists combined, inserted, and reused problem IDs',
);
assertMatch(
  ingestRoute,
  /problemCount:\s*result\.problems\.associatedCount,[\s\S]*?reusedProblemCount:\s*result\.problems\.reusedProblemIds\.length/,
  'CourseSource artifact counts include reused problem associations',
);
assertMatch(
  ingestRoute,
  /deleteCourseSourceUpload\(\{[\s\S]*?preserveCatalog:\s*true,[\s\S]*?\}\)/,
  'failed ingestion compensation uses the reuse-safe source deletion service',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'service preserveProblems guard',
        'single-source forced preservation',
        'bulk forced preservation',
        'before/after problem ID invariant',
        'recursive source provenance detachment',
        'same source can pass legacy duplicate preflight after deletion',
        'full and guarded content-only problem fingerprint dedupe',
        'uncapped deterministic existing-problem scan',
        'CourseSource combined and reused problem associations',
        'ordinary deletion and failure compensation preserve reused and shared problems',
      ],
    },
    null,
    2,
  )}\n`,
);
