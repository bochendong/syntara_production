/**
 * Generate the bundled MAT136 native mini-classroom assets with the same
 * image-first contract as OpenMAIC:
 *
 *   gpt-image-2 source-marker image
 *     -> marker recovery
 *     -> clean student image + semantic bboxes
 *     -> spotlight/speech action sequence
 *     -> OpenAI gpt-4o-mini-tts MP3 assets
 *
 * Prerequisites:
 *   1. Start the Next dev server on localhost:3000.
 *   2. Run with .env.local loaded:
 *      pnpm exec dotenv -e .env.local -- node \
 *        scripts/notebooks/generate-native-mat136-mini-lectures.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { ProxyAgent, fetch as proxyAwareFetch } from 'undici';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Only immutable runtime assets belong under Vite's public directory. Source-marker
// images and generation diagnostics stay outside public so they are not copied into
// the desktop application's frontend bundle.
const RUNTIME_ROOT = path.join(ROOT, 'apps/native/public/mock-mini-lectures/mat136');
const ARTIFACTS_ROOT = path.join(
  ROOT,
  'apps/native/artifacts/mock-mini-lectures/mat136',
);
const MANIFEST_PATH = path.join(
  ROOT,
  'apps/native/src/data/generated-mat136-mini-lectures.json',
);
const API_ROOT = (process.env.SYNTARA_GENERATION_API_ROOT || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const IMAGE_MODEL = 'gpt-image-2';
const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.MAT136_MINI_LECTURE_TTS_VOICE || 'marin';
const CANVAS = { width: 1000, height: 562.5 };
const MAX_IMAGE_ATTEMPTS = 3;

const MARKER_COLORS = ['#ff0000', '#00ff00', '#0048ff', '#00ffff'];
const DISPLAY_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa'];

const lectures = [
  {
    messageId: 'message-mat136-assistant-local',
    slug: 'riemann-limit',
    title: '为什么定积分一定要取极限？',
    objective: '从有限黎曼和的非唯一近似，走到网格宽度趋近于零时的唯一定积分。',
    pageRole: 'definition',
    components: [
      {
        id: 'finite-riemann-sums',
        label: '有限黎曼和：仍然只是近似',
        role: 'opening',
        layoutSlot: 'middle-left',
        visibleText: ['有限个矩形仍有宽度', '曲线与矩形顶部之间仍有误差', '左、右、中点取样会给出不同结果'],
        formulas: ['S(P, ξ) = Σ f(ξᵢ) Δxᵢ'],
        diagramPrompt:
          '画一条平滑递增曲线和三组较宽的近似矩形，用灰色细线表示曲线与矩形顶部的缝隙；不要使用保留的 marker 纯色。',
        speeches: [
          {
            title: '先问：为什么矩形还不够',
            text: '你可以先问一个很实际的问题：我已经把曲线下面切成矩形并把面积加起来了，为什么还不能直接把这个和叫作面积？',
          },
          {
            title: '有限分割留下两类不确定性',
            text: '只画有限个矩形时，每个矩形仍然有宽度，顶部通常贴不住曲线；而且左端点、右端点或中点取样，还会给出不同的近似值。',
          },
        ],
      },
      {
        id: 'mesh-goes-to-zero',
        label: '真正缩小的是网格宽度',
        role: 'strategy',
        layoutSlot: 'middle-right',
        visibleText: ['分割不断细化', '最大子区间宽度 ‖P‖ → 0', '不同取样的误差被同时压小'],
        formulas: ['‖P‖ = max Δxᵢ', '‖P‖ → 0'],
        diagramPrompt:
          '画从粗矩形到细矩形的三步变化，最右侧矩形明显更窄，并用普通黑色箭头表示细化方向。',
        speeches: [
          {
            title: '矩形变多不是完整条件',
            text: '接着要抓住真正被控制的量。只说矩形数量增加还不够，因为某一段仍可能很宽；我们要让最宽的那一小段也越来越窄。',
          },
          {
            title: '网格宽度趋近于零',
            text: '这个最大小区间宽度叫作网格宽度。当它趋近于零时，所有矩形都被迫变窄，不同分割和不同取样造成的误差才会一起被压下去。',
          },
        ],
      },
      {
        id: 'integral-as-common-limit',
        label: '共同极限才是定积分',
        role: 'takeaway',
        layoutSlot: 'bottom-full',
        visibleText: ['所有合法黎曼和趋向同一个数 A', 'A 与分割方式和取样点无关', '这个共同极限定义为定积分'],
        formulas: ['lim ‖P‖→0 S(P, ξ) = A', '∫ₐᵇ f(x) dx = A'],
        diagramPrompt:
          '用多条细灰路径汇聚到一个清晰的黑色圆点 A，旁边写出定积分记号和“唯一、稳定”两个简体中文词。',
        speeches: [
          {
            title: '极限消除取样依赖',
            text: '如果网格宽度趋近于零以后，无论怎样合法分割、怎样在每段里选取样点，所有黎曼和都靠近同一个数，那么近似就不再依赖选择。',
          },
          {
            title: '定积分是稳定下来的共同值',
            text: '所以定积分不是某一批矩形的面积，而是所有这些近似在细化过程中共同稳定下来的极限。取极限，正是为了得到唯一而可定义的数。',
          },
        ],
      },
    ],
  },
  {
    messageId: 'message-mat136-water-leak-problem-assistant-local',
    slug: 'left-endpoint-water-leak',
    title: '左端点为什么不取到 3？',
    objective: '用六个小区间的几何位置解释左端点集合，并完成漏水量的黎曼和表达式。',
    pageRole: 'example',
    components: [
      {
        id: 'six-subintervals',
        label: '六段区间与六个左端点',
        role: 'setup',
        layoutSlot: 'top-full',
        visibleText: ['[0, 3] 等分成 6 段', 'Δt = 0.5 小时', '左端点：0, 0.5, 1, 1.5, 2, 2.5'],
        formulas: ['Δt = (3 − 0) / 6 = 0.5'],
        diagramPrompt:
          '画一条从 0 到 3 的水平数轴，分成六段；用普通黑色实心点标出六个左端点，并把 3 画成空心终点。',
        speeches: [
          {
            title: '先切区间，再选高度',
            text: '先别急着代函数。时间从零到三小时，一共分成六段，所以每一段的宽度是零点五小时；六个矩形必须一段对应一个高度。',
          },
          {
            title: '左端点就是每段的起点',
            text: '左端点规则只取每一小段开始的位置，因此依次是零、零点五、一、一点五、二和二点五，正好六个点。',
          },
        ],
      },
      {
        id: 'why-three-is-excluded',
        label: '3 是右端点，不是第七个左端点',
        role: 'pitfall',
        layoutSlot: 'middle-left',
        visibleText: ['最后一段是 [2.5, 3]', '2.5 是左端点', '3 是右端点', '加入 3 会得到 7 个高度'],
        formulas: [],
        diagramPrompt:
          '放大最后一个小区间，从 2.5 指向 3；在 2.5 下写“左端点”，在 3 下写“右端点”，用黑灰对比，不用彩色框。',
        speeches: [
          {
            title: '看清最后一段的左右关系',
            text: '关键只在最后一段。最后一个小区间从二点五开始，到三结束；因此二点五是它的左端点，而三是它的右端点。',
          },
          {
            title: '加入 3 会破坏一段一个高度',
            text: '如果再把三加入取样点，就会出现七个高度，却只有六个小区间。三只有在右端点规则里才会被选中，不属于这次左端点和。',
          },
        ],
      },
      {
        id: 'rate-to-volume',
        label: '速率乘宽度才得到漏水量',
        role: 'formula',
        layoutSlot: 'middle-right',
        visibleText: ['f(t) = sin(2t) + 1 升每小时', '把六个左端点代入', '最后乘 Δt = 0.5 小时', '结果单位：升'],
        formulas: ['L₆ = 0.5 [f(0)+f(0.5)+f(1)+f(1.5)+f(2)+f(2.5)]'],
        diagramPrompt:
          '画六个窄矩形及一条平滑速率曲线，旁边写“高度：速率”“宽度：0.5 小时”“面积：漏水量”。',
        speeches: [
          {
            title: '写出六段左端点和',
            text: '现在把这六个左端点代入漏水速率函数，把六个函数值相加；这些函数值只是每个矩形的高度，也就是每小时漏多少升。',
          },
          {
            title: '别漏掉零点五和单位',
            text: '最后一定要乘每段的时间宽度零点五小时。升每小时乘小时，才得到每段的漏水量；全部相加后的单位也才是升。',
          },
        ],
      },
    ],
  },
  {
    messageId: 'message-mat136-substitution-assistant-local',
    slug: 'substitution-differential',
    title: '换元时为什么必须一起换 dx？',
    objective: '把换元理解为积分变量和微小宽度的共同转换，并在典型例题里完成整体替换。',
    pageRole: 'strategy',
    components: [
      {
        id: 'dx-carries-width',
        label: 'dx 指明变量，也代表微小宽度',
        role: 'opening',
        layoutSlot: 'middle-left',
        visibleText: ['dx 不是装饰', '积分是对 x 的微小宽度累加', '换变量时宽度也必须转换'],
        formulas: ['∫ f(x) dx'],
        diagramPrompt:
          '画 x 轴上一个很窄的小条标为 dx，旁边画 u 轴上的对应小条标为 du，用黑色弯箭头连接两者。',
        speeches: [
          {
            title: 'dx 不是公式末尾的标点',
            text: '很多人把微分看成积分号后面的装饰，但它其实告诉你现在沿哪个变量累加，也代表每一小片在这个变量上的微小宽度。',
          },
          {
            title: '换元必须连宽度一起换',
            text: '当你把横轴从 x 换成 u，原来用 x 衡量的微小宽度也必须改写成 u 的宽度；否则函数换了变量，累加尺度却还留在旧变量里。',
          },
        ],
      },
      {
        id: 'chain-rule-bridge',
        label: 'du = g′(x) dx 是换元桥梁',
        role: 'formula',
        layoutSlot: 'middle-right',
        visibleText: ['设 u = g(x)', '由链式法则得到 du = g′(x) dx', '用这个关系替换原积分中的整块因子'],
        formulas: ['u = g(x)', 'du = g′(x) dx'],
        diagramPrompt:
          '画从 u 等于 g(x) 到 du 等于 g 撇 x 乘 dx 的两步推导，用普通黑色箭头和简洁手写注释“链式法则”。',
        speeches: [
          {
            title: '链式法则给出两个微分的关系',
            text: '设 u 等于 g 作用在 x 上。对两边求微分，链式法则告诉我们，u 的微分等于 g 的导数乘 x 的微分。',
          },
          {
            title: '把它当作可替换的整体',
            text: '这个关系不是为了多写一行，而是告诉你原积分中哪一整块可以换成 du。换元时要同时替换内层函数和与它匹配的导数因子。',
          },
        ],
      },
      {
        id: 'worked-substitution',
        label: '例题：把 2x dx 整体替换成 du',
        role: 'example',
        layoutSlot: 'bottom-full',
        visibleText: ['令 u = x²', '则 du = 2x dx', '原积分变为 ∫ cos(u) du', '换元后只剩 u 与 du'],
        formulas: ['∫ 2x cos(x²) dx', 'u = x²,  du = 2x dx', '∫ cos(u) du'],
        diagramPrompt:
          '画一个三步演算流程：原积分、圈出 x 平方与二 x dx 两块、换成只含 u 和 du 的积分。公式必须清晰正确。',
        speeches: [
          {
            title: '先认出内层函数与配套导数',
            text: '看这个典型积分，余弦里面是 x 的平方，外面刚好有二 x 乘 dx。于是令 u 等于 x 的平方，微分关系正好是 du 等于二 x 乘 dx。',
          },
          {
            title: '换元完成的检查标准',
            text: '接着把 x 的平方换成 u，把二 x 乘 dx 整体换成 du，积分就只剩余弦 u 对 u 的积分。若还混着 x 或 dx，就说明换元还没有完成。',
          },
        ],
      },
    ],
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFilePart(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function dataUrlBase64(value) {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(value || '');
  return match ? match[1] : value || '';
}

function pageOutline(lecture) {
  const outlineId = `native-mat136-${lecture.slug}-page-1`;
  return {
    id: outlineId,
    type: 'slide',
    archetype: lecture.pageRole === 'example' ? 'example' : 'concept',
    title: lecture.title,
    description: lecture.objective,
    keyPoints: lecture.components.map((component) => component.label),
    teachingObjective: lecture.objective,
    studentThinkingMove: lecture.objective,
    estimatedDuration: lecture.components.length * 55,
    order: 1,
    language: 'zh-CN',
    imageNotebookBrief: {
      outlineId,
      pageNumber: 1,
      pageRole: lecture.pageRole,
      title: lecture.title,
      pageMove: {
        currentJob: lecture.objective,
        toNext: '把这一页的判断迁移回原问题，并能独立复述原因。',
      },
      visualBrief:
        '一张完整的 MAT136 手绘微积分课堂笔记图。白色方格纸铺满画布，黑色与石墨灰手写内容，少量暖灰阴影；公式清楚、结构有教学节奏，绝不画成网页组件或卡片 UI。',
      visibleContent: {
        mustShow: lecture.components.flatMap((component) => component.visibleText).slice(0, 12),
        formulas: lecture.components.flatMap((component) => component.formulas).slice(0, 8),
        exampleSteps: [],
        commonPitfalls: [],
        bottomTakeaway: lecture.components.at(-1)?.visibleText.at(-1) || lecture.objective,
      },
      focusRegions: [],
      componentPlans: lecture.components.map((component, index) => ({
        id: `${outlineId}-${component.id}`,
        label: component.label,
        role: component.role,
        order: index + 1,
        layoutSlot: component.layoutSlot,
        markerColorName: ['red', 'lime', 'blue', 'cyan'][index],
        markerColorHex: MARKER_COLORS[index],
        visibleText: component.visibleText,
        formulas: component.formulas,
        diagramPrompt: component.diagramPrompt,
        participatesInMask: true,
      })),
      generationNotes: [
        '学生可见文字必须使用简体中文。',
        '公式必须保持标准数学记号与题意一致。',
        '所有讲解内容必须落在对应四角 marker 围出的语义区域内。',
      ],
      qaChecklist: [
        '每个语义区域恰好四个独立纯色方形 marker。',
        '普通内容不得使用 marker 保留色。',
        '区域不重叠，公式与简体中文清晰可读。',
      ],
    },
  };
}

function generationBody(lecture) {
  const outline = pageOutline(lecture);
  return {
    outline,
    allOutlines: [outline],
    stageInfo: {
      id: `native-mat136-${lecture.slug}`,
      name: `MAT136 · ${lecture.title}`,
      description: lecture.objective,
      language: 'zh-CN',
      style:
        '白色方格纸、自然手绘微积分课堂笔记、黑色和石墨灰墨迹、克制的暖灰装饰、清楚的公式层级；不要网页 UI、不要演示文稿模板。',
      imageNotebookStyle: {
        schemaVersion: 1,
        preset: 'hand-drawn-course-notebook',
        canvas: '16:9',
        background: '全幅白色方格纸，淡灰网格触及四边',
        writingStyle: '自然但清楚的简体中文课堂手写体与标准数学公式',
        colorMood: '黑色、石墨灰、浅暖灰；普通内容禁用 marker 纯色',
        density: 'medium',
        decorationLevel: 'light',
        palette: {
          label: 'graphite notebook',
          colors: ['#111111', '#4b4b4b', '#d6d3d1', '#f5f5f4'],
        },
        userStylePrompt: '像大学微积分老师边讲边画的一页精致课堂笔记，而不是前端组件。',
        avoidPureMarkerColors: [...MARKER_COLORS, '#ff00ff', '#ffff00'],
        ordinaryContentColorRule: '普通内容只用黑、灰和暖灰；纯色仅供四角 marker。',
      },
    },
    slideGenerationRoute: 'image-ppt',
    imageNotebookMaxAttempts: 1,
    includeActions: false,
  };
}

async function postPageGeneration(lecture) {
  const response = await fetch(`${API_ROOT}/api/generate/notebook-page-content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-generation-test-no-charge': 'true',
    },
    body: JSON.stringify(generationBody(lecture)),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`页面生成接口返回非 JSON（HTTP ${response.status}）：${text.slice(0, 600)}`);
  }
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `页面生成失败（HTTP ${response.status}）`);
  }
  return payload;
}

function generatedArtifacts(payload) {
  const outline = payload?.contentBundle?.effectiveOutlines?.[0];
  const promptPlan = outline?.imageNotebookPromptPlan;
  const recovery = promptPlan?.recoveryResult;
  const cleanBase64 = dataUrlBase64(payload?.image?.imageResult?.base64);
  const sourceMarkerBase64 = dataUrlBase64(recovery?.originalMarkerImageUrl);
  const components = Array.isArray(recovery?.components) ? recovery.components : [];
  const focusRegions = Array.isArray(outline?.imageNotebookBrief?.focusRegions)
    ? outline.imageNotebookBrief.focusRegions
    : [];
  return {
    outline,
    promptPlan,
    recovery,
    cleanBase64,
    sourceMarkerBase64,
    components,
    focusRegions,
    imagePrompt: payload?.image?.imagePrompt || '',
    imageWidth: Number(payload?.image?.imageResult?.width) || 1792,
    imageHeight: Number(payload?.image?.imageResult?.height) || 1008,
  };
}

function isStrictRecoveryPass(artifacts, expectedCount) {
  if (artifacts.recovery?.status !== 'passed') return false;
  if (!artifacts.cleanBase64 || !artifacts.sourceMarkerBase64) return false;
  if (artifacts.components.length !== expectedCount) return false;
  if (artifacts.focusRegions.length !== expectedCount) return false;
  return artifacts.components.every(
    (component) =>
      component?.markerCount === 4 &&
      Array.isArray(component?.bbox) &&
      component.bbox.length === 4,
  );
}

async function renderMaskPreview(cleanPath, outputPath, bbox, sourceWidth, sourceHeight) {
  const [left, top, width, height] = bbox;
  const x = (left / CANVAS.width) * sourceWidth;
  const y = (top / CANVAS.height) * sourceHeight;
  const w = (width / CANVAS.width) * sourceWidth;
  const h = (height / CANVAS.height) * sourceHeight;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}">
    <path d="M0 0H${sourceWidth}V${sourceHeight}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z"
      fill="rgba(2,6,23,0.70)" fill-rule="evenodd"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"
      fill="none" stroke="white" stroke-width="5"/>
  </svg>`;
  await sharp(cleanPath).composite([{ input: Buffer.from(overlay) }]).png().toFile(outputPath);
}

let cachedOpenAiDispatcher;

function openAiDispatcher() {
  if (cachedOpenAiDispatcher !== undefined) return cachedOpenAiDispatcher;
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  cachedOpenAiDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  return cachedOpenAiDispatcher || undefined;
}

async function generateSpeechMp3(text) {
  const apiKey = process.env.TTS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.TTS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  if (!apiKey) throw new Error('缺少 TTS_OPENAI_API_KEY 或 OPENAI_API_KEY');
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await proxyAwareFetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: TTS_VOICE,
          input: text,
          speed: 1,
          response_format: 'mp3',
        }),
        dispatcher: openAiDispatcher(),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      const errorText = await response.text();
      const error = new Error(`OpenAI TTS 失败（HTTP ${response.status}）：${errorText}`);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('OpenAI TTS 生成失败');
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function bboxForRegion(region) {
  return [region.left, region.top, region.width, region.height];
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function cachedRecoveryFile(attemptsDir) {
  if (!fs.existsSync(attemptsDir)) return null;
  return fs
    .readdirSync(attemptsDir)
    .filter((name) => /^recovery-attempt-\d+\.json$/.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/\d+/)?.[0] || 0);
      const rightNumber = Number(right.match(/\d+/)?.[0] || 0);
      return rightNumber - leftNumber;
    })
    .map((name) => path.join(attemptsDir, name))
    .find((filePath) => {
      try {
        const recovery = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return recovery?.status === 'passed';
      } catch {
        return false;
      }
    });
}

async function loadCachedPageArtifacts(lecture, runtimeDir, artifactsDir, attemptsDir) {
  const cleanPath = path.join(runtimeDir, 'page-01.png');
  const sourceMarkerPath = path.join(artifactsDir, 'source-marker-01.png');
  const recoveryPath = cachedRecoveryFile(attemptsDir);
  if (!fs.existsSync(cleanPath) || !fs.existsSync(sourceMarkerPath) || !recoveryPath) return null;

  const recovery = JSON.parse(fs.readFileSync(recoveryPath, 'utf8'));
  const components = Array.isArray(recovery.components) ? recovery.components : [];
  const complete =
    components.length === lecture.components.length &&
    components.every(
      (component) =>
        component?.markerCount === 4 &&
        Array.isArray(component?.bbox) &&
        component.bbox.length === 4,
    );
  if (!complete) return null;

  const imageMetadata = await sharp(cleanPath).metadata();
  const generatedRegions = components.map((component, index) => {
    const [left, top, right, bottom] = component.bbox;
    const lectureComponent = lecture.components[index];
    return {
      id: component.componentId,
      semanticId: lectureComponent?.id || component.componentId,
      label: lectureComponent?.label || component.componentId,
      order: index + 1,
      role: lectureComponent?.role || 'setup',
      color: DISPLAY_COLORS[index] || DISPLAY_COLORS[0],
      bbox: [left, top, round1(right - left), round1(bottom - top)],
    };
  });
  const promptPath = path.join(artifactsDir, 'image-prompt.txt');
  return {
    generatedRegions,
    artifacts: {
      recovery,
      components,
      imageWidth: imageMetadata.width || 1792,
      imageHeight: imageMetadata.height || 1008,
      imagePrompt: fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '',
    },
  };
}

async function generateLecture(lecture) {
  const runtimeDir = path.join(RUNTIME_ROOT, lecture.slug);
  const artifactsDir = path.join(ARTIFACTS_ROOT, lecture.slug);
  const attemptsDir = path.join(artifactsDir, 'attempts');
  const maskDir = path.join(artifactsDir, 'mask-previews');
  ensureDir(runtimeDir);
  ensureDir(artifactsDir);
  ensureDir(attemptsDir);
  ensureDir(maskDir);

  const deckPath = path.join(artifactsDir, 'deck.json');
  const validationPath = path.join(artifactsDir, 'validation-report.json');
  if (fs.existsSync(deckPath) && fs.existsSync(validationPath)) {
    try {
      const existingDeck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
      const existingValidation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
      if (
        existingDeck?.status === 'ready' &&
        existingDeck?.generatedBy?.imageModel === IMAGE_MODEL &&
        existingDeck?.generatedBy?.ttsModel === TTS_MODEL &&
        existingValidation?.status === 'passed' &&
        existingValidation?.assertions?.everySpeechHasMp3 === true
      ) {
        const cleanImagePath = path.join(runtimeDir, 'page-01.png');
        if (!fs.existsSync(cleanImagePath)) {
          throw new Error(`[${lecture.slug}] validated deck is missing page-01.png`);
        }
        const cleanImage = fs.readFileSync(cleanImagePath);
        existingDeck.pages = (existingDeck.pages || []).map((page) => ({
          ...page,
          imageSha256: crypto.createHash('sha256').update(cleanImage).digest('hex'),
          imageBytes: cleanImage.length,
        }));
        fs.writeFileSync(deckPath, `${JSON.stringify(existingDeck, null, 2)}\n`);
        console.log(`[${lecture.slug}] reusing complete validated deck`);
        return existingDeck;
      }
    } catch {
      // Regenerate an incomplete or unreadable deck.
    }
  }

  const cleanPath = path.join(runtimeDir, 'page-01.png');
  const sourceMarkerPath = path.join(artifactsDir, 'source-marker-01.png');
  const cached = await loadCachedPageArtifacts(
    lecture,
    runtimeDir,
    artifactsDir,
    attemptsDir,
  );
  let artifacts = cached?.artifacts;
  let generatedRegions = cached?.generatedRegions;

  if (cached) {
    console.log(`[${lecture.slug}] reusing passed gpt-image-2 marker recovery`);
  } else {
    let payload;
    for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt += 1) {
      console.log(`[${lecture.slug}] gpt-image-2 generation attempt ${attempt}`);
      payload = await postPageGeneration(lecture);
      artifacts = generatedArtifacts(payload);

      if (artifacts.sourceMarkerBase64) {
        fs.writeFileSync(
          path.join(attemptsDir, `source-marker-attempt-${attempt}.png`),
          Buffer.from(artifacts.sourceMarkerBase64, 'base64'),
        );
      }
      fs.writeFileSync(
        path.join(attemptsDir, `recovery-attempt-${attempt}.json`),
        `${JSON.stringify(
          {
            status: artifacts.recovery?.status || 'missing',
            findings: artifacts.recovery?.findings || [],
            components: artifacts.components,
          },
          null,
          2,
        )}\n`,
      );

      if (isStrictRecoveryPass(artifacts, lecture.components.length)) break;
      console.warn(
        `[${lecture.slug}] marker recovery ${artifacts.recovery?.status || 'missing'}; retrying`,
      );
    }

    if (!artifacts || !payload || !isStrictRecoveryPass(artifacts, lecture.components.length)) {
      throw new Error(
        `[${lecture.slug}] marker recovery did not pass after ${MAX_IMAGE_ATTEMPTS} attempts`,
      );
    }

    fs.writeFileSync(cleanPath, Buffer.from(artifacts.cleanBase64, 'base64'));
    fs.writeFileSync(sourceMarkerPath, Buffer.from(artifacts.sourceMarkerBase64, 'base64'));
    generatedRegions = artifacts.focusRegions
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((region, index) => ({
        id: region.id,
        semanticId: lecture.components[index]?.id || region.id,
        label: lecture.components[index]?.label || region.label,
        order: index + 1,
        role: region.role,
        color: DISPLAY_COLORS[index] || DISPLAY_COLORS[0],
        bbox: bboxForRegion(region),
      }));
  }

  if (!artifacts || !generatedRegions) {
    throw new Error(`[${lecture.slug}] missing recovered page artifacts`);
  }

  await Promise.all(
    generatedRegions.map((region, index) =>
      renderMaskPreview(
        cleanPath,
        path.join(maskDir, `focus-${String(index + 1).padStart(2, '0')}.png`),
        region.bbox,
        artifacts.imageWidth,
        artifacts.imageHeight,
      ),
    ),
  );

  const speechJobs = lecture.components.flatMap((component, regionIndex) =>
    component.speeches.map((speech, speechIndex) => ({
      component,
      region: generatedRegions[regionIndex],
      regionIndex,
      speech,
      speechIndex,
    })),
  );
  const speechAssets = await mapWithConcurrency(speechJobs, 1, async (job, index) => {
    const fileName = `speech-${String(index + 1).padStart(2, '0')}.mp3`;
    console.log(
      `[${lecture.slug}] OpenAI TTS ${index + 1}/${speechJobs.length}: ${job.speech.title}`,
    );
    const audio = await generateSpeechMp3(job.speech.text);
    fs.writeFileSync(path.join(runtimeDir, fileName), audio);
    return {
      ...job,
      fileName,
      sha256: crypto.createHash('sha256').update(audio).digest('hex'),
      bytes: audio.length,
    };
  });

  const actions = [];
  for (const [regionIndex, region] of generatedRegions.entries()) {
    actions.push({
      id: `${lecture.slug}-spotlight-${regionIndex + 1}`,
      type: 'spotlight',
      regionId: region.id,
      title: region.label,
      dimOpacity: 0.76,
    });
    for (const asset of speechAssets.filter((item) => item.regionIndex === regionIndex)) {
      actions.push({
        id: `${lecture.slug}-speech-${regionIndex + 1}-${asset.speechIndex + 1}`,
        type: 'speech',
        regionId: region.id,
        title: asset.speech.title,
        text: asset.speech.text,
        audioUrl: `/mock-mini-lectures/mat136/${lecture.slug}/${asset.fileName}`,
        audioProvider: 'openai-tts',
        audioModel: TTS_MODEL,
        audioVoice: TTS_VOICE,
        audioSha256: asset.sha256,
        audioBytes: asset.bytes,
      });
    }
  }

  const validation = {
    status: 'passed',
    generatedAt: new Date().toISOString(),
    imageProvider: 'openai-image',
    imageModel: IMAGE_MODEL,
    ttsProvider: 'openai-tts',
    ttsModel: TTS_MODEL,
    ttsVoice: TTS_VOICE,
    markerRecovery: {
      status: artifacts.recovery.status,
      findings: artifacts.recovery.findings || [],
      components: artifacts.components,
    },
    assertions: {
      sourceMarkerImagePresent: fs.existsSync(sourceMarkerPath),
      cleanImagePresent: fs.existsSync(cleanPath),
      recoveredRegionCount: generatedRegions.length,
      expectedRegionCount: lecture.components.length,
      everyRegionHasFourMarkers: artifacts.components.every(
        (component) => component.markerCount === 4,
      ),
      speechAssetCount: speechAssets.length,
      everySpeechHasMp3: speechAssets.every((asset) =>
        fs.existsSync(path.join(runtimeDir, asset.fileName)),
      ),
    },
  };
  fs.writeFileSync(
    path.join(artifactsDir, 'validation-report.json'),
    `${JSON.stringify(validation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'image-prompt.txt'),
    `${artifacts.imagePrompt.trim()}\n`,
  );

  const cleanImage = fs.readFileSync(cleanPath);
  const page = {
    id: `${lecture.slug}-page-1`,
    title: lecture.title,
    imageUrl: `/mock-mini-lectures/mat136/${lecture.slug}/page-01.png`,
    imageSha256: crypto.createHash('sha256').update(cleanImage).digest('hex'),
    imageBytes: cleanImage.length,
    width: CANVAS.width,
    height: CANVAS.height,
    recoveryStatus: 'passed',
    regions: generatedRegions,
    actions,
  };
  const deck = {
    id: `mock-lecture-${lecture.slug}`,
    sourceMessageId: lecture.messageId,
    title: lecture.title,
    status: 'ready',
    generatedBy: {
      imageProvider: 'openai-image',
      imageModel: IMAGE_MODEL,
      ttsProvider: 'openai-tts',
      ttsModel: TTS_MODEL,
      ttsVoice: TTS_VOICE,
    },
    pages: [page],
  };
  fs.writeFileSync(deckPath, `${JSON.stringify(deck, null, 2)}\n`);
  return deck;
}

async function main() {
  const health = await fetch(`${API_ROOT}/api/generate/notebook-page-content`, {
    method: 'OPTIONS',
  }).catch(() => null);
  if (!health) {
    throw new Error(`无法连接 ${API_ROOT}。请先启动 Next 开发服务器。`);
  }

  ensureDir(RUNTIME_ROOT);
  ensureDir(ARTIFACTS_ROOT);
  const decks = {};
  for (const lecture of lectures) {
    decks[lecture.messageId] = await generateLecture(lecture);
  }
  const generator = {
    imageProvider: 'openai-image',
    imageModel: IMAGE_MODEL,
    ttsProvider: 'openai-tts',
    ttsModel: TTS_MODEL,
    ttsVoice: TTS_VOICE,
  };
  const contentVersion = crypto
    .createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, generator, decks }))
    .digest('hex');
  const manifest = {
    schemaVersion: 1,
    contentVersion,
    generatedAt: new Date().toISOString(),
    generator,
    decks,
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${Object.keys(decks).length} MAT136 mini lectures.`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
