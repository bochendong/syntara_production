#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const retrieval = read('features/memory/server/bounded-course-source-retrieval.ts');
const contextBuilder = read('lib/chat/server-course-question-context.ts');
const sourceLibrary = read('features/memory/server/source-upload-library.ts');

assert.match(retrieval, /maxSnippets:\s*12/);
assert.match(retrieval, /maxSnippetChars:\s*1_600/);
assert.match(retrieval, /maxTotalChars:\s*9_000/);
assert.match(retrieval, /fallbackCandidatesPerBand:\s*8/);
assert.match(retrieval, /fallbackMaxCandidates:\s*24/);

assert.match(
  retrieval,
  /FROM "KnowledgeChunk" c[\s\S]*INNER JOIN "KnowledgeDocument" d[\s\S]*INNER JOIN "CourseSource" source/,
  'The primary source reader must use the search projection, not source Markdown rows.',
);
assert.match(
  retrieval,
  /c\."courseId" = \$1[\s\S]*d\."courseId" = \$1[\s\S]*source\."courseId" = \$1[\s\S]*c\."ownerId" = \$2[\s\S]*d\."ownerId" = \$2[\s\S]*source\."ownerId" = \$2/,
  'KnowledgeChunk retrieval must bind both course and owner at every projection boundary.',
);
assert.match(
  retrieval,
  /source\."kind" <> 'problem_bank'[\s\S]*source\."metadataJson"->>'allQuestionUpload' IS DISTINCT FROM 'true'/,
  'Question-only uploads must stay outside explanatory source evidence.',
);
assert.match(
  retrieval,
  /LEFT\(c\."chunkText", \$5\) AS "excerpt"[\s\S]*LIMIT \$6[\s\S]*"cumulativeChars" <= \$7/,
  'Indexed retrieval must project bounded chunks, rows, and aggregate characters in SQL.',
);
assert.doesNotMatch(
  retrieval,
  /d\."content"\s+AS|"content"\s*,/,
  'The answer reader must not project KnowledgeDocument.content.',
);
assert.doesNotMatch(
  retrieval,
  /createEmbedding|createEmbeddings|embedding-client|\$executeRaw|INSERT INTO|UPDATE "|DELETE FROM/,
  'Course-source reads must not trigger embeddings or database writes.',
);

assert.match(
  retrieval,
  /WITH eligible_metadata AS MATERIALIZED[\s\S]*LEFT\(COALESCE\(section\."summary", ''\), \$9\)[\s\S]*metadata_hits[\s\S]*ordered_head[\s\S]*recent_head/,
  'Fallback selection must begin with lightweight, bounded metadata bands.',
);
assert.match(
  retrieval,
  /candidate_ids AS \([\s\S]*LIMIT \$10[\s\S]*INNER JOIN "MarkdownNotebookSection" section ON section\."id" = candidate\."id"/,
  'Markdown may only be touched after a SQL-limited candidate-ID shortlist.',
);
assert.match(
  retrieval,
  /substring\([\s\S]*section\."markdown"[\s\S]*FOR \$6[\s\S]*LIMIT \$7[\s\S]*"cumulativeChars" <= \$8/,
  'Fallback transfer must use focused windows plus row and total-character limits.',
);
assert.doesNotMatch(
  retrieval,
  /SELECT[\s\S]{0,300}section\."markdown"\s*(?:,|\n)/,
  'Fallback SQL must never return the full Markdown column.',
);

assert.match(contextBuilder, /includeTextSections:\s*false/);
assert.doesNotMatch(contextBuilder, /includeTextSections:\s*true/);
assert.match(
  contextBuilder,
  /Promise\.all\(\[[\s\S]*listCourseSourceUploads\([\s\S]*retrieveBoundedCourseSourceSnippets\(/,
  'Source metadata and bounded evidence should load concurrently.',
);
assert.match(
  contextBuilder,
  /buildLayeredMemoryRecallContext\(\{[\s\S]{0,500}skipMarkdownSourceEvidence:\s*true/,
  'Layered learner-memory retrieval must not repeat the dedicated course-source query.',
);
assert.match(
  contextBuilder,
  /buildSourceCandidates\(\s*sources:\s*CourseSourceUploadRecord\[\],\s*snippets:\s*BoundedCourseSourceSnippet\[\]/,
  'Node ranking may only see bounded snippets, not full source Markdown.',
);
assert.match(
  sourceLibrary,
  /Heavy detail\/admin projection[\s\S]*includeTextSections\?: boolean/,
  'The heavy source-text projection must remain explicitly marked as non-answer-path data.',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'metadata-only answer bootstrap',
        'single dedicated course-source retrieval path',
        'course-and-owner isolated KnowledgeChunk retrieval',
        'no KnowledgeDocument.content projection',
        'no embedding or write side effect',
        '12-row and 1600-char per-snippet SQL limits',
        '9000-char aggregate SQL and Node budgets',
        '24-row metadata-first Markdown fallback shortlist',
        'no full Markdown result projection',
        'question-only source exclusion',
      ],
    },
    null,
    2,
  )}\n`,
);
