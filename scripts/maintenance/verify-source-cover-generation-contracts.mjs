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

function assertOrder(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(`Missing ordered contract: ${label}`);
  }
}

const imageRoute = read('app/api/generate/image/route.ts');
const sourceRoute = read('app/api/courses/[id]/source-ingest/route.ts');
const sourceCoverUpdateRoute = read('app/api/courses/[id]/source-uploads/[sourceHash]/route.ts');
const sourceCoverPatchHandler = sourceCoverUpdateRoute.split('export async function DELETE')[0];
const sourceIngestion = read('features/memory/server/source-upload-ingestion.ts');
const testWorkspace = read('features/qa/test-center/memory/memory-lifecycle-test-workspace.tsx');
const overlay = read('lib/media/study-cover-overlay.ts');
const normalization = read('lib/media/image-result-normalization.ts');
const pilot = read('scripts/maintenance/pilot-source-ingest-via-api.mjs');
const coverRegenerationPilot = read(
  'scripts/maintenance/regenerate-mat102-pilot-cover-via-api.mjs',
);
const projectionTriggerMigration = read(
  'prisma/migrations/20260727060000_ignore_course_source_cover_projection_churn/migration.sql',
);

assertMatch(
  normalization,
  /export async function normalizeRequestedImageDimensions[\s\S]*?resize\(width,\s*height,[\s\S]*?base64:\s*normalized\.toString\('base64'\),[\s\S]*?width,[\s\S]*?height,/,
  'shared image result normalization materializes the requested pixels',
);
assertMatch(
  imageRoute,
  /import \{ normalizeRequestedImageDimensions \} from '@\/lib\/media\/image-result-normalization';[\s\S]*?normalizeRequestedImageDimensions\([\s\S]*?body\.width,[\s\S]*?body\.height,[\s\S]*?proxyFetch as typeof fetch/,
  'QA image API uses the shared target-size normalization',
);
assertMatch(
  imageRoute,
  /body\.coverOverlay[\s\S]*?compositeStudyCoverResult\(inlineResult,\s*body\.coverOverlay\)/,
  'QA image API applies the supplied deterministic cover overlay',
);
assertMatch(
  sourceRoute,
  /ingestCourseSourceUpload\(\{[\s\S]*?coverTitle:\s*payload\.coverTitle,[\s\S]*?coverCourseLabel:\s*payload\.coverCourseLabel,[\s\S]*?coverFocus:\s*payload\.coverFocus,[\s\S]*?requireNotebookCover:\s*payload\.requireNotebookCover/,
  'production source ingest forwards the cover prompt inputs and strict requirement',
);
assertMatch(
  sourceIngestion,
  /sourceCoverCompositionFromInputs\([\s\S]*?coverTitle:\s*args\.coverTitle,[\s\S]*?coverCourseLabel:\s*args\.coverCourseLabel,[\s\S]*?coverFocus:\s*args\.coverFocus/,
  'preview and production cover paths share one prompt composition',
);
assertMatch(
  sourceIngestion,
  /const routeItems = Array\.from\([\s\S]*?requestedFocus\.length \? requestedFocus : sourceMethodLabels[\s\S]*?\.slice\(0,\s*3\);[\s\S]*?routeItems,[\s\S]*?sideItems:\s*\[\],[\s\S]*?footerText,/,
  'shared cover specification remains sparse with no more than three method cards',
);
assertMatch(
  sourceIngestion,
  /这只是封面底图，不是完整 Cheat Sheet[\s\S]*?最多三个方法卡片、方法索引和黄色复习提醒[\s\S]*?不要自行排版标题、正文、列表、表格、信息卡片或可读段落/,
  'image model is asked for a sparse background rather than a dense cheat sheet',
);
assertMatch(
  sourceIngestion,
  /import \{ compositeStudyCoverBuffer \} from '@\/lib\/media\/study-cover-overlay';[\s\S]*?normalizeRequestedImageDimensions\([\s\S]*?const composedBuffer = await compositeStudyCoverBuffer\(\{[\s\S]*?source:\s*rendered\.buffer,[\s\S]*?spec:\s*coverComposition\.coverSpec,[\s\S]*?width:\s*SOURCE_COVER_WIDTH,[\s\S]*?height:\s*SOURCE_COVER_HEIGHT,[\s\S]*?fs\.writeFile\([\s\S]*?composedBuffer\)/,
  'production persists the deterministic overlay using its shared cover specification',
);
assertMatch(
  sourceIngestion,
  /metadata\.width !== SOURCE_COVER_WIDTH \|\|[\s\S]*?metadata\.height !== SOURCE_COVER_HEIGHT/,
  'production validates the composed cover is exactly 1024x1448',
);
assertMatch(
  sourceIngestion,
  /args\.requireNotebookCover[\s\S]*?notebookCover\.status !== 'generated'[\s\S]*?throw new Error\(/,
  'strict cover mode aborts ingestion before ready state',
);
assertMatch(
  testWorkspace,
  /prompt:\s*coverPreview\.prompt,[\s\S]*?style:\s*'minimal A4 portrait study cover background with generous whitespace',[\s\S]*?coverOverlay:\s*coverPreview\.coverSpec,/,
  'test cover generation sends the same preview cover specification to the image API',
);
assertMatch(
  overlay,
  /export async function compositeStudyCoverBuffer\([\s\S]*?studyCoverOverlaySvg\(args\.spec,\s*width,\s*height\)/,
  'test and production overlays use the same deterministic SVG compositor',
);
assertAbsent(
  sourceIngestion,
  /style:\s*'detailed A4 portrait Chinese study cheat sheet'/,
  'production no longer requests a dense cheat sheet',
);
assertMatch(
  pilot,
  /form\.append\('requireNotebookCover',\s*'true'\)/,
  'pilot explicitly requires a generated cover',
);
assertMatch(
  pilot,
  /import\('sharp'\)[\s\S]*?metadata\.width !== 1024 \|\| metadata\.height !== 1448[\s\S]*?width:\s*metadata\.width,[\s\S]*?height:\s*metadata\.height,/,
  'pilot records verified 1024x1448 asset dimensions',
);
assertMatch(
  sourceCoverPatchHandler,
  /requireUserId\(\)[\s\S]*?findStoredCourseSource\(\{[\s\S]*?userId:\s*auth\.userId,[\s\S]*?courseId:\s*id,[\s\S]*?notebook\.findFirst\(\{[\s\S]*?ownerId:\s*auth\.userId,[\s\S]*?courseId:\s*id/,
  'cover update authenticates and owner-scopes both the source and notebook',
);
assertMatch(
  sourceCoverPatchHandler,
  /metadataNotebookIds\.includes\(notebook\.id\)[\s\S]*?sectionLinked[\s\S]*?Notebook is not linked to this source upload[\s\S]*?currentlySectionLinked[\s\S]*?The notebook is no longer linked to this source upload/,
  'cover update verifies source-notebook linkage before decoding and again in the transaction',
);
assertMatch(
  sourceCoverPatchHandler,
  /canonicalDecoded !== canonicalInput[\s\S]*?sharp\(sourceImage\)\.metadata\(\)[\s\S]*?does not contain a valid PNG, JPEG, or WebP image[\s\S]*?sourceMetadataImage\.width !== SOURCE_COVER_WIDTH[\s\S]*?sourceMetadataImage\.height !== SOURCE_COVER_HEIGHT/,
  'cover update strictly decodes, parses, and dimension-checks image bytes',
);
assertMatch(
  sourceCoverPatchHandler,
  /safePathSegment\(id,\s*'course'\)[\s\S]*?safePathSegment\(notebook\.id,\s*'notebook'\)[\s\S]*?safePathSegment\(sourceHash\.slice\(0,\s*24\),\s*'source'\)[\s\S]*?writeFileAtomically/,
  'cover output path is made only from sanitized segments and written atomically',
);
assertMatch(
  sourceCoverPatchHandler,
  /const sourceUpdate = await tx\.courseSource\.updateMany\(\{[\s\S]*?ownerId:\s*auth\.userId,[\s\S]*?contentVersion:\s*currentSource\.contentVersion[\s\S]*?const notebookUpdate = await tx\.notebook\.updateMany\(\{[\s\S]*?ownerId:\s*auth\.userId,[\s\S]*?contentVersion:\s*currentNotebook\.contentVersion[\s\S]*?sourceUpdate\.count !== 1 \|\| notebookUpdate\.count !== 1[\s\S]*?CoverTargetChangedError/,
  'source and notebook writes use optimistic owner-scoped guards and roll back on either zero-row update',
);
assertMatch(
  sourceCoverPatchHandler,
  /const activeFact = await tx\.memoryFact\.findFirst\([\s\S]*?const factUpdate = await tx\.memoryFact\.updateMany\(\{[\s\S]*?id:\s*activeFact\.id,[\s\S]*?updatedAt:\s*activeFact\.updatedAt[\s\S]*?memoryFactEvent\.create/,
  'cover metadata updates the existing active MemoryFact and its event in the same transaction',
);
assertAbsent(
  sourceCoverPatchHandler,
  /upsertMemoryFact|notebookProblem\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)/,
  'cover update neither swaps MemoryFact identity nor mutates the problem bank',
);
assertOrder(
  coverRegenerationPilot,
  'const before = await loadPilotState();',
  "const generation = await api('/api/generate/image'",
  'MAT102 regeneration completes all read-only preflight assertions before image generation',
);
assertAbsent(
  coverRegenerationPilot,
  /async function loadPilotState\(\)[\s\S]*?Promise\.all/,
  'MAT102 preflight and postflight do not saturate the small Railway connection pool',
);
assertOrder(
  coverRegenerationPilot,
  'const sources = await api(',
  'const notebook = await api(',
  'MAT102 state reads source metadata before the notebook without DB concurrency',
);
assertOrder(
  coverRegenerationPilot,
  'const notebook = await api(',
  'const problems = await api(',
  'MAT102 state reads notebook and problem state serially',
);
assertOrder(
  coverRegenerationPilot,
  'const problems = await api(',
  'const contentState = await api(',
  'MAT102 state reads content synchronization state only after the problem baseline',
);
assertMatch(
  coverRegenerationPilot,
  /before\.source\.ingestStatus,\s*'ready'[\s\S]*?before\.notebook\?\.notebook\?\.accessRole,\s*'owner'[\s\S]*?before\.sourceNotebookIds,[\s\S]*?\[NOTEBOOK_ID\][\s\S]*?before\.sourceFactIds\.length,[\s\S]*?1,[\s\S]*?before\.problemIds\.length,\s*EXPECTED_PROBLEM_COUNT/,
  'MAT102 regeneration preflight verifies readiness, ownership, exact linkage, stable memory, and the 417-problem baseline',
);
assertMatch(
  coverRegenerationPilot,
  /after\.sourceFactIds,[\s\S]*?before\.sourceFactIds,[\s\S]*?without replacing its ID[\s\S]*?after\.problemIds,[\s\S]*?before\.problemIds,[\s\S]*?must not add, remove, or replace any course problem/,
  'MAT102 regeneration verifies stable MemoryFact and exact problem ID sets after persistence',
);
assertMatch(
  projectionTriggerMigration,
  /DROP TRIGGER IF EXISTS "CourseSource_search_projection_stale"[\s\S]*?CREATE TRIGGER "CourseSource_search_projection_stale"[\s\S]*?WHEN \(/,
  'cover-only projection invalidation fix replaces the broad CourseSource update trigger',
);
assertMatch(
  projectionTriggerMigration,
  /^BEGIN;[\s\S]*?OLD\."metadataJson" = 'null'::jsonb[\s\S]*?jsonb_typeof\(OLD\."metadataJson"\) = 'object'[\s\S]*?NEW\."metadataJson" = 'null'::jsonb[\s\S]*?jsonb_typeof\(NEW\."metadataJson"\) = 'object'[\s\S]*?COMMIT;\s*$/m,
  'projection trigger migration is transactional and handles SQL null, JSON null, and non-object JSON safely',
);
for (const coverMetadataKey of [
  'coverImagePath',
  'coverStatus',
  'coverProviderId',
  'coverModel',
  'coverPromptHash',
  'coverSpec',
  'coverUpdatedAt',
]) {
  if (!projectionTriggerMigration.includes(`'${coverMetadataKey}'`)) {
    throw new Error(`Missing cover-only projection key: ${coverMetadataKey}`);
  }
}
assertMatch(
  projectionTriggerMigration,
  /OLD\."title" IS DISTINCT FROM NEW\."title"[\s\S]*?OLD\."kind" IS DISTINCT FROM NEW\."kind"[\s\S]*?OLD\."extractedText" IS DISTINCT FROM NEW\."extractedText"/,
  'searchable CourseSource text changes still invalidate the projection',
);
assertMatch(
  projectionTriggerMigration,
  /CREATE TRIGGER "CourseSource_search_projection_delete"[\s\S]*?AFTER DELETE[\s\S]*?EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"/,
  'CourseSource deletion still invalidates dependent search documents',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'shared QA and production image dimension normalization',
        'QA image API deterministic overlay application',
        'cover prompt input forwarding',
        'shared cover prompt composition',
        'sparse three-card cover specification',
        'background-only image prompt',
        'shared deterministic overlay in test and production',
        'physical 1024x1448 composed asset validation',
        'strict cover failure propagation',
        'pilot cover requirement and physical asset evidence',
        'owner-scoped cover update and source-notebook linkage',
        'strict image byte validation and safe atomic path',
        'atomic source, notebook, and stable-identity MemoryFact persistence',
        'problem-bank non-mutation and exact postflight invariant',
        'token-saving preflight before MAT102 image generation',
        'serialized MAT102 preflight and postflight database reads',
        'cover-only metadata does not invalidate source search projection',
        'cover trigger handles scalar JSON in one explicit transaction',
        'searchable source updates and deletes still invalidate projection',
      ],
    },
    null,
    2,
  )}\n`,
);
