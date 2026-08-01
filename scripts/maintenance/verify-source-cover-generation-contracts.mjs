#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertMatch(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Missing contract: ${label}`);
}

function assertAbsent(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Forbidden contract: ${label}`);
}

const imageRoute = read('app/api/generate/image/route.ts');
const sourceRoute = read('app/api/courses/[id]/source-ingest/route.ts');
const sourceCoverUpdateRoute = read('app/api/courses/[id]/source-uploads/[sourceHash]/route.ts');
const sourceCoverPatchHandler = sourceCoverUpdateRoute.split('export async function DELETE')[0];
const sourceIngestion = read('features/memory/server/source-upload-ingestion.ts');
const testWorkspace = read('features/qa/test-center/memory/memory-lifecycle-test-workspace.tsx');
const normalization = read('lib/media/image-result-normalization.ts');
const mediaTypes = read('lib/media/types.ts');
const pilot = read('scripts/maintenance/pilot-source-ingest-via-api.mjs');

assertMatch(
  normalization,
  /export async function normalizeRequestedImageDimensions[\s\S]*?resize\(width,\s*height,[\s\S]*?base64:\s*normalized\.toString\('base64'\),[\s\S]*?width,[\s\S]*?height,/,
  'shared image result normalization materializes the requested pixels',
);
assertMatch(
  imageRoute,
  /normalizeRequestedImageDimensions\([\s\S]*?body\.width,[\s\S]*?body\.height,[\s\S]*?proxyFetch as typeof fetch/,
  'image API normalizes the requested output dimensions',
);
assertAbsent(
  `${imageRoute}\n${mediaTypes}`,
  /coverOverlay|StudyCoverOverlaySpec|compositeStudyCover|study-cover-overlay/,
  'the generic image API and media contract contain no deterministic cover overlay',
);
assertMatch(
  sourceRoute,
  /prepareCheatSheetPrompt\([\s\S]*?coverTitle:\s*payload\.coverTitle,[\s\S]*?coverCourseLabel:\s*payload\.coverCourseLabel,[\s\S]*?coverFocus:\s*payload\.coverFocus/,
  'source preview uses the complete Cheat Sheet prompt builder',
);
assertMatch(
  sourceIngestion,
  /Asset type: final A4 portrait study Cheat Sheet image used directly as a notebook cover; there is no later typography or deterministic overlay\.[\s\S]*?核心定义 \/ Core definition[\s\S]*?方法怎么选 \/ Method choice[\s\S]*?提交前检查 \/ Checklist[\s\S]*?检索词 \/ Keywords/,
  'the prompt requests one complete dense Cheat Sheet image',
);
assertMatch(
  sourceIngestion,
  /style:\s*'detailed A4 portrait study cheat sheet'[\s\S]*?const outputBuffer = await sharp\(rendered\.buffer\)\.png\(\)\.toBuffer\(\)[\s\S]*?fs\.writeFile\([\s\S]*?outputBuffer\)/,
  'production persists the directly generated Cheat Sheet without an overlay compositor',
);
assertAbsent(
  sourceIngestion,
  /这只是封面底图|低对比度背景|确定性排版层|minimal A4 portrait|compositeStudyCover|coverSpec/,
  'the sparse background and overlay chain is absent from production ingestion',
);
assertMatch(
  testWorkspace,
  /prompt:\s*coverPreview\.prompt,[\s\S]*?style:\s*'detailed A4 portrait Chinese study cheat sheet'/,
  'the QA flow generates the same complete Cheat Sheet artifact',
);
assertAbsent(
  testWorkspace,
  /coverOverlay|coverPreview\.coverSpec|minimal A4 portrait study cover/,
  'the QA flow contains no sparse-cover compatibility path',
);
assertMatch(
  sourceIngestion,
  /metadata\.width !== SOURCE_COVER_WIDTH \|\|[\s\S]*?metadata\.height !== SOURCE_COVER_HEIGHT/,
  'production validates the final image as exactly 1024x1448',
);
assertMatch(
  sourceIngestion,
  /args\.requireNotebookCover[\s\S]*?notebookCover\.status !== 'generated'[\s\S]*?throw new Error\(/,
  'strict cover mode aborts ingestion before ready state',
);
assertMatch(
  pilot,
  /form\.append\('requireNotebookCover',\s*'true'\)/,
  'the ingestion pilot requires a generated cover',
);
assertMatch(
  sourceCoverPatchHandler,
  /requireUserId\(\)[\s\S]*?findStoredCourseSource\(\{[\s\S]*?userId:\s*auth\.userId,[\s\S]*?notebook\.findFirst\(\{[\s\S]*?ownerId:\s*auth\.userId/,
  'cover persistence remains owner scoped',
);
assertMatch(
  sourceCoverPatchHandler,
  /canonicalDecoded !== canonicalInput[\s\S]*?sharp\(sourceImage\)\.metadata\(\)[\s\S]*?sourceMetadataImage\.width !== SOURCE_COVER_WIDTH[\s\S]*?sourceMetadataImage\.height !== SOURCE_COVER_HEIGHT/,
  'cover persistence validates decoded image bytes and exact dimensions',
);
assertAbsent(
  sourceCoverPatchHandler,
  /coverOverlaySchema|coverSpec|StudyCoverOverlaySpec/,
  'cover persistence accepts no deterministic overlay specification',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'direct complete Cheat Sheet prompt',
        'no sparse background or deterministic overlay path',
        'shared 1024x1448 normalization and validation',
        'direct PNG persistence',
        'owner-scoped cover persistence',
      ],
    },
    null,
    2,
  )}\n`,
);
