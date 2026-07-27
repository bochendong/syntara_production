import { nanoid } from 'nanoid';
import type {
  SceneOutline,
  GeneratedSlideContent,
  PdfImage,
  ImageMapping,
} from '@/lib/types/generation';
import type { PPTElement, PPTImageElement } from '@/lib/types/slides';
import {
  alignFallbackCardRows,
  buildInfoCard,
  createCircleElement,
  createLineElement,
  createRectElement,
  createTextElement,
  estimateWrappedLineCount,
  getRolePalette,
  normalizeList,
  normalizeText,
  splitIntoLines,
  toBulletHtml,
  toCodeHtml,
  toTextHtml,
} from './slide-fallback-content';
import { getWorkedExampleLabels } from './slide-worked-example-labels';

type WorkedExampleVisualAsset = {
  src: string;
  aspectRatio: number;
  source: 'assigned' | 'generated';
};

function createImageElement(args: {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  src: string;
}): PPTImageElement {
  return {
    id: `image_${nanoid(8)}`,
    type: 'image',
    name: args.name,
    left: args.left,
    top: args.top,
    width: args.width,
    height: args.height,
    rotate: 0,
    fixedRatio: true,
    src: args.src,
    radius: 18,
    imageType: 'itemFigure',
    outline: {
      color: '#e5e7eb',
      width: 1,
      style: 'solid',
    },
  };
}

function getAspectRatioValue(ratio?: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9'): number {
  switch (ratio) {
    case '4:3':
      return 4 / 3;
    case '1:1':
      return 1;
    case '9:16':
      return 9 / 16;
    case '3:4':
      return 3 / 4;
    case '21:9':
      return 21 / 9;
    case '16:9':
    default:
      return 16 / 9;
  }
}

function fitWithinBox(
  maxWidth: number,
  maxHeight: number,
  aspectRatio: number,
): { width: number; height: number } {
  const safeAspectRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : getAspectRatioValue('16:9');
  const widthFromHeight = maxHeight * safeAspectRatio;

  if (widthFromHeight <= maxWidth) {
    return {
      width: Math.round(widthFromHeight),
      height: Math.round(maxHeight),
    };
  }

  return {
    width: Math.round(maxWidth),
    height: Math.round(maxWidth / safeAspectRatio),
  };
}

function selectWorkedExampleVisualAsset(
  outline: SceneOutline,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  generatedMediaMapping?: ImageMapping,
): WorkedExampleVisualAsset | null {
  for (const image of assignedImages || []) {
    const resolvedSrc = imageMapping?.[image.id] || image.src;
    if (!resolvedSrc) continue;

    return {
      src: resolvedSrc,
      aspectRatio:
        image.width && image.height && image.height > 0 ? image.width / image.height : 4 / 3,
      source: 'assigned',
    };
  }

  const generatedImage = outline.mediaGenerations?.find((media) => media.type === 'image');
  if (!generatedImage) return null;

  return {
    src: generatedMediaMapping?.[generatedImage.elementId] || generatedImage.elementId,
    aspectRatio: getAspectRatioValue(generatedImage.aspectRatio),
    source: 'generated',
  };
}

function buildWorkedExampleVisualPanel(
  label: string,
  asset: WorkedExampleVisualAsset,
  layout: { left: number; top: number; width: number; height: number },
  palette: ReturnType<typeof getRolePalette>,
  name: string,
): PPTElement[] {
  const imageFrame = fitWithinBox(layout.width - 32, layout.height - 64, asset.aspectRatio);
  const imageLeft = layout.left + 16 + Math.round((layout.width - 32 - imageFrame.width) / 2);
  const imageTop = layout.top + 42 + Math.round((layout.height - 64 - imageFrame.height) / 2);

  return [
    createRectElement({
      name: `${name}_panel`,
      left: layout.left,
      top: layout.top,
      width: layout.width,
      height: layout.height,
      fill: '#ffffff',
      outlineColor: palette.accentSoft,
    }),
    createTextElement({
      name: `${name}_label`,
      left: layout.left + 16,
      top: layout.top + 12,
      width: layout.width - 32,
      height: 22,
      content: toTextHtml([label], {
        fontSize: 15,
        color: palette.accent,
        bold: true,
      }),
      defaultColor: palette.accent,
      textType: 'itemTitle',
    }),
    createImageElement({
      name: `${name}_image`,
      left: imageLeft,
      top: imageTop,
      width: imageFrame.width,
      height: imageFrame.height,
      src: asset.src,
    }),
  ];
}

function looksLikeRichMathNotation(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  return (
    /\\(begin|end|frac|sqrt|sum|int|lim|alpha|beta|gamma|theta|pi|cdot|times|left|right|pmatrix|bmatrix|matrix|cases|infty)/.test(
      normalized,
    ) ||
    /\^\{|\_\{/.test(normalized) ||
    /[∑∫√∞≈≠≤≥→←↦∀∃∈∉⊂⊆∪∩]/.test(normalized)
  );
}

function looksLikeStructuredCode(text: string): boolean {
  const normalized = text.replace(/\r/g, '');
  if (!normalized.trim()) return false;
  if (/```/.test(normalized)) return true;

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;

  let signalCount = 0;
  for (const line of lines.slice(0, 8)) {
    if (
      /\b(function|const|let|var|return|def|class|public|private|if|else|elif|for|while|switch|case|try|catch|import|from|print|console\.log)\b|=>|[{};]/.test(
        line,
      )
    ) {
      signalCount++;
    }
  }

  return signalCount >= 2;
}

function looksLikePlaceholderWorkedExampleText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  return [
    /^给定(一个|某个|若干|两个|一组)/,
    /^计算(一个|某个|两个|给定的?)/,
    /^请(写出|判断|计算|证明)/,
    /^对.+做/,
    /^继续/,
    /^根据.+(判断|说明)/,
    /^确认/,
    /^检查/,
    /^汇总/,
    /^分别计算/,
    /^Determine\b/i,
    /^Given\s+(a|an|some|two|the)\b/i,
    /^Compute\b/i,
    /^Check\b/i,
    /^Write\b/i,
    /^Apply\b/i,
    /^Continue\b/i,
    /^Based on\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function looksLikeConcreteQuantitativeDetail(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  return (
    looksLikeRichMathNotation(normalized) ||
    (/\d/.test(normalized) && /[A-Za-z\u4e00-\u9fff]/.test(normalized)) ||
    /[\[\]{}|]/.test(normalized) ||
    /[=+\-*/]/.test(normalized) ||
    /\b([xyzabcn]|x_\d|y_\d|z_\d|a_\d|b_\d|c_\d)\b/i.test(normalized) ||
    /(矩阵|增广矩阵|方程组|主元|自由变量|row operation|pivot|free variable|matrix|equation|RREF|Gaussian)/i.test(
      normalized,
    )
  );
}

function looksLikeQuantitativeWorkedExampleTopic(text: string): boolean {
  return /(矩阵|线性系统|方程组|消元|高斯|RREF|乘法|matrix|linear system|equation|elimination|gaussian|row reduction)/i.test(
    text,
  );
}

export function shouldUseLocalWorkedExampleTemplate(outline: SceneOutline): boolean {
  const cfg = outline.workedExampleConfig;
  if (!cfg) return false;

  const textBlocks = [
    cfg.problemStatement,
    ...(cfg.givens || []),
    ...(cfg.asks || []),
    ...(cfg.constraints || []),
    ...(cfg.solutionPlan || []),
    ...(cfg.walkthroughSteps || []),
    ...(cfg.commonPitfalls || []),
    cfg.finalAnswer,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  if (textBlocks.some((text) => looksLikeRichMathNotation(text))) {
    return false;
  }

  if (!cfg.codeSnippet?.trim() && textBlocks.some((text) => looksLikeStructuredCode(text))) {
    return false;
  }

  const topicText = [
    outline.title,
    outline.description,
    ...(outline.keyPoints || []),
    ...textBlocks,
  ].join(' ');
  const walkthroughSteps = (cfg.walkthroughSteps || []).filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  const quantitativeTopic =
    cfg.kind === 'math' || looksLikeQuantitativeWorkedExampleTopic(topicText);

  if (cfg.role === 'problem_statement') {
    const statement = cfg.problemStatement?.trim() || '';
    if (!statement) return false;
    if (looksLikePlaceholderWorkedExampleText(statement)) return false;
    if (quantitativeTopic && !looksLikeConcreteQuantitativeDetail(statement)) return false;
  }

  if (cfg.role === 'walkthrough') {
    if (walkthroughSteps.length === 0) return false;

    const detailedSteps = walkthroughSteps.filter(
      (step) =>
        !looksLikePlaceholderWorkedExampleText(step) &&
        (!quantitativeTopic || looksLikeConcreteQuantitativeDetail(step)),
    );

    if (detailedSteps.length < Math.min(2, walkthroughSteps.length)) {
      return false;
    }
  }

  return true;
}

export function buildWorkedExampleSlideContent(
  outline: SceneOutline,
  options?: {
    assignedImages?: PdfImage[];
    imageMapping?: ImageMapping;
    generatedMediaMapping?: ImageMapping;
  },
): GeneratedSlideContent | null {
  const cfg = outline.workedExampleConfig;
  if (!cfg) return null;

  const lang = outline.language || 'zh-CN';
  const labels = getWorkedExampleLabels(lang, cfg.role);
  const palette = getRolePalette(cfg.role);

  const problemText = normalizeText(
    cfg.problemStatement || outline.description || outline.keyPoints.join(' '),
    720,
  );
  const givens = normalizeList(cfg.givens, outline.keyPoints.slice(0, 3), 4, 90);
  const asks = normalizeList(
    cfg.asks,
    [lang === 'zh-CN' ? '明确本题最终要求' : 'Clarify what must be solved or shown'],
    3,
    90,
  );
  const constraints = normalizeList(
    cfg.constraints,
    [lang === 'zh-CN' ? '关注题目中的关键条件' : 'Track the key constraints carefully'],
    4,
    90,
  );
  const solutionPlan = normalizeList(cfg.solutionPlan, outline.keyPoints, 4, 96);
  const walkthroughSteps = normalizeList(
    cfg.walkthroughSteps,
    solutionPlan.length > 0
      ? solutionPlan
      : [
          lang === 'zh-CN'
            ? '按照题目条件逐步推进'
            : 'Advance step by step from the given information',
        ],
    5,
    108,
  );
  const commonPitfalls = normalizeList(
    cfg.commonPitfalls,
    [lang === 'zh-CN' ? '不要跳步或忽略关键条件' : 'Do not skip steps or ignore key conditions'],
    4,
    100,
  );
  const finalAnswer = normalizeText(cfg.finalAnswer || outline.description, 220);
  const codeLines = cfg.codeSnippet?.trim()
    ? cfg.codeSnippet
        .replace(/\r/g, '')
        .split('\n')
        .slice(0, 11)
        .map((line) => line.replace(/\t/g, '  '))
    : [];
  const visualAsset = selectWorkedExampleVisualAsset(
    outline,
    options?.assignedImages,
    options?.imageMapping,
    options?.generatedMediaMapping,
  );

  const badgeText =
    cfg.partNumber && cfg.totalParts
      ? lang === 'zh-CN'
        ? `${labels.stage} · ${cfg.partNumber}/${cfg.totalParts}`
        : `${labels.stage} · ${labels.part} ${cfg.partNumber}/${cfg.totalParts}`
      : labels.stage;

  const elements: PPTElement[] = [
    createRectElement({
      name: 'top_accent',
      left: 0,
      top: 0,
      width: 1000,
      height: 8,
      fill: palette.accent,
    }),
    createTextElement({
      name: 'slide_title',
      left: 56,
      top: 30,
      width: 660,
      height: 52,
      content: toTextHtml(splitIntoLines(outline.title, 34, 2), {
        fontSize: 30,
        color: '#0f172a',
        bold: true,
      }),
      defaultColor: '#0f172a',
      textType: 'title',
    }),
    createRectElement({
      name: 'stage_badge_bg',
      left: 736,
      top: 36,
      width: 212,
      height: 34,
      fill: palette.accentSoft,
    }),
    createTextElement({
      name: 'stage_badge_text',
      left: 748,
      top: 43,
      width: 188,
      height: 20,
      content: toTextHtml([badgeText], {
        fontSize: 13,
        color: palette.accent,
        align: 'center',
        bold: true,
      }),
      defaultColor: palette.accent,
      textType: 'notes',
    }),
    createLineElement({
      name: 'header_rule',
      start: [56, 86],
      end: [944, 86],
      color: '#e5e7eb',
      width: 2,
    }),
  ];

  if (cfg.role === 'problem_statement') {
    const hasCode = codeLines.length > 0;
    const showVisual = !hasCode && !!visualAsset;
    const problemWidth = hasCode ? 472 : showVisual ? 544 : 896;
    const problemFontSize = hasCode ? 16 : 17;
    const problemLineHeight = 1.42;
    const problemLineEstimate = estimateWrappedLineCount(
      problemText,
      hasCode ? 38 : showVisual ? 50 : 72,
      hasCode ? 8 : 7,
    );
    const problemTextHeight = Math.max(
      hasCode ? 120 : 44,
      Math.round(problemLineEstimate * problemFontSize * problemLineHeight + 8),
    );
    const problemPanelHeight = hasCode
      ? 248
      : showVisual
        ? Math.max(148, Math.min(210, problemTextHeight + 58))
        : Math.max(118, Math.min(210, problemTextHeight + 58));
    const problemRowHeight = Math.max(problemPanelHeight, hasCode ? 248 : 0, showVisual ? 210 : 0);
    const detailCardsTop = 108 + problemRowHeight + 24;
    const cards = [
      { label: labels.givens, items: givens },
      { label: labels.asks, items: asks },
      { label: labels.constraints, items: constraints },
    ].filter((section) => section.items.length > 0);

    elements.push(
      createRectElement({
        name: 'problem_statement_panel',
        left: 52,
        top: 108,
        width: problemWidth,
        height: problemPanelHeight,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'problem_statement_label',
        left: 72,
        top: 126,
        width: problemWidth - 40,
        height: 24,
        content: toTextHtml([labels.question], {
          fontSize: 17,
          color: palette.accent,
          bold: true,
        }),
        defaultColor: palette.accent,
        textType: 'itemTitle',
      }),
      createTextElement({
        name: 'problem_statement_text',
        left: 72,
        top: 158,
        width: problemWidth - 40,
        height: problemPanelHeight - 60,
        content: toTextHtml(splitIntoLines(problemText, hasCode ? 42 : 88, hasCode ? 8 : 7), {
          fontSize: problemFontSize,
          color: '#0f172a',
          lineHeight: problemLineHeight,
        }),
        defaultColor: '#0f172a',
        textType: 'content',
      }),
    );

    if (showVisual && visualAsset) {
      elements.push(
        ...buildWorkedExampleVisualPanel(
          visualAsset.source === 'generated' ? labels.generatedVisual : labels.referenceVisual,
          visualAsset,
          { left: 620, top: 108, width: 328, height: problemRowHeight },
          palette,
          'problem_visual',
        ),
      );
    }

    if (hasCode) {
      elements.push(
        createRectElement({
          name: 'code_excerpt_panel',
          left: 544,
          top: 108,
          width: 404,
          height: 248,
          fill: palette.codeBg,
        }),
        createTextElement({
          name: 'code_excerpt_label',
          left: 562,
          top: 126,
          width: 368,
          height: 22,
          content: toTextHtml([lang === 'zh-CN' ? '代码片段' : 'Code Excerpt'], {
            fontSize: 16,
            color: '#c7d2fe',
            bold: true,
          }),
          defaultColor: '#c7d2fe',
          textType: 'itemTitle',
        }),
        createTextElement({
          name: 'code_excerpt_text',
          left: 562,
          top: 156,
          width: 368,
          height: 178,
          content: toCodeHtml(codeLines),
          defaultColor: '#e2e8f0',
          defaultFontName: 'Menlo, Monaco, Consolas, monospace',
          textType: 'content',
        }),
      );
    }

    if (cards.length > 0) {
      const widths = cards.length === 1 ? [896] : cards.length === 2 ? [436, 436] : [284, 284, 284];
      const lefts = cards.length === 1 ? [52] : cards.length === 2 ? [52, 512] : [52, 360, 668];
      cards.forEach((card, idx) => {
        elements.push(
          ...buildInfoCard(
            card.label,
            card.items,
            {
              left: lefts[idx],
              top: detailCardsTop,
              width: widths[idx],
              height: hasCode ? 130 : 162,
            },
            palette,
            `${card.label.toLowerCase().replace(/\s+/g, '_')}_${idx}`,
          ),
        );
      });
    }
  } else if (cfg.role === 'givens_and_goal' || cfg.role === 'constraints') {
    const showVisual = !!visualAsset;
    elements.push(
      createRectElement({
        name: 'problem_reminder_panel',
        left: 52,
        top: 108,
        width: showVisual ? 560 : 896,
        height: showVisual ? 94 : 82,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'problem_reminder_label',
        left: 72,
        top: 124,
        width: 180,
        height: 22,
        content: toTextHtml([labels.reminder], {
          fontSize: 16,
          color: palette.accent,
          bold: true,
        }),
        defaultColor: palette.accent,
        textType: 'itemTitle',
      }),
      createTextElement({
        name: 'problem_reminder_text',
        left: 72,
        top: 150,
        width: showVisual ? 520 : 856,
        height: showVisual ? 38 : 28,
        content: toTextHtml(
          splitIntoLines(problemText, showVisual ? 72 : 120, showVisual ? 2 : 1),
          {
            fontSize: 15,
            color: '#334155',
          },
        ),
        defaultColor: '#334155',
        textType: 'content',
      }),
    );

    if (showVisual && visualAsset) {
      elements.push(
        ...buildWorkedExampleVisualPanel(
          visualAsset.source === 'generated' ? labels.generatedVisual : labels.referenceVisual,
          visualAsset,
          { left: 636, top: 108, width: 312, height: 170 },
          palette,
          'reminder_visual',
        ),
      );
    }

    const sections =
      cfg.role === 'constraints'
        ? [
            { label: labels.givens, items: givens },
            { label: labels.constraints, items: constraints },
            { label: labels.asks, items: asks },
          ]
        : [
            { label: labels.givens, items: givens },
            { label: labels.asks, items: asks },
            { label: labels.constraints, items: constraints },
          ];
    const lefts = [52, 360, 668];
    sections.forEach((section, idx) => {
      elements.push(
        ...buildInfoCard(
          section.label,
          section.items,
          {
            left: lefts[idx],
            top: showVisual ? 228 : 216,
            width: 280,
            height: showVisual ? 264 : 276,
          },
          palette,
          `${section.label.toLowerCase().replace(/\s+/g, '_')}_${idx}`,
        ),
      );
    });
  } else if (cfg.role === 'solution_plan') {
    elements.push(
      createRectElement({
        name: 'problem_reminder_panel',
        left: 52,
        top: 108,
        width: 896,
        height: 70,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'problem_reminder_text',
        left: 72,
        top: 128,
        width: 856,
        height: 26,
        content: toTextHtml(splitIntoLines(problemText, 116, 1), {
          fontSize: 15,
          color: '#334155',
        }),
        defaultColor: '#334155',
        textType: 'content',
      }),
    );

    solutionPlan.slice(0, 4).forEach((step, idx) => {
      const top = 198 + idx * 82;
      elements.push(
        createCircleElement({
          name: `plan_step_number_${idx + 1}`,
          left: 70,
          top,
          size: 36,
          fill: palette.accent,
        }),
        createTextElement({
          name: `plan_step_number_text_${idx + 1}`,
          left: 78,
          top: top + 6,
          width: 20,
          height: 20,
          content: toTextHtml([String(idx + 1)], {
            fontSize: 16,
            color: '#ffffff',
            align: 'center',
            bold: true,
          }),
          defaultColor: '#ffffff',
          textType: 'itemNumber',
        }),
        createRectElement({
          name: `solution_plan_card_${idx + 1}`,
          left: 124,
          top: top - 6,
          width: 804,
          height: 56,
          fill: idx % 2 === 0 ? palette.panel : palette.panelAlt,
          outlineColor: palette.accentSoft,
        }),
        createTextElement({
          name: `solution_plan_text_${idx + 1}`,
          left: 146,
          top: top + 8,
          width: 760,
          height: 28,
          content: toTextHtml(splitIntoLines(step, 90, 2), {
            fontSize: 17,
            color: '#0f172a',
            lineHeight: 1.36,
          }),
          defaultColor: '#0f172a',
          textType: 'content',
        }),
      );
    });
  } else if (cfg.role === 'walkthrough') {
    const hasCode = codeLines.length > 0;
    elements.push(
      createRectElement({
        name: 'givens_goal_strip',
        left: 52,
        top: 108,
        width: 896,
        height: 70,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'givens_goal_strip_text',
        left: 72,
        top: 128,
        width: 856,
        height: 26,
        content: toTextHtml(
          [
            lang === 'zh-CN'
              ? `目标：${asks[0] || problemText}`
              : `Goal: ${asks[0] || problemText}`,
          ],
          {
            fontSize: 15,
            color: '#334155',
          },
        ),
        defaultColor: '#334155',
        textType: 'content',
      }),
    );

    if (hasCode) {
      elements.push(
        createRectElement({
          name: 'walkthrough_steps_panel',
          left: 52,
          top: 198,
          width: 392,
          height: 300,
          fill: palette.panelAlt,
          outlineColor: palette.accentSoft,
        }),
        createTextElement({
          name: 'walkthrough_steps_label',
          left: 70,
          top: 216,
          width: 356,
          height: 22,
          content: toTextHtml([labels.steps], {
            fontSize: 16,
            color: palette.accent,
            bold: true,
          }),
          defaultColor: palette.accent,
          textType: 'itemTitle',
        }),
        createTextElement({
          name: 'walkthrough_steps_text',
          left: 70,
          top: 244,
          width: 356,
          height: 230,
          content: toBulletHtml(walkthroughSteps, {
            fontSize: 15,
            color: '#0f172a',
            bulletColor: palette.accent,
          }),
          defaultColor: '#0f172a',
          textType: 'content',
        }),
        createRectElement({
          name: 'code_excerpt_panel',
          left: 468,
          top: 198,
          width: 480,
          height: 300,
          fill: palette.codeBg,
        }),
        createTextElement({
          name: 'code_excerpt_label',
          left: 488,
          top: 216,
          width: 440,
          height: 22,
          content: toTextHtml([lang === 'zh-CN' ? '当前代码' : 'Current Code'], {
            fontSize: 16,
            color: '#c7d2fe',
            bold: true,
          }),
          defaultColor: '#c7d2fe',
          textType: 'itemTitle',
        }),
        createTextElement({
          name: 'code_excerpt_text',
          left: 488,
          top: 246,
          width: 440,
          height: 226,
          content: toCodeHtml(codeLines),
          defaultColor: '#e2e8f0',
          defaultFontName: 'Menlo, Monaco, Consolas, monospace',
          textType: 'content',
        }),
      );
    } else {
      walkthroughSteps.slice(0, 4).forEach((step, idx) => {
        const top = 198 + idx * 78;
        elements.push(
          createRectElement({
            name: `walkthrough_step_card_${idx + 1}`,
            left: 64,
            top,
            width: 872,
            height: 58,
            fill: idx % 2 === 0 ? palette.panelAlt : palette.panel,
            outlineColor: palette.accentSoft,
          }),
          createTextElement({
            name: `walkthrough_step_text_${idx + 1}`,
            left: 84,
            top: top + 15,
            width: 832,
            height: 28,
            content: toTextHtml([`${lang === 'zh-CN' ? '步骤' : 'Step'} ${idx + 1}: ${step}`], {
              fontSize: 16,
              color: '#0f172a',
              lineHeight: 1.36,
            }),
            defaultColor: '#0f172a',
            textType: 'content',
          }),
        );
      });
    }
  } else if (cfg.role === 'pitfalls') {
    const leftItems = commonPitfalls.filter((_, idx) => idx % 2 === 0);
    const rightItems = commonPitfalls.filter((_, idx) => idx % 2 === 1);
    elements.push(
      ...buildInfoCard(
        labels.pitfalls,
        leftItems.length > 0 ? leftItems : commonPitfalls.slice(0, 2),
        { left: 52, top: 118, width: 428, height: 284 },
        palette,
        'pitfalls_left',
      ),
      ...buildInfoCard(
        lang === 'zh-CN' ? '纠正提醒' : 'Corrections',
        rightItems.length > 0
          ? rightItems
          : solutionPlan
              .slice(0, 2)
              .map((item) => (lang === 'zh-CN' ? `改进建议：${item}` : `Correction: ${item}`)),
        { left: 520, top: 118, width: 428, height: 284 },
        palette,
        'pitfalls_right',
      ),
      createRectElement({
        name: 'pitfalls_footer_panel',
        left: 52,
        top: 428,
        width: 896,
        height: 84,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'pitfalls_footer_text',
        left: 72,
        top: 450,
        width: 856,
        height: 40,
        content: toTextHtml(
          [
            lang === 'zh-CN'
              ? `讲题时重点提醒：${commonPitfalls[0] || '先核对条件，再推进步骤。'}`
              : `Teaching focus: ${commonPitfalls[0] || 'Check the conditions before moving to the next step.'}`,
          ],
          {
            fontSize: 16,
            color: '#7c2d12',
          },
        ),
        defaultColor: '#7c2d12',
        textType: 'notes',
      }),
    );
  } else {
    elements.push(
      createRectElement({
        name: 'final_answer_panel',
        left: 52,
        top: 114,
        width: 896,
        height: 118,
        fill: palette.panel,
        outlineColor: palette.accentSoft,
      }),
      createTextElement({
        name: 'final_answer_label',
        left: 72,
        top: 134,
        width: 140,
        height: 22,
        content: toTextHtml([labels.answer], {
          fontSize: 16,
          color: palette.accent,
          bold: true,
        }),
        defaultColor: palette.accent,
        textType: 'itemTitle',
      }),
      createTextElement({
        name: 'final_answer_text',
        left: 72,
        top: 166,
        width: 856,
        height: 44,
        content: toTextHtml(splitIntoLines(finalAnswer, 110, 2), {
          fontSize: 20,
          color: '#0f172a',
          bold: true,
          lineHeight: 1.32,
        }),
        defaultColor: '#0f172a',
        textType: 'content',
      }),
      ...buildInfoCard(
        lang === 'zh-CN' ? '关键收获' : 'Key Takeaways',
        solutionPlan.length > 0 ? solutionPlan : walkthroughSteps,
        { left: 52, top: 264, width: 428, height: 236 },
        palette,
        'summary_takeaways',
      ),
      ...buildInfoCard(
        labels.pitfalls,
        commonPitfalls,
        { left: 520, top: 264, width: 428, height: 236 },
        palette,
        'summary_pitfalls',
      ),
    );
  }

  return {
    elements: alignFallbackCardRows(elements),
    background: { type: 'solid', color: '#fcfcfd' },
    remark: outline.description,
  };
}
