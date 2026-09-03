export type MiniLecturePrompt = {
  id: string;
  title: string;
  question: string;
  answer: string;
  courseName: string;
  createdAt: number;
};

export type MiniLectureRegion = {
  id: string;
  label: string;
  script: string;
  markerColorHex: string;
  bbox: [number, number, number, number];
  markerPoints: Array<{
    x: number;
    y: number;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  }>;
};

export type MiniLectureAction =
  | {
      id: string;
      type: 'spotlight';
      elementId: string;
      title: string;
      dimOpacity: number;
    }
  | {
      id: string;
      type: 'speech';
      title: string;
      text: string;
      /** Region narrated by this segment; generated decks use it to keep the image mask in sync. */
      elementId?: string;
      /** Generated OpenAI MP3. Legacy decks may omit this field. */
      audioDataUrl?: string;
    };

export type MiniLecturePage = {
  id: string;
  title: string;
  imageDataUrl: string;
  regions: MiniLectureRegion[];
  actions: MiniLectureAction[];
};

export type MiniLectureDeck = {
  id: string;
  /** IndexedDB key for generated image/audio assets; safe metadata is synced remotely. */
  localAssetId?: string;
  title: string;
  sourceQuestion: string;
  sourceAnswer: string;
  pages: MiniLecturePage[];
  markerProtocol: {
    type: 'corner-square-markers';
    markerSizePx: number;
    markerCountPerComponent: 4;
    recoveredFrom: 'client-mini-lecture' | 'openai-image2-marker-recovery';
  };
  generator?: {
    image: { provider: string; model: string };
    actions: { provider: string; model: string };
    tts: { provider: string; model: string; voice: string };
  };
  createdAt: number;
};

export type GeneratedMiniLectureManifest = {
  lectureId: string;
  title: string;
  createdAt: string;
  source: {
    messageId?: string;
    answerId?: string;
  };
  generator: NonNullable<MiniLectureDeck['generator']>;
  pages: Array<{
    id: string;
    title: string;
    width: number;
    height: number;
    image: {
      mimeType: string;
      base64: string;
    };
    regions: Array<{
      id: string;
      label: string;
      color: string;
      /** Generated manifests use [left, top, width, height]. */
      bbox: [number, number, number, number];
    }>;
    actions: Array<
      | {
          id: string;
          type: 'spotlight';
          regionId: string;
          title: string;
          dimOpacity: number;
        }
      | {
          id: string;
          type: 'speech';
          regionId: string;
          title: string;
          text: string;
          audio: {
            mimeType: string;
            base64: string;
          };
        }
    >;
  }>;
};

export const MINI_LECTURE_CANVAS_WIDTH = 1000;
export const MINI_LECTURE_CANVAS_HEIGHT = 562.5;
const CANVAS_WIDTH = MINI_LECTURE_CANVAS_WIDTH;
const CANVAS_HEIGHT = MINI_LECTURE_CANVAS_HEIGHT;
const MARKER_SIZE = 14;
const MARKER_COLORS = ['#ef4444', '#0ea5e9', '#10b981', '#f59e0b'] as const;

function makeClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactLectureText(value: string, maxChars: number): string {
  const text = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[#>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapLectureLine(text: string, maxChars: number, maxLines: number): string[] {
  const normalized = compactLectureText(text, maxChars * maxLines * 2);
  const lines: string[] = [];
  let current = '';
  for (const char of normalized) {
    current += char;
    if (current.length >= maxChars) {
      lines.push(current.trim());
      current = '';
      if (lines.length >= maxLines) break;
    }
  }
  if (current.trim() && lines.length < maxLines) lines.push(current.trim());
  return lines.length ? lines : ['这一步先抓住核心关系。'];
}

function lectureSentences(text: string): string[] {
  return compactLectureText(text, 1600)
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((item) => item.replace(/^\d+[.、)]\s*/, '').trim())
    .filter((item) => item.length >= 8)
    .slice(0, 8);
}

function markerPoints(bbox: MiniLectureRegion['bbox']): MiniLectureRegion['markerPoints'] {
  const [x0, y0, x1, y1] = bbox;
  const half = MARKER_SIZE / 2;
  return [
    { x: x0 + half, y: y0 + half, corner: 'top-left' },
    { x: x1 - half, y: y0 + half, corner: 'top-right' },
    { x: x0 + half, y: y1 - half, corner: 'bottom-left' },
    { x: x1 - half, y: y1 - half, corner: 'bottom-right' },
  ];
}

function region(args: {
  pageIndex: number;
  index: number;
  label: string;
  script: string;
  bbox: MiniLectureRegion['bbox'];
}): MiniLectureRegion {
  const color = MARKER_COLORS[args.index % MARKER_COLORS.length] || MARKER_COLORS[0];
  return {
    id: `mini-lecture-p${args.pageIndex + 1}-focus-${args.index + 1}`,
    label: compactLectureText(args.label, 36),
    script: compactLectureText(args.script, 240),
    markerColorHex: color,
    bbox: args.bbox,
    markerPoints: markerPoints(args.bbox),
  };
}

function actions(page: MiniLecturePage): MiniLectureAction[] {
  return page.regions.flatMap((item) => [
    {
      id: `${item.id}-spotlight`,
      type: 'spotlight' as const,
      elementId: item.id,
      title: `聚焦：${item.label}`,
      dimOpacity: 0.62,
    },
    {
      id: `${item.id}-speech`,
      type: 'speech' as const,
      title: item.label,
      text: item.script,
    },
  ]);
}

function svgTextBlock(args: {
  text: string;
  x: number;
  y: number;
  maxChars: number;
  maxLines: number;
  fontSize: number;
  color?: string;
  weight?: number;
}) {
  const lines = wrapLectureLine(args.text, args.maxChars, args.maxLines);
  return `<text x="${args.x}" y="${args.y}" font-family="Microsoft YaHei, PingFang SC, Arial, sans-serif" font-size="${args.fontSize}" font-weight="${args.weight || 500}" fill="${args.color || '#0f172a'}">${lines
    .map(
      (line, index) =>
        `<tspan x="${args.x}" dy="${index === 0 ? 0 : args.fontSize * 1.45}">${xmlEscape(line)}</tspan>`,
    )
    .join('')}</text>`;
}

function slideDataUrl(args: { title: string; subtitle: string; regions: MiniLectureRegion[] }) {
  const regionMarkup = args.regions
    .map((item, index) => {
      const [x0, y0, x1, y1] = item.bbox;
      const textX = x0 + 22;
      const textY = y0 + 42;
      const markerRects = item.markerPoints
        .map(
          (point) =>
            `<rect x="${point.x - MARKER_SIZE / 2}" y="${point.y - MARKER_SIZE / 2}" width="${MARKER_SIZE}" height="${MARKER_SIZE}" rx="2" fill="${item.markerColorHex}" opacity="0.95" />`,
        )
        .join('');
      return `
        <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="20" fill="${index % 2 === 0 ? '#f8fafc' : '#f0fdfa'}" stroke="${item.markerColorHex}" stroke-opacity="0.18" />
        ${markerRects}
        ${svgTextBlock({ text: item.label, x: textX, y: textY, maxChars: 22, maxLines: 1, fontSize: 24, color: '#0f172a', weight: 700 })}
        ${svgTextBlock({ text: item.script, x: textX, y: textY + 38, maxChars: 34, maxLines: 3, fontSize: 18, color: '#334155', weight: 450 })}
      `;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
    <defs><pattern id="miniGrid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e2e8f0" stroke-width="1" opacity="0.45" /></pattern></defs>
    <rect width="100%" height="100%" fill="#fffdf8" />
    <rect width="100%" height="100%" fill="url(#miniGrid)" />
    <rect x="34" y="28" width="932" height="506" rx="28" fill="#ffffff" opacity="0.72" />
    ${svgTextBlock({ text: args.title, x: 70, y: 72, maxChars: 24, maxLines: 1, fontSize: 30, color: '#0f172a', weight: 800 })}
    ${svgTextBlock({ text: args.subtitle, x: 72, y: 108, maxChars: 42, maxLines: 1, fontSize: 15, color: '#64748b', weight: 500 })}
    ${regionMarkup}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function page(args: {
  deckId: string;
  pageIndex: number;
  title: string;
  subtitle: string;
  regions: MiniLectureRegion[];
}): MiniLecturePage {
  const result: MiniLecturePage = {
    id: `${args.deckId}-page-${args.pageIndex + 1}`,
    title: args.title,
    imageDataUrl: slideDataUrl(args),
    regions: args.regions,
    actions: [],
  };
  return { ...result, actions: actions(result) };
}

function isMiniLectureCandidate(question: string, answer: string): boolean {
  if (answer.trim().length < 120) return false;
  if (
    /(学到哪里|学习状态|当前状态|进度|复习计划|学习计划|刷题计划|小测|quiz|test|日程|安排|提醒|记忆里有什么)/i.test(
      question,
    )
  ) {
    return false;
  }
  const explanationSignal =
    /(讲解|解释|说明|为什么|怎么理解|怎么做|如何做|是什么|什么是|定义|原理|区别|关系|含义|例子|举例|题目|这道题|解题|求解|计算|证明|推导|公式|定理|概念|知识点|错在哪|哪里错|step|explain|why|how|prove|problem)/i;
  const problemSignal =
    /(^|\s)(已知|若|设|求|解|证明|下列|选择题)|[=∫∑√∞]|\b(?:lim|sin|cos|tan|log)\b|\\(?:frac|sqrt|int|sum)\b/i;
  const answerSignal =
    /(核心思路|解题步骤|第一步|首先|因此|所以|定义是|关键在于|可以理解为|证明如下)/i;
  return (
    explanationSignal.test(question) ||
    problemSignal.test(question) ||
    (question.trim().length >= 18 && answerSignal.test(answer))
  );
}

export function buildMiniLecturePrompt(args: {
  question: string;
  answer: string;
  course: { name: string };
}): MiniLecturePrompt | undefined {
  if (!isMiniLectureCandidate(args.question, args.answer)) return undefined;
  return {
    id: makeClientId('mini-lecture-prompt'),
    title: compactLectureText(args.question, 42) || '课堂讲解',
    question: compactLectureText(args.question, 900),
    answer: compactLectureText(args.answer, 2200),
    courseName: args.course.name,
    createdAt: Date.now(),
  };
}

export function buildMiniLectureDeck(prompt: MiniLecturePrompt): MiniLectureDeck {
  const deckId = makeClientId('mini-lecture');
  const sentences = lectureSentences(prompt.answer);
  const first = sentences[0] || '先把题目的目标翻译成一句可以操作的话。';
  const second = sentences[1] || '再找出关键条件，决定先用定义、公式还是例子。';
  const third = sentences[2] || '最后把推理链条补完整，检查每一步是否回应题目。';
  const fourth = sentences[3] || sentences[2] || '最后收束成一个容易回看的重点。';
  const title = compactLectureText(prompt.title, 28) || '课堂讲解';
  const pages: MiniLecturePage[] = [
    page({
      deckId,
      pageIndex: 0,
      title,
      subtitle: `${prompt.courseName} · 迷你课堂讲解`,
      regions: [
        region({
          pageIndex: 0,
          index: 0,
          label: '题目抓手',
          script: `先看题目在问什么：${compactLectureText(prompt.question, 120)}`,
          bbox: [70, 130, 930, 220],
        }),
        region({
          pageIndex: 0,
          index: 1,
          label: '核心思路',
          script: first,
          bbox: [70, 244, 930, 346],
        }),
        region({
          pageIndex: 0,
          index: 2,
          label: '第一步怎么落地',
          script: second,
          bbox: [70, 370, 930, 484],
        }),
      ],
    }),
  ];

  if (sentences.length >= 3 || prompt.answer.length > 520) {
    pages.push(
      page({
        deckId,
        pageIndex: 1,
        title: '把讲解收束成检查清单',
        subtitle: `${prompt.courseName} · 最后一页`,
        regions: [
          region({
            pageIndex: 1,
            index: 0,
            label: '容易卡住的地方',
            script: third,
            bbox: [70, 140, 930, 258],
          }),
          region({
            pageIndex: 1,
            index: 1,
            label: '检查答案',
            script: fourth,
            bbox: [70, 290, 930, 410],
          }),
        ],
      }),
    );
  }

  return {
    id: deckId,
    title,
    sourceQuestion: prompt.question,
    sourceAnswer: prompt.answer,
    pages,
    markerProtocol: {
      type: 'corner-square-markers',
      markerSizePx: MARKER_SIZE,
      markerCountPerComponent: 4,
      recoveredFrom: 'client-mini-lecture',
    },
    createdAt: Date.now(),
  };
}

export function generatedManifestToMiniLectureDeck(
  manifest: GeneratedMiniLectureManifest,
  prompt: MiniLecturePrompt,
): MiniLectureDeck {
  return {
    id: manifest.lectureId,
    localAssetId: `mini-lecture:${manifest.lectureId}`,
    title: manifest.title,
    sourceQuestion: prompt.question,
    sourceAnswer: prompt.answer,
    pages: manifest.pages.map((page) => {
      const scaleX = MINI_LECTURE_CANVAS_WIDTH / Math.max(1, page.width);
      const scaleY = MINI_LECTURE_CANVAS_HEIGHT / Math.max(1, page.height);
      const regions: MiniLectureRegion[] = page.regions.map((item) => {
        const [left, top, width, height] = item.bbox;
        const bbox: MiniLectureRegion['bbox'] = [
          left * scaleX,
          top * scaleY,
          (left + width) * scaleX,
          (top + height) * scaleY,
        ];
        return {
          id: item.id,
          label: item.label,
          script: '',
          markerColorHex: item.color,
          bbox,
          markerPoints: markerPoints(bbox),
        };
      });
      const speechByRegion = new Map(
        page.actions
          .filter(
            (action): action is Extract<(typeof page.actions)[number], { type: 'speech' }> =>
              action.type === 'speech',
          )
          .map((action) => [action.regionId, action.text] as const),
      );
      for (const item of regions) item.script = speechByRegion.get(item.id) || item.label;
      return {
        id: page.id,
        title: page.title,
        imageDataUrl: `data:${page.image.mimeType || 'image/png'};base64,${page.image.base64}`,
        regions,
        actions: page.actions.map(
          (action): MiniLectureAction =>
            action.type === 'spotlight'
              ? {
                  id: action.id,
                  type: 'spotlight',
                  elementId: action.regionId,
                  title: action.title,
                  dimOpacity: action.dimOpacity,
                }
              : {
                  id: action.id,
                  type: 'speech',
                  title: action.title,
                  text: action.text,
                  elementId: action.regionId,
                  audioDataUrl: `data:${action.audio.mimeType || 'audio/mpeg'};base64,${action.audio.base64}`,
                },
        ),
      };
    }),
    markerProtocol: {
      type: 'corner-square-markers',
      markerSizePx: MARKER_SIZE,
      markerCountPerComponent: 4,
      recoveredFrom: 'openai-image2-marker-recovery',
    },
    generator: manifest.generator,
    createdAt: Date.parse(manifest.createdAt) || Date.now(),
  };
}
