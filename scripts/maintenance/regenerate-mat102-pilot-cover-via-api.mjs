#!/usr/bin/env node

import assert from 'node:assert/strict';
import sharp from 'sharp';

const COURSE_ID = 'cmpd5bird007v8ogmjuuiio03';
const NOTEBOOK_ID = 'cms1s0lus00037zixmy59i3mk';
const SOURCE_HASH = '289ed839e6352a25784065c48d9b9cbb68202e50e5d14f82826ffb9323379206';
const EXPECTED_PROBLEM_COUNT = 417;
const WIDTH = 1024;
const HEIGHT = 1448;

const baseUrl = (process.env.OPENMAIC_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const userId = process.env.SYNTARA_PUBLIC_API_USER_ID?.trim();
const userEmail = process.env.SYNTARA_PUBLIC_API_USER_EMAIL?.trim();

if (!userId) {
  throw new Error('SYNTARA_PUBLIC_API_USER_ID is required.');
}

const commonHeaders = {
  'x-user-id': userId,
  ...(userEmail ? { 'x-user-email': userEmail } : {}),
};

async function api(pathname, init = {}, timeoutMs = 360_000) {
  const method = init.method || 'GET';
  const startedAt = Date.now();
  process.stderr.write(`[mat102-cover] ${method} ${pathname}\n`);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...commonHeaders,
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  process.stderr.write(
    `[mat102-cover] ${method} ${pathname} completed in ${Date.now() - startedAt}ms\n`,
  );
  return body;
}

function sortedUniqueStrings(values) {
  return Array.from(
    new Set(
      Array.isArray(values)
        ? values
            .filter((value) => typeof value === 'string' && value.trim())
            .map((value) => value.trim())
        : [],
    ),
  ).sort();
}

async function loadPilotState() {
  // Keep Railway's small public-proxy pool stable. These reads are deliberately
  // serialized so preflight/postflight never compete for three scarce leases.
  const sources = await api(
    `/api/courses/${encodeURIComponent(
      COURSE_ID,
    )}/source-uploads?includeText=0&includeArtifacts=0&deferKnowledgeSync=1`,
    {},
    180_000,
  );
  const notebook = await api(
    `/api/notebooks/${encodeURIComponent(NOTEBOOK_ID)}?includeScenes=0`,
    {},
    180_000,
  );
  const problems = await api(
    `/api/courses/${encodeURIComponent(COURSE_ID)}/problems?summary=1`,
    {},
    180_000,
  );
  const contentState = await api(
    `/api/courses/${encodeURIComponent(COURSE_ID)}/content-state`,
    {},
    180_000,
  );
  const source = sources?.uploads?.find((item) => item.sourceHash === SOURCE_HASH);
  return {
    sources,
    source,
    notebook,
    problems,
    contentState,
    sourceHashes: sortedUniqueStrings(sources?.uploads?.map((item) => item.sourceHash)),
    sourceNotebookIds: sortedUniqueStrings(source?.notebookIds),
    sourceFactIds: sortedUniqueStrings(source?.knowledgeGraphFactIds),
    problemIds: sortedUniqueStrings(problems?.problems?.map((problem) => problem.id)),
  };
}

const coverSpec = {
  title: 'MAT102 Induction I',
  courseLabel: 'MAT102',
  routeTitle: '方法路线',
  routeItems: ['资料总览', '核心概念', '方法与证据'],
  sideTitle: '关键边界',
  sideItems: [],
  footerTitle: '复习提醒',
  footerText: '先检查适用条件，再选择方法，最后写出结论边界。',
};

const prompt = [
  '生成一张 A4 竖版课程笔记本封面的低对比度背景，比例接近 1:1.414。',
  '这只是封面底图，不是完整 Cheat Sheet。标题、最多三个方法卡片、方法索引和黄色复习提醒会由确定性排版层统一叠加。',
  '保留大面积干净白纸和清晰留白；只使用很淡的课程相关线稿、手写符号轮廓或少量柔和荧光笔痕迹作为背景装饰。',
  '不要自行排版标题、正文、列表、表格、信息卡片或可读段落，不要填满页面；视觉信息必须克制，不能与后续排版层争抢注意力。',
  '不得生成乱码、伪汉字、无关公式、写实照片、品牌 logo 或水印。',
  '严格忠于下方主题，只把它当作背景视觉线索，不要把这些内容直接写在图中。',
  '',
  '背景视觉线索：',
  JSON.stringify(
    {
      title: coverSpec.title,
      courseLabel: coverSpec.courseLabel,
      methodLabels: coverSpec.routeItems,
      keywords: ['mathematical induction', 'base case', 'induction hypothesis', 'induction step'],
    },
    null,
    2,
  ),
].join('\n');

// Fail before spending image-generation tokens if the API identity, target
// linkage, or preserved problem-bank baseline is not the expected pilot.
const before = await loadPilotState();
assert.ok(before.source, 'MAT102 pilot source must be visible before image generation.');
assert.equal(before.source.ingestStatus, 'ready');
assert.equal(before.notebook?.notebook?.id, NOTEBOOK_ID);
assert.equal(before.notebook?.notebook?.courseId, COURSE_ID);
assert.equal(before.notebook?.notebook?.accessRole, 'owner');
assert.deepEqual(before.sourceHashes, [SOURCE_HASH]);
assert.deepEqual(
  before.sourceNotebookIds,
  [NOTEBOOK_ID],
  'MAT102 pilot source must be linked to exactly the authorized pilot notebook.',
);
assert.equal(
  before.sourceFactIds.length,
  1,
  'MAT102 pilot source must have one stable knowledge-graph fact before regeneration.',
);
assert.equal(before.contentState?.notebooks?.count, 1);
assert.equal(before.contentState?.sources?.count, 1);
assert.equal(before.problemIds.length, EXPECTED_PROBLEM_COUNT);

const generation = await api('/api/generate/image', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-image-provider': 'openai-image',
    'x-image-model': 'gpt-image-2',
  },
  body: JSON.stringify({
    prompt,
    negativePrompt:
      '密集文字、可读段落、表格、信息卡片、乱码、伪汉字、无意义文字、无关公式、写实照片、广告海报、黑色背景、logo、水印',
    width: WIDTH,
    height: HEIGHT,
    style: 'minimal A4 portrait study cover background with generous whitespace',
    quality: 'medium',
    coverOverlay: coverSpec,
    notebookContext: {
      id: NOTEBOOK_ID,
      name: 'MAT102 Induction I',
      courseId: COURSE_ID,
      courseName: 'MAT102',
    },
  }),
});

assert.equal(generation?.success, true);
assert.equal(generation?.result?.usage?.modelId, 'gpt-image-2');
assert.equal(generation?.result?.width, WIDTH);
assert.equal(generation?.result?.height, HEIGHT);

let imageDataUrl = generation?.result?.base64 || '';
if (imageDataUrl && !imageDataUrl.startsWith('data:image/')) {
  imageDataUrl = `data:image/png;base64,${imageDataUrl}`;
}
if (!imageDataUrl && generation?.result?.url) {
  const imageResponse = await fetch(generation.result.url, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!imageResponse.ok) {
    throw new Error(`Generated image download failed (${imageResponse.status}).`);
  }
  const mime = imageResponse.headers.get('content-type') || 'image/png';
  imageDataUrl = `data:${mime};base64,${Buffer.from(await imageResponse.arrayBuffer()).toString(
    'base64',
  )}`;
}
if (!imageDataUrl) {
  throw new Error('Image API returned no inline image or downloadable URL.');
}

const persisted = await api(
  `/api/courses/${encodeURIComponent(COURSE_ID)}/source-uploads/${encodeURIComponent(SOURCE_HASH)}`,
  {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      notebookId: NOTEBOOK_ID,
      imageDataUrl,
      providerId: 'openai-image',
      model: 'gpt-image-2',
      prompt,
      coverSpec,
    }),
  },
);

assert.equal(persisted?.ok, true);
assert.equal(persisted?.cover?.model, 'gpt-image-2');
assert.equal(persisted?.image?.width, WIDTH);
assert.equal(persisted?.image?.height, HEIGHT);
assert.equal(persisted?.memoryFactUpdated, true);

const after = await loadPilotState();
assert.ok(after.source, 'MAT102 pilot source must remain visible through the source API.');
assert.equal(after.source.coverImagePath, persisted.image.path);
assert.equal(after.source.coverStatus, 'generated');
assert.deepEqual(after.sourceHashes, before.sourceHashes);
assert.deepEqual(after.sourceNotebookIds, before.sourceNotebookIds);
assert.deepEqual(
  after.sourceFactIds,
  before.sourceFactIds,
  'Cover regeneration must update the existing MemoryFact without replacing its ID.',
);
assert.equal(after.notebook?.notebook?.coverImagePath, persisted.image.path);
assert.deepEqual(
  after.problemIds,
  before.problemIds,
  'Cover regeneration must not add, remove, or replace any course problem.',
);
assert.equal(after.problemIds.length, EXPECTED_PROBLEM_COUNT);

const publishedCover = await fetch(`${baseUrl}${persisted.image.path}`, {
  headers: commonHeaders,
  signal: AbortSignal.timeout(120_000),
});
if (!publishedCover.ok) {
  throw new Error(`Published cover fetch failed (${publishedCover.status}).`);
}
const publishedBytes = Buffer.from(await publishedCover.arrayBuffer());
const metadata = await sharp(publishedBytes).metadata();
assert.equal(metadata.width, WIDTH);
assert.equal(metadata.height, HEIGHT);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode: 'api_only_existing_pilot_cover_regeneration',
      courseId: COURSE_ID,
      notebookId: NOTEBOOK_ID,
      sourceHash: SOURCE_HASH,
      cover: persisted.cover,
      coverSpec,
      image: {
        ...persisted.image,
        fetchedBytes: publishedBytes.length,
      },
      model: generation.result.usage.modelId,
      costEstimate: generation.costEstimate || null,
      sourceCount: after.sources.uploads.length,
      notebookCount: after.source.notebookIds.length,
      problemCount: after.problemIds.length,
      problemIdsUnchanged: true,
      contentState: after.contentState,
    },
    null,
    2,
  )}\n`,
);
