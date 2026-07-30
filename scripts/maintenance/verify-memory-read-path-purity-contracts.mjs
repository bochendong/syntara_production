#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

const filePaths = {
  context: path.join(repositoryRoot, 'lib/server/study-memory-context.ts'),
  vectorStore: path.join(repositoryRoot, 'lib/server/study-memory-vector-store.ts'),
  memoryStore: path.join(repositoryRoot, 'lib/server/study-memory-store.ts'),
  layered: path.join(repositoryRoot, 'features/memory/server/layered-memory-context.ts'),
  cache: path.join(repositoryRoot, 'features/memory/server/knowledge-cache.ts'),
  ingestion: path.join(repositoryRoot, 'features/memory/server/source-upload-ingestion.ts'),
};

function readSource(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return { text, sourceFile };
}

function findFunction(source, name) {
  let match = null;
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name?.text === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source.sourceFile);
  if (!match) throw new Error(`Unable to find function ${name}`);
  return match.getText(source.sourceFile);
}

const sources = Object.fromEntries(
  Object.entries(filePaths).map(([key, filePath]) => [key, readSource(filePath)]),
);
const buildRecallPass = findFunction(sources.context, 'buildRecallPass');
const semanticSearchStudyMemoryChunks = findFunction(
  sources.vectorStore,
  'semanticSearchStudyMemoryChunks',
);
const listStudyMemoriesForViewer = findFunction(sources.memoryStore, 'listStudyMemoriesForViewer');
const listRecentPrivateNotebookLearnerMemoriesForCourse = findFunction(
  sources.memoryStore,
  'listRecentPrivateNotebookLearnerMemoriesForCourse',
);
const listCourseStudyMemoryLayersForViewer = findFunction(
  sources.memoryStore,
  'listCourseStudyMemoryLayersForViewer',
);
const listKnowledgeCache = findFunction(sources.cache, 'listKnowledgeCache');

const checks = [
  {
    name: 'ordinary recall does not import the lazy batch indexer',
    ok: !/\bindexStudyMemoryRecords\b/.test(sources.context.text),
  },
  {
    name: 'ordinary recall does not derive or synchronously upsert cache writes',
    ok:
      !/\bknowledgeCacheWritesFromResults\b/.test(sources.context.text) &&
      !/\brefreshKnowledgeCache\b/.test(sources.context.text),
  },
  {
    name: 'ordinary recall retains semantic reads from the existing chunk index',
    ok: /\bsemanticSearchStudyMemoryChunks\b/.test(buildRecallPass),
  },
  {
    name: 'semantic recall keeps query embedding but never creates the index on a read',
    ok:
      /\bcreateEmbedding\b/.test(semanticSearchStudyMemoryChunks) &&
      /\$queryRawUnsafe\b/.test(semanticSearchStudyMemoryChunks) &&
      !/\bensureStudyMemoryVectorIndex\b/.test(semanticSearchStudyMemoryChunks) &&
      !/\$executeRaw(?:Unsafe)?\b/.test(semanticSearchStudyMemoryChunks),
  },
  {
    name: 'independent memory stores start without a request waterfall',
    ok:
      /\bdirectLayersPromise\b/.test(buildRecallPass) &&
      /\bsemanticPromise\b/.test(buildRecallPass) &&
      /\bevidencePromise\b/.test(buildRecallPass) &&
      /await Promise\.all\(\s*\[\s*directLayersPromise,\s*semanticPromise,\s*evidencePromise,\s*knowledgeCachePromise,\s*learnerAnalyticsPromise/s.test(
        buildRecallPass,
      ),
  },
  {
    name: 'course direct-memory layers share one bounded database round trip',
    ok:
      /\blistCourseStudyMemoryLayersForViewer\b/.test(buildRecallPass) &&
      /\bUNION ALL\b/.test(listCourseStudyMemoryLayersForViewer) &&
      /'course'::text AS "memoryLayer"/.test(listCourseStudyMemoryLayersForViewer) &&
      /'platform'::text AS "memoryLayer"/.test(listCourseStudyMemoryLayersForViewer) &&
      /'course_learner'::text AS "memoryLayer"/.test(listCourseStudyMemoryLayersForViewer) &&
      /\bLIMIT \$4\b/.test(listCourseStudyMemoryLayersForViewer) &&
      /\bLIMIT \$5\b/.test(listCourseStudyMemoryLayersForViewer) &&
      /\bLIMIT \$6\b/.test(listCourseStudyMemoryLayersForViewer),
  },
  {
    name: 'answer-path direct memory projections are bounded before database materialization',
    ok:
      /listStudyMemoriesForViewer\(args\.prisma, args\.userId, args\.courseTarget, 4\)/.test(
        buildRecallPass,
      ) &&
      /listStudyMemoriesForViewer\(args\.prisma, args\.userId, args\.recallTarget, 8\)/.test(
        buildRecallPass,
      ) &&
      /platformTargetForOwner\([\s\S]*?\),\s*4,\s*\)/.test(buildRecallPass) &&
      /\bconst boundedLimit\b/.test(listStudyMemoriesForViewer) &&
      /\bLIMIT \$[34]\b/.test(listStudyMemoriesForViewer),
  },
  {
    name: 'direct memory lookups never create or alter storage on a read',
    ok: [
      listStudyMemoriesForViewer,
      listRecentPrivateNotebookLearnerMemoriesForCourse,
      listCourseStudyMemoryLayersForViewer,
    ].every(
      (source) =>
        !/\bensureStudyMemoryTable\b/.test(source) &&
        !/\$executeRaw(?:Unsafe)?\b/.test(source) &&
        !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(source),
    ),
  },
  {
    name: 'ordinary recall retains read-only warm-cache lookup',
    ok: /\blistKnowledgeCache\b/.test(buildRecallPass),
  },
  {
    name: 'ordinary recall contains no direct database mutation primitive',
    ok:
      !/\$executeRaw(?:Unsafe)?\b/.test(buildRecallPass) &&
      !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(buildRecallPass),
  },
  {
    name: 'warm-cache lookup no longer creates tables or indexes',
    ok:
      !/\bensureKnowledgeCacheTable\b/.test(listKnowledgeCache) &&
      !/\$executeRaw(?:Unsafe)?\b/.test(listKnowledgeCache),
  },
  {
    name: 'warm-cache lookup remains a bounded database read',
    ok:
      /\$queryRawUnsafe\b/.test(listKnowledgeCache) &&
      /\bLIMIT 120\b/.test(listKnowledgeCache) &&
      /\.slice\(0, Math\.max\(1, Math\.min\(args\.limit \?\? 8, 20\)\)\)/.test(listKnowledgeCache),
  },
  {
    name: 'read APIs no longer expose a cache-refresh toggle',
    ok:
      !/\brefreshKnowledgeCache\b/.test(sources.layered.text) &&
      !/\brefreshKnowledgeCache\b/.test(sources.context.text),
  },
  {
    name: 'cache writes remain available only to an explicit ingestion mutation path',
    ok:
      /export async function refreshKnowledgeCache\b/.test(sources.cache.text) &&
      /\brefreshKnowledgeCache\s*\(\s*\{/.test(sources.ingestion.text),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`PASS ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${checks.length} memory read-path purity checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS ${checks.length}/${checks.length} memory read-path purity checks.`);
}
