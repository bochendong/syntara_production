#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const context = read('lib/server/study-memory-context.ts');
const evidence = read('lib/server/memory-source-evidence.ts');
const knowledge = read('lib/server/memory-knowledge-search.ts');
const runtimeConfig = read('lib/server/system-llm-config.ts');
const notebookRepository = read('lib/server/repositories/notebook-repository.ts');
const notebookRoute = read('app/api/notebooks/route.ts');
const stageStorage = read('lib/utils/stage-storage.ts');
const memoryStore = read('lib/server/study-memory-store.ts');
const courseQuestionContext = read('lib/chat/server-course-question-context.ts');
const knowledgeDocumentIndex = read('lib/server/knowledge-document-index.ts');

assert.doesNotMatch(
  evidence,
  /LIMIT\s+(?:300|400|500)\b/,
  'AI evidence fallback must not materialize hundreds of full records.',
);
assert.match(evidence, /RAW_FALLBACK_SCAN_LIMIT\s*=\s*96/);
assert.match(evidence, /MARKDOWN_FALLBACK_CHARS\s*=\s*12_000/);
assert.match(evidence, /PROBLEM_FALLBACK_CHARS\s*=\s*10_000/);
assert.match(evidence, /MESSAGE_FALLBACK_CHARS\s*=\s*4_000/);
assert.match(
  evidence,
  /WITH scoped AS \([\s\S]*LIMIT \$4[\s\S]*"boundedMarkdown" AS "markdown"[\s\S]*LIMIT \$5/,
  'Markdown fallback must shortlist rows and project only a focused text window.',
);
assert.match(
  evidence,
  /WITH scoped AS \([\s\S]*LEFT\(scoped\."fullPublicText", \$8::integer\) AS "publicText"[\s\S]*LIMIT \$7/,
  'Problem fallback must return a bounded public-only projection.',
);
assert.match(
  evidence,
  /WITH recent_history AS \([\s\S]*LEFT\(message\."plainText", \$5::integer\)[\s\S]*LIMIT \$6[\s\S]*LIMIT \$7/,
  'Conversation evidence must bound message length and candidate count in SQL.',
);
assert.match(
  evidence,
  /baseMatches\?: MemoryEvidencePacket\[\][\s\S]*args\.baseMatches \?\?/,
  'Attempt evidence must be able to reuse already-retrieved problem candidates.',
);

assert.match(
  knowledge,
  /searchProblemSourceEvidence\(\{/,
  'Problem-bank summary and source evidence must share one retrieval implementation.',
);
assert.doesNotMatch(
  knowledge,
  /\$queryRaw|searchCourseKnowledge/,
  'Problem-bank summary must not maintain a second SQL/RAG implementation.',
);
assert.doesNotMatch(
  context,
  /\bsearchProblemBankKnowledge\b/,
  'The answer path must derive problem summaries from the shared evidence batch.',
);
assert.equal(
  context.match(/\bsearchProblemSourceEvidence\(\{/g)?.length ?? 0,
  1,
  'One recall pass should start only one problem-source retrieval.',
);
assert.match(
  context,
  /Promise\.all\(\[[\s\S]*searchMarkdownSourceEvidence\([\s\S]*searchProblemSourceEvidence\([\s\S]*searchStudentMessageEvidence\(/,
  'Independent evidence sources must not form a request waterfall.',
);
assert.match(context, /baseMatches:\s*problemEvidence/);
assert.match(context, /skipMarkdownSourceEvidence !== true/);
assert.match(
  context,
  /Promise\.all\(\[\s*factStatePromise,\s*localPassPromise,\s*recallPassPromise,\s*\]\)/,
  'Structured facts and independent recall stores must start in parallel.',
);
assert.match(
  memoryStore,
  /function listCourseStudyMemoryLayersForViewer[\s\S]*UNION ALL[\s\S]*UNION ALL/,
  'Course, platform, and course-learner direct memory should use one bounded SQL round trip.',
);
assert.match(
  courseQuestionContext,
  /resolvedTarget:\s*\{[\s\S]*targetType: 'course'[\s\S]*targetOwnerId: course\.ownerId/,
  'Trusted course access should be reused instead of queried again inside memory recall.',
);
assert.match(context, /budgetPromptSections\([\s\S]*9500/);
assert.match(context, /prompt:\s*compact\(prompt,\s*12000\)/);

assert.match(runtimeConfig, /RUNTIME_CONFIG_CACHE_TTL_MS\s*=\s*30_000/);
assert.match(runtimeConfig, /runtimeConfigCache\.expiresAt > now/);
assert.match(runtimeConfig, /invalidateSystemLLMRuntimeConfigCache\(\);/);
assert.match(
  knowledgeDocumentIndex,
  /SET LOCAL hnsw\.iterative_scan = 'strict_order'[\s\S]*maxWait:\s*5_000,[\s\S]*timeout:\s*15_000/,
  'Cold remote vector reads must keep the pgvector setting transaction alive beyond Prisma default.',
);

const librarySelect =
  notebookRepository.match(
    /const notebookLibraryListSelect = \{([\s\S]*?)\}\s+satisfies Prisma\.NotebookSelect;/,
  )?.[1] || '';
assert.ok(librarySelect, 'Notebook popup projection is missing.');
assert.match(librarySelect, /\bname:\s*true/);
assert.match(librarySelect, /\bsectionCount:\s*true/);
assert.match(librarySelect, /\bcontentVersion:\s*true/);
assert.doesNotMatch(librarySelect, /\bdescription:\s*true|\bcoverSlideJson:\s*true/);
assert.match(notebookRoute, /summary && courseId[\s\S]*listReadableNotebookLibraryItems/);
assert.match(stageStorage, /courseId=.*&summary=1/);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'bounded raw evidence fallback',
        'single problem retrieval implementation',
        'parallel independent evidence reads',
        'parallel fact and recall reads',
        'single-query course direct-memory layers',
        'trusted course-target reuse',
        'problem-attempt candidate reuse',
        'deterministic prompt character budget',
        'short-lived system model-config cache',
        'cold-vector transaction budget',
        'metadata-only notebook popup projection',
      ],
    },
    null,
    2,
  )}\n`,
);
