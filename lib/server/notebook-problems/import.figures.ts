import { createHash } from 'node:crypto';
import type { LanguageModel } from 'ai';
import { jsonrepair } from 'jsonrepair';
import { callLLM } from '@/lib/ai/llm';
import type { NotebookProblemImageAsset, NotebookProblemImportDraft } from '@/lib/problem-bank';
import type { ImportUsageSummary } from './import.core.types';
import { llmUsageFromResult, mergeImportUsage } from './import.core.usage';

/**
 * Crops the real source figures each imported problem depends on and attaches them to
 * publicContent.assets.images. The model only names figures (sourceMeta.figureRefs);
 * pixels always come from the uploaded file, so a figure is never redrawn or invented.
 *
 * Flow per source page: render page → locate named figures on a gridded copy →
 * crop → independent crop check (complete, matches, no answer marks) → attach.
 * A figure that cannot be cropped cleanly is reported as a review issue rather than
 * silently attached as a full page that may contain solutions.
 */

const RENDER_WIDTH = 1700;
const MAX_FIGURE_WIDTH = 1400;
const LOCATE_CONCURRENCY = 3;
const MAX_IMAGES_PER_PROBLEM = 8;
const EDGE_EXPAND = 40; // normalized units (0-1000) added to an edge reported as cut off

export type FigureRole = 'question' | 'context' | 'option';

export type FigureRef = {
  label: string;
  pageNumber: number;
  description: string;
  role: FigureRole;
};

export type FigureProvenance = {
  label: string;
  pageNumber: number;
  box: [number, number, number, number];
  imageSha256: string;
  width: number;
  height: number;
  method: 'pdf-page-crop' | 'image-crop';
  check: { complete: boolean; matches: boolean; answerMarks: boolean; extraneous: boolean };
};

export type FigureAttachmentResult = {
  drafts: NotebookProblemImportDraft[];
  usage: ImportUsageSummary | null;
  attachedCount: number;
  uniqueFigureCount: number;
  issueCount: number;
};

type PageRaster = { png: Buffer; width: number; height: number };

type SourceRasterizer = {
  kind: 'pdf' | 'image';
  pageCount: number;
  render(pageNumber: number): Promise<PageRaster | null>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPositiveInt(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeRole(value: unknown): FigureRole {
  return value === 'context' || value === 'option' ? value : 'question';
}

/** Reads figure references from both the transcription pass and the structure outline. */
export function collectDraftFigureRefs(
  draft: NotebookProblemImportDraft,
  language: 'zh-CN' | 'en-US',
): FigureRef[] {
  const meta = asRecord(draft.sourceMeta);
  const fallbackPage = asPositiveInt(meta.pageStart);
  const refs: FigureRef[] = [];
  const defaultLabel = (index: number) =>
    language === 'zh-CN' ? `图${index + 1}` : `Figure ${index + 1}`;

  const figureRefs = Array.isArray(meta.figureRefs) ? meta.figureRefs : [];
  for (const raw of figureRefs) {
    const item = asRecord(raw);
    const pageNumber = asPositiveInt(item.pageNumber) ?? fallbackPage;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!pageNumber || !description) continue;
    refs.push({
      label:
        typeof item.label === 'string' && item.label.trim()
          ? item.label.trim().slice(0, 40)
          : defaultLabel(refs.length),
      pageNumber,
      description: description.slice(0, 400),
      role: normalizeRole(item.role),
    });
  }
  if (refs.length > 0) return refs.slice(0, MAX_IMAGES_PER_PROBLEM);

  // Outline visualRefs are written as "p6: description". Older outlines may omit the
  // page; fall back to the problem's first page so the figure is still searched for.
  const visualRefs = Array.isArray(meta.structureVisualRefs) ? meta.structureVisualRefs : [];
  for (const raw of visualRefs) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const match = raw.match(/^\s*p(?:age)?\s*(\d+)\s*[:：]\s*(.+)$/i);
    const pageNumber = match ? asPositiveInt(match[1]) : fallbackPage;
    const description = (match ? match[2] : raw).trim();
    if (!pageNumber || !description) continue;
    refs.push({
      label: defaultLabel(refs.length),
      pageNumber,
      description: description.slice(0, 400),
      role: 'question',
    });
  }
  return refs.slice(0, MAX_IMAGES_PER_PROBLEM);
}

export async function createSourceRasterizer(args: {
  buffer: Buffer;
  mimeType: string;
}): Promise<SourceRasterizer | null> {
  const mime = args.mimeType.toLowerCase();
  if (mime.startsWith('image/')) {
    const sharp = (await import('sharp')).default;
    let cached: PageRaster | null = null;
    return {
      kind: 'image',
      pageCount: 1,
      async render(pageNumber) {
        if (pageNumber !== 1) return null;
        if (!cached) {
          const { data, info } = await sharp(args.buffer)
            .rotate()
            .flatten({ background: '#ffffff' })
            .png()
            .toBuffer({ resolveWithObject: true });
          cached = { png: data, width: info.width, height: info.height };
        }
        return cached;
      },
    };
  }
  if (!mime.includes('pdf')) return null;

  const { createIsomorphicCanvasFactory, getDocumentProxy, renderPageAsImage } =
    await import('unpdf');
  const canvasImport = () => import('@napi-rs/canvas');
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const sharp = (await import('sharp')).default;
  const pdf = await getDocumentProxy(new Uint8Array(args.buffer), { CanvasFactory });
  const cache = new Map<number, Promise<PageRaster | null>>();
  return {
    kind: 'pdf',
    pageCount: pdf.numPages,
    render(pageNumber) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) return Promise.resolve(null);
      const existing = cache.get(pageNumber);
      if (existing) return existing;
      const pending = (async () => {
        const rendered = await renderPageAsImage(pdf, pageNumber, {
          width: RENDER_WIDTH,
          canvasImport,
        });
        // Transparent PDF content must sit on white, or dark-mode viewers lose lines.
        const { data, info } = await sharp(Buffer.from(rendered))
          .flatten({ background: '#ffffff' })
          .png()
          .toBuffer({ resolveWithObject: true });
        return { png: data, width: info.width, height: info.height };
      })().catch(() => null);
      cache.set(pageNumber, pending);
      return pending;
    },
  };
}

/** Adds a labelled 0-1000 grid so the vision model can report coordinates reliably. */
async function gridOverlay(page: PageRaster): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const lines: string[] = [];
  for (let step = 0; step <= 1000; step += 50) {
    const major = step % 100 === 0;
    const x = (step / 1000) * page.width;
    const y = (step / 1000) * page.height;
    const stroke = major ? 'rgba(220,0,0,0.55)' : 'rgba(220,0,0,0.22)';
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${page.height}" stroke="${stroke}" stroke-width="${major ? 2 : 1}"/>`,
      `<line x1="0" y1="${y}" x2="${page.width}" y2="${y}" stroke="${stroke}" stroke-width="${major ? 2 : 1}"/>`,
    );
    if (major) {
      lines.push(
        `<text x="${x + 3}" y="16" font-size="16" fill="rgb(200,0,0)" font-family="sans-serif">${step}</text>`,
        `<text x="3" y="${y - 3}" font-size="16" fill="rgb(200,0,0)" font-family="sans-serif">${step}</text>`,
      );
    }
  }
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}">${lines.join('')}</svg>`,
  );
  return sharp(page.png)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(jsonrepair(stripped.slice(start, end + 1))));
  } catch {
    return null;
  }
}

function clampBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map((item) => Number(item));
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  const [x0, y0, x1, y1] = numbers.map((item) => Math.max(0, Math.min(1000, item)));
  if (x1 - x0 < 15 || y1 - y0 < 15) return null;
  return [x0, y0, x1, y1];
}

export function usageOf(
  model: LanguageModel,
  result: Awaited<ReturnType<typeof callLLM>>,
): ImportUsageSummary | null {
  return llmUsageFromResult({
    model,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cachedInputTokens: result.usage.cachedInputTokens ?? 0,
  });
}

/** Character-bigram Dice similarity; works for both Chinese and English descriptions. */
export function descriptionSimilarity(left: string, right: string): number {
  const grams = (value: string) => {
    const text = value.toLowerCase().replace(/[\s,，、.。:：;；()（）-]+/g, '');
    const set = new Set<string>();
    for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2));
    return set;
  };
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

type LocateTarget = { key: string; ref: FigureRef; stemExcerpt: string };

async function locateFiguresOnPage(args: {
  model: LanguageModel;
  page: PageRaster;
  targets: LocateTarget[];
  language: 'zh-CN' | 'en-US';
}): Promise<{
  boxes: Map<string, [number, number, number, number]>;
  usage: ImportUsageSummary | null;
}> {
  const gridded = await gridOverlay(args.page);
  const list = JSON.stringify(
    args.targets.map((target) => ({
      key: target.key,
      description: target.ref.description,
      question: target.stemExcerpt,
    })),
  );
  const instruction = `You are locating figures on one page of an exam/problem set. Image 1 is the page with a red 0-1000 coordinate grid (x to the right, y downward; labels every 100). Image 2 is the same page without the grid.

For each requested figure, return the tightest box that contains the WHOLE figure: every axis, tick label, axis title, legend, curve, structure, table cell and figure-internal label (A, B, Figure 1, column letters, row numbers). Exclude question text above/below it, other questions, page headers/footers, and handwritten answers when they are outside the figure. If the same figure appears more than once (for example a clean copy and a copy with handwritten or drawn answers), choose the clean printed copy. If the figure is not on this page, set found=false.
Copy each requested key exactly. Box coordinates MUST use the normalized 0-1000 grid, never image pixels: left=0, right=1000, top=0, bottom=1000.

Requested figures:
${list}

Return strict JSON only: {"figures":[{"key":"${args.targets[0]?.key ?? 'figure'}","found":true,"box":[x0,y0,x1,y1]}]}`;
  const result = await callLLM(
    {
      model: args.model,
      system: 'You return precise figure bounding boxes as machine-readable JSON only.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image', image: gridded, mediaType: 'image/png' },
            { type: 'image', image: args.page.png, mediaType: 'image/png' },
          ],
        },
      ],
      maxOutputTokens: 2000,
    },
    'problem-bank-import-figure-locate',
  );
  const parsed = parseJsonObject(result.text);
  const boxes = new Map<string, [number, number, number, number]>();
  const figures = Array.isArray(parsed?.figures) ? parsed.figures : [];
  for (const raw of figures) {
    const item = asRecord(raw);
    if (item.found === false || typeof item.key !== 'string') continue;
    const box = clampBox(item.box);
    if (box) boxes.set(item.key, box);
  }
  return { boxes, usage: usageOf(args.model, result) };
}

async function cropPage(
  page: PageRaster,
  box: [number, number, number, number],
): Promise<{ data: Buffer; width: number; height: number; mimeType: string }> {
  const sharp = (await import('sharp')).default;
  const pad = 8; // normalized units of breathing room so strokes on the edge survive
  const x0 = Math.max(0, Math.floor(((box[0] - pad) / 1000) * page.width));
  const y0 = Math.max(0, Math.floor(((box[1] - pad) / 1000) * page.height));
  const x1 = Math.min(page.width, Math.ceil(((box[2] + pad) / 1000) * page.width));
  const y1 = Math.min(page.height, Math.ceil(((box[3] + pad) / 1000) * page.height));
  const pipeline = sharp(page.png).extract({
    left: x0,
    top: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  });
  if (x1 - x0 > MAX_FIGURE_WIDTH) pipeline.resize({ width: MAX_FIGURE_WIDTH });
  const { data, info } = await pipeline
    .webp({ lossless: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, mimeType: 'image/webp' };
}

type CropCheck = {
  complete: boolean;
  cutEdges: Array<'top' | 'bottom' | 'left' | 'right'>;
  matches: boolean;
  answerMarks: boolean;
  extraneous: boolean;
  note: string;
};

async function checkCropOnce(args: {
  model: LanguageModel;
  crop: Buffer;
  mimeType: string;
  ref: FigureRef;
  stemExcerpt: string;
  source: string;
}): Promise<{ parsed: Record<string, unknown>; usage: ImportUsageSummary | null }> {
  const instruction = `This image was cropped from a problem source page (possibly an answer key). Expected figure: ${args.ref.description}
It is shown to students with this question: ${args.stemExcerpt}

Check the crop and return strict JSON only:
{"matches":true|false,          // is this the expected figure?
 "complete":true|false,         // are all axes, labels, legends, curves, structures and table cells fully inside?
 "cutEdges":["top"|"bottom"|"left"|"right"], // edges where figure content is cut off
 "handwrittenMarks":true|false, // pen/handwritten strokes, ticks, circled or selected choices, scribbles added on top of the printed figure. Printed coloured curves, printed labels and printed shading are NOT handwritten marks.
 "revealsAnswer":true|false,    // is this a worked solution: does it show the result the student is asked to draw, shade, label or compute (e.g. the shaded surplus regions or solution values drawn in)? Printed given data that the student must read to answer (tables, spreadsheets, sensitivity reports, problem graphs) is NOT revealing the answer.
 "extraneous":true|false,       // substantial text from the question or other questions included
 "note":"short reason"}`;
  const request = {
    model: args.model,
    system: 'You are a strict visual QA checker. Output machine-readable JSON only.',
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: instruction },
          { type: 'image' as const, image: args.crop, mediaType: args.mimeType },
        ],
      },
    ],
    maxOutputTokens: 1200,
  };
  const result = await callLLM(request, args.source);
  let usage = usageOf(args.model, result);
  let parsed = parseJsonObject(result.text) ?? {};
  if (typeof parsed.matches !== 'boolean') {
    // An empty or truncated verdict is not a rejection; ask once more.
    const retry = await callLLM(request, `${args.source}-retry`);
    usage = mergeImportUsage(usage, usageOf(args.model, retry));
    parsed = parseJsonObject(retry.text) ?? {};
  }
  return { parsed, usage };
}

/**
 * Vision verdicts on the same crop vary between calls. A rejecting verdict (handwritten
 * marks or answer leak) is confirmed by a second, independent check before the crop is
 * withheld, so a printed coloured curve is not discarded on one noisy call.
 */
async function checkCrop(args: {
  model: LanguageModel;
  crop: Buffer;
  mimeType: string;
  ref: FigureRef;
  stemExcerpt: string;
}): Promise<{ check: CropCheck; usage: ImportUsageSummary | null }> {
  const first = await checkCropOnce({ ...args, source: 'problem-bank-import-figure-check' });
  let usage = first.usage;
  let parsed = first.parsed;
  const rejects = (value: Record<string, unknown>) =>
    value.handwrittenMarks === true || value.revealsAnswer === true;
  // A "clean" verdict whose own note describes a result or solution is self-contradictory;
  // get a second opinion before trusting it.
  const suspiciousAccept =
    !rejects(parsed) &&
    typeof parsed.note === 'string' &&
    /\b(?:solution|answer|result|requested|shaded|marked)\b|答案|解答|结果/i.test(parsed.note);
  if (suspiciousAccept) {
    const second = await checkCropOnce({
      ...args,
      source: 'problem-bank-import-figure-check-second-opinion',
    });
    usage = mergeImportUsage(usage, second.usage);
    if (rejects(second.parsed)) parsed = { ...parsed, ...second.parsed };
  } else if (rejects(parsed)) {
    const second = await checkCropOnce({
      ...args,
      source: 'problem-bank-import-figure-check-confirm',
    });
    usage = mergeImportUsage(usage, second.usage);
    parsed = {
      ...parsed,
      handwrittenMarks: parsed.handwrittenMarks === true && second.parsed.handwrittenMarks === true,
      revealsAnswer: parsed.revealsAnswer === true && second.parsed.revealsAnswer === true,
    };
  }
  const edges = Array.isArray(parsed.cutEdges)
    ? parsed.cutEdges.filter(
        (edge): edge is CropCheck['cutEdges'][number] =>
          edge === 'top' || edge === 'bottom' || edge === 'left' || edge === 'right',
      )
    : [];
  return {
    check: {
      // Missing fields count as failures: an unverified crop must not pass silently.
      matches: parsed.matches === true,
      complete: parsed.complete === true && edges.length === 0,
      cutEdges: edges,
      answerMarks: parsed.handwrittenMarks === true || parsed.revealsAnswer === true,
      extraneous: parsed.extraneous === true,
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 300) : '',
    },
    usage,
  };
}

function expandBox(
  box: [number, number, number, number],
  edges: CropCheck['cutEdges'],
): [number, number, number, number] {
  const [x0, y0, x1, y1] = box;
  return [
    edges.includes('left') ? Math.max(0, x0 - EDGE_EXPAND) : x0,
    edges.includes('top') ? Math.max(0, y0 - EDGE_EXPAND) : y0,
    edges.includes('right') ? Math.min(1000, x1 + EDGE_EXPAND) : x1,
    edges.includes('bottom') ? Math.min(1000, y1 + EDGE_EXPAND) : y1,
  ];
}

function stemExcerptOf(draft: NotebookProblemImportDraft): string {
  const content = draft.publicContent as { stem?: string; stemTemplate?: string };
  return (content.stem ?? content.stemTemplate ?? draft.title).replace(/\s+/g, ' ').slice(0, 300);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

type CroppedFigure = {
  asset: Omit<NotebookProblemImageAsset, 'id' | 'role' | 'alt' | 'caption'>;
  provenance: Omit<FigureProvenance, 'label'>;
};

/** Higher is better: a matching, clean, complete crop beats a merely matching one. */
function cropRank(figure: CroppedFigure): number {
  const { check } = figure.provenance;
  if (!check.matches || check.answerMarks) return 0;
  return 1 + (check.complete ? 2 : 0) + (check.extraneous ? 0 : 1);
}

export async function attachSourceFiguresToDrafts(args: {
  drafts: NotebookProblemImportDraft[];
  sourceBuffer: Buffer;
  sourceMimeType: string;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<FigureAttachmentResult> {
  const zh = args.language === 'zh-CN';
  let usage: ImportUsageSummary | null = null;
  const rasterizer = await createSourceRasterizer({
    buffer: args.sourceBuffer,
    mimeType: args.sourceMimeType,
  }).catch(() => null);

  const refsByDraft = args.drafts.map((draft) => collectDraftFigureRefs(draft, args.language));
  const issuesByDraft = args.drafts.map(() => [] as string[]);
  const croppedByKey = new Map<string, CroppedFigure | null>();

  // Group requests by page; identical descriptions on a page share one crop.
  const targetsByPage = new Map<number, Map<string, LocateTarget>>();
  const keyFor = (ref: FigureRef) =>
    `fig_${createHash('sha256')
      .update(
        `p${ref.pageNumber}:${ref.description.toLowerCase().replace(/\s+/g, ' ').slice(0, 160)}`,
      )
      .digest('hex')
      .slice(0, 12)}`;
  refsByDraft.forEach((refs, draftIndex) => {
    for (const ref of refs) {
      const existingImages = args.drafts[draftIndex]?.publicContent.assets?.images ?? [];
      if (existingImages.length > 0) continue;
      const key = keyFor(ref);
      const page = targetsByPage.get(ref.pageNumber) ?? new Map<string, LocateTarget>();
      if (!page.has(key)) {
        page.set(key, { key, ref, stemExcerpt: stemExcerptOf(args.drafts[draftIndex]!) });
      }
      targetsByPage.set(ref.pageNumber, page);
    }
  });

  if (rasterizer) {
    await mapLimit([...targetsByPage.entries()], LOCATE_CONCURRENCY, async ([pageNumber, map]) => {
      const targets = [...map.values()];
      const page = await rasterizer.render(pageNumber);
      if (!page) {
        for (const target of targets) croppedByKey.set(target.key, null);
        return;
      }
      let located: Map<string, [number, number, number, number]>;
      try {
        const result = await locateFiguresOnPage({
          model: args.model,
          page,
          targets,
          language: args.language,
        });
        usage = mergeImportUsage(usage, result.usage);
        located = result.boxes;
      } catch {
        located = new Map();
      }
      for (const target of targets) {
        let box = located.get(target.key);
        let cropSource = page;
        let cropPageNumber = pageNumber;
        if (!box) {
          // Models often cite the printed page label instead of the physical page.
          // Try the neighbouring pages once before giving up.
          for (const neighbour of [pageNumber + 1, pageNumber - 1]) {
            const neighbourPage = await rasterizer.render(neighbour);
            if (!neighbourPage) continue;
            try {
              const retry = await locateFiguresOnPage({
                model: args.model,
                page: neighbourPage,
                targets: [target],
                language: args.language,
              });
              usage = mergeImportUsage(usage, retry.usage);
              const found = retry.boxes.get(target.key);
              if (found) {
                box = found;
                cropSource = neighbourPage;
                cropPageNumber = neighbour;
                break;
              }
            } catch {
              // Keep looking; an unlocated figure becomes a review issue below.
            }
          }
        }
        if (!box) {
          croppedByKey.set(target.key, null);
          continue;
        }
        let accepted: CroppedFigure | null = null;
        for (let attempt = 0; attempt < 3 && box; attempt += 1) {
          try {
            const crop = await cropPage(cropSource, box);
            const { check, usage: checkUsage } = await checkCrop({
              model: args.model,
              crop: crop.data,
              mimeType: crop.mimeType,
              ref: target.ref,
              stemExcerpt: target.stemExcerpt,
            });
            usage = mergeImportUsage(usage, checkUsage);
            const imageSha256 = createHash('sha256').update(crop.data).digest('hex');
            // Offline diagnostics: keep every candidate crop with its check result.
            const debugDir = process.env.IMPORT_FIGURE_DEBUG_DIR;
            if (debugDir) {
              const { mkdir, writeFile } = await import('node:fs/promises');
              await mkdir(debugDir, { recursive: true });
              const stem = `p${cropPageNumber}-${imageSha256.slice(0, 10)}`;
              await writeFile(`${debugDir}/${stem}.webp`, crop.data);
              await writeFile(
                `${debugDir}/${stem}.json`,
                JSON.stringify({ ref: target.ref, box, attempt, check }, null, 2),
              );
            }
            const candidate: CroppedFigure = {
              asset: {
                src: `data:${crop.mimeType};base64,${crop.data.toString('base64')}`,
                width: crop.width,
                height: crop.height,
                mimeType: crop.mimeType,
              },
              provenance: {
                pageNumber: cropPageNumber,
                box,
                imageSha256,
                width: crop.width,
                height: crop.height,
                method: rasterizer.kind === 'pdf' ? 'pdf-page-crop' : 'image-crop',
                check: {
                  complete: check.complete,
                  matches: check.matches,
                  answerMarks: check.answerMarks,
                  extraneous: check.extraneous,
                },
              },
            };
            // Never let a widened crop replace a better earlier one: a wider box can pull in
            // footers or neighbouring material and fail the match check.
            if (!accepted || cropRank(candidate) >= cropRank(accepted)) accepted = candidate;
            if (!check.complete && check.cutEdges.length > 0 && attempt < 2 && check.matches) {
              box = expandBox(box, check.cutEdges);
              continue;
            }
            break;
          } catch {
            break;
          }
        }
        croppedByKey.set(target.key, accepted);
      }
    });
  }

  // A figure shared by several questions is often registered with slightly different
  // descriptions or a wrong page on some of them. Reuse an accepted crop whose
  // description is clearly the same figure instead of reporting it missing.
  const refByKey = new Map<string, FigureRef>();
  for (const map of targetsByPage.values()) {
    for (const target of map.values()) refByKey.set(target.key, target.ref);
  }
  const usableFigure = (figure: CroppedFigure | null | undefined) =>
    figure && figure.provenance.check.matches && !figure.provenance.check.answerMarks
      ? figure
      : undefined;
  const sharedFigureFor = (ref: FigureRef): CroppedFigure | null | undefined => {
    let best: { figure: CroppedFigure; score: number } | null = null;
    for (const [key, candidate] of croppedByKey) {
      const accepted = usableFigure(candidate);
      const other = refByKey.get(key);
      if (!accepted || !other || key === keyFor(ref)) continue;
      if (Math.abs(other.pageNumber - ref.pageNumber) > 1) continue;
      const score = descriptionSimilarity(ref.description, other.description);
      if (score >= 0.6 && (!best || score > best.score)) best = { figure: accepted, score };
    }
    return best?.figure ?? croppedByKey.get(keyFor(ref));
  };

  let attachedCount = 0;
  const usedKeys = new Set<string>();
  const drafts = args.drafts.map((draft, draftIndex) => {
    const refs = refsByDraft[draftIndex] ?? [];
    const issues = issuesByDraft[draftIndex]!;
    const existingImages = draft.publicContent.assets?.images ?? [];
    if (refs.length === 0 || existingImages.length > 0) return draft;

    const images: NotebookProblemImageAsset[] = [];
    const provenance: FigureProvenance[] = [];
    for (const ref of refs) {
      const own = croppedByKey.get(keyFor(ref));
      // Never substitute for a figure that was withheld as a solution: a lookalike from
      // another question would silently replace the missing condition with the wrong one.
      const figure =
        usableFigure(own) ?? (own?.provenance.check.answerMarks ? own : sharedFigureFor(ref));
      if (!rasterizer) {
        issues.push(
          zh
            ? `${ref.label}：无法读取原文件页面，未能裁取原图。`
            : `${ref.label}: the source page could not be rendered, so the figure was not cropped.`,
        );
        continue;
      }
      if (!figure) {
        issues.push(
          zh
            ? `${ref.label}：未能在原文件第 ${ref.pageNumber} 页定位该图，需要人工补图。`
            : `${ref.label}: could not locate the figure on source page ${ref.pageNumber}; add it manually.`,
        );
        continue;
      }
      const { check } = figure.provenance;
      if (!check.matches || check.answerMarks) {
        issues.push(
          zh
            ? `${ref.label}：裁图${check.answerMarks ? '含手写痕迹或直接显示了本题答案' : '与题目所需图不符'}，未挂到题目，需要人工裁图。`
            : `${ref.label}: the crop ${check.answerMarks ? "contains handwriting or shows this question's answer" : 'does not match the needed figure'}; not attached, crop it manually.`,
        );
        continue;
      }
      if (!check.complete) {
        issues.push(
          zh
            ? `${ref.label}：裁图可能不完整，请核对边缘。`
            : `${ref.label}: the crop may be incomplete; check its edges.`,
        );
      }
      // Extra surrounding text is recorded in figureProvenance but is not a review issue.
      if (images.length >= MAX_IMAGES_PER_PROBLEM) break;
      if (
        images.some((image) => image.id === `fig-${figure.provenance.imageSha256.slice(0, 20)}`)
      ) {
        continue;
      }
      usedKeys.add(figure.provenance.imageSha256);
      images.push({
        ...figure.asset,
        id: `fig-${figure.provenance.imageSha256.slice(0, 20)}`,
        // Student-facing text carries only the in-question label, never source details.
        alt: ref.label,
        caption: ref.label,
        role: ref.role,
      });
      provenance.push({ label: ref.label, ...figure.provenance });
    }
    attachedCount += images.length;
    return {
      ...draft,
      publicContent: images.length
        ? ({
            ...draft.publicContent,
            assets: { images },
          } as NotebookProblemImportDraft['publicContent'])
        : draft.publicContent,
      sourceMeta: {
        ...draft.sourceMeta,
        figureProvenance: provenance,
        figureIssues: issues,
      },
    };
  });

  return {
    drafts,
    usage,
    attachedCount,
    uniqueFigureCount: usedKeys.size,
    issueCount: issuesByDraft.reduce((total, issues) => total + issues.length, 0),
  };
}
