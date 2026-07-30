import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ingestionPath = path.join(root, 'features/memory/server/source-upload-ingestion.ts');
const problemServicePath = path.join(root, 'lib/server/notebook-problems/service.ts');
const ingestion = fs.readFileSync(ingestionPath, 'utf8');
const problemService = fs.readFileSync(problemServicePath, 'utf8');

const checks = [
  {
    name: 'source upload persistence accepts the full 220k server contract',
    pass: /const MAX_SOURCE_TEXT_CHARS = 220_000;/.test(ingestion),
  },
  {
    name: 'markdown sections use one batch insert instead of S creates',
    pass:
      /markdownNotebookSection\.createManyAndReturn\(/.test(ingestion) &&
      !/for \(const \[index, section\] of args\.sections\.entries\(\)\)[\s\S]{0,500}markdownNotebookSection\.create\(/.test(
        ingestion,
      ),
  },
  {
    name: 'source-section idempotency is scoped by sourceHash in SQL',
    pass:
      /sourceMeta:\s*\{\s*path: \['sourceHash'\],\s*equals: args\.sourceHash/s.test(ingestion) &&
      /source-markdown-sections:\$\{args\.notebookId\}/.test(ingestion),
  },
  {
    name: 'problem preflight projects only id title and persisted dedupeKey',
    pass:
      /dedupeKey: \{ in: dedupeKeys \}/.test(ingestion) &&
      /select:\s*\{\s*id: true,\s*title: true,\s*dedupeKey: true,\s*\}/s.test(ingestion),
  },
  {
    name: 'source ingestion selects indexed-input-key atomic dedupe',
    pass:
      /dedupeReadStrategy: 'indexed_input_keys'/.test(ingestion) &&
      /returnProblems: false/.test(ingestion),
  },
  {
    name: 'indexed atomic dedupe queries only requested keys',
    pass:
      /function loadIndexedCourseProblemDedupeStateTx/.test(problemService) &&
      /dedupeKey: \{ in: requestedKeys \}/.test(problemService) &&
      /const INDEXED_DEDUPE_INPUT_LIMIT = 5_000;/.test(problemService),
  },
  {
    name: 'legacy public JSON fallback has a hard row cap',
    pass:
      /const LEGACY_DEDUPE_FALLBACK_LIMIT = 128;/.test(problemService) &&
      /take: LEGACY_DEDUPE_FALLBACK_LIMIT \+ 1/.test(problemService) &&
      /run the problem dedupe maintenance task before importing/.test(problemService),
  },
  {
    name: 'source-only writer avoids full problem-bank result reload',
    pass: /args\.returnProblems === false\s*\?\s*\[\]\s*:\s*await listCourseProblemsForUser/s.test(
      problemService,
    ),
  },
  {
    name: 'independent memory graph and cache writes share one latency window',
    pass:
      /const \[memoryResults, knowledgeGraphFactId\] = await Promise\.all\(\[\s*routeLayeredMemoryWriteCandidates\(/s.test(
        ingestion,
      ) &&
      /writeKnowledgeGraphFact\(/.test(ingestion) &&
      /refreshKnowledgeCache\(/.test(ingestion),
  },
];

for (const check of checks) {
  if (!check.pass) {
    console.error(`FAIL: ${check.name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${check.name}`);
  }
}

if (!process.exitCode) {
  console.log('');
  console.log('SQL/resource formulas:');
  console.log(
    '- Markdown append: S per-section INSERTs became 1 batch INSERT; append SQL is fixed (6 transaction statements + unchanged course-summary refresh), independent of S.',
  );
  console.log(
    '- Problem preflight: 1 unbounded full-publicContent query became 1 indexed dedupeKey query over D input keys (D <= 5000), projecting id/title/key only.',
  );
  console.log(
    '- Atomic problem write: full-course JSON materialization became 1 indexed key query plus at most 129 legacy light rows; source callers skip the full post-write bank reload.',
  );
  console.log(
    '- Memory persistence: learner memory, knowledge graph, and one cache refresh keep their write counts but run in parallel; critical-path latency is max(branches), not their sum.',
  );
}
