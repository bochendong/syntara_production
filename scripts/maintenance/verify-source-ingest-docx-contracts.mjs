#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { parseDocxBuffer } from '../../lib/docx/parse-docx-buffer.ts';

const paths = {
  parser: 'lib/docx/parse-docx-buffer.ts',
  route: 'app/api/courses/[id]/source-ingest/route.ts',
  uploadIngestion: 'features/memory/server/source-upload-ingestion.ts',
  memoryIngestion: 'features/memory/server/source-ingestion.ts',
  memoryPlanRoute: 'app/api/memory/ingest/plan/route.ts',
  learn: 'components/learn/learn-page-client.tsx',
  qa: 'features/qa/test-center/workspace/platform-flow-test-workspace.tsx',
  planner: 'scripts/maintenance/plan-course-lesson-ingest-via-api.mjs',
  docs: 'docs/api/notebooks.md',
};

const fixtures = [
  {
    path: 'queue/CSC108/01_基础运算.docx',
    minimumChars: 5_000,
    requiredTerms: ['Introduction to Computer Programming', 'CSC 108'],
  },
  {
    path: 'queue/CSC108/02_Control.docx',
    minimumChars: 8_000,
    requiredTerms: ['docstring', 'Type Contract', 'Examples'],
  },
  {
    path: 'queue/CSC108/04_List.docx',
    minimumChars: 6_000,
    requiredTerms: ['list', 'def'],
    requiredSnippets: ['def function_1(x):\n    x = x + 1'],
  },
  {
    path: 'queue/CSC108/11_Class.docx',
    minimumChars: 1_000,
    requiredTerms: ['class'],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
  ),
);

assert(
  /JSZip\.loadAsync[\s\S]*word\/document\.xml[\s\S]*extractTextFromOpenXml/.test(source.parser),
  'DOCX parser must read word/document.xml through JSZip and OpenXML text extraction.',
);
assert(
  /MAX_DOCX_ENTRY_COUNT[\s\S]*MAX_DOCX_DECLARED_UNCOMPRESSED_BYTES/.test(source.parser) &&
    /nodeStream\('nodebuffer'\)/.test(source.parser) &&
    /totalBytes > MAX_DOCX_XML_PART_BYTES/.test(source.parser),
  'DOCX parser must bound archive entries and stream each expanded XML part under a byte limit.',
);
assert(
  !/\.replace\(\/\\n\[ \\t\]\+\/g,\s*'\\n'\)/.test(source.parser) &&
    !/\.replace\(\/\[ \\t\]\{2,\}\/g,\s*' '\)/.test(source.parser),
  'DOCX parser must preserve leading and repeated spaces used by Python source code.',
);
assert(
  /sourceKind:\s*z[\s\S]*?enum\(\[[^\]]*'docx'/.test(source.route) &&
    /value === 'docx'/.test(source.route) &&
    /endsWith\('\.docx'\)/.test(source.route) &&
    /args\.sourceKind === 'docx'[\s\S]*parser:\s*'docx-openxml'/.test(source.route) &&
    /code:\s*'INVALID_DOCX_SOURCE'[\s\S]*status:\s*\/too large\|larger than\/i\.test\(message\) \? 413 : 400/.test(
      source.route,
    ),
  'source-ingest route must validate, infer, parse, and label DOCX uploads.',
);
assert(
  /\|\s*'docx'/.test(source.uploadIngestion) &&
    /sourceKind\?:[^\n]*'pptx'[^\n]*'docx'/.test(source.memoryIngestion) &&
    /enum\(\[[^\]]*'pptx'[^\]]*'docx'/.test(source.memoryPlanRoute),
  'DOCX source identity must survive upload and memory planning.',
);
assert(
  /function isDocxSourceFile/.test(source.learn) &&
    /if \(isDocxSourceFile\(file\)\) return 'docx'/.test(source.learn) &&
    /wordprocessingml\.document/.test(source.learn),
  '/learn must recognize and allow DOCX source files.',
);
assert(
  /wordprocessingml\.document/.test(source.qa) && /return 'docx'/.test(source.qa),
  'QA source flow must recognize and allow DOCX source files.',
);
assert(
  /extension === '\.docx'\) return 'docx'/.test(source.planner),
  'read-only lesson planner must preserve DOCX source kind.',
);
assert(
  /pdf \| markdown \| plain_text \| pptx \| docx \| problem_bank \| other/.test(source.docs) &&
    /docx-openxml/.test(source.docs),
  'API documentation must publish the DOCX source contract.',
);

const fixtureResults = [];
for (const fixture of fixtures) {
  const buffer = await readFile(fixture.path);
  const parsed = await parseDocxBuffer({
    buffer,
    fileName: fixture.path,
    fileSize: buffer.length,
  });
  assert(
    parsed.text.length >= fixture.minimumChars,
    `${fixture.path} extracted only ${parsed.text.length} characters.`,
  );
  assert(
    parsed.metadata.paragraphCount > 0,
    `${fixture.path} did not report any OpenXML paragraphs.`,
  );
  for (const term of fixture.requiredTerms) {
    assert(
      parsed.text.toLowerCase().includes(term.toLowerCase()),
      `${fixture.path} is missing required extracted term: ${term}`,
    );
  }
  for (const snippet of fixture.requiredSnippets || []) {
    assert(
      parsed.text.includes(snippet),
      `${fixture.path} did not preserve required whitespace-sensitive snippet: ${snippet}`,
    );
  }
  fixtureResults.push({
    path: fixture.path,
    bytes: buffer.length,
    textChars: parsed.text.length,
    paragraphCount: parsed.metadata.paragraphCount,
    tableRowCount: parsed.metadata.tableRowCount,
    requiredTerms: fixture.requiredTerms,
    requiredSnippets: fixture.requiredSnippets || [],
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode: 'read_only_contract_and_fixture_validation',
      applicationWrites: 0,
      generationCalls: 0,
      apiCalls: 0,
      parser: 'docx-openxml',
      fixtures: fixtureResults,
    },
    null,
    2,
  )}\n`,
);
