import type { LocalProblemAnswer } from './local-problem-grading';
import { preparePhotoAnswer } from '../../../../lib/problem-bank/photo-answer';
import {
  INK_WIDTH,
  INK_HEIGHT,
  redrawInk,
  handwritingPages,
  type HandwritingPage,
  type HandwritingAnswer,
} from './handwriting-draft';

/** Render the logical page rather than the visible, possibly scrolled canvas area. */
export function renderHandwritingPage(ink: HTMLCanvasElement, page: HandwritingPage): boolean {
  ink.width = INK_WIDTH;
  ink.height = INK_HEIGHT;
  const context = ink.getContext('2d');
  if (!context) throw new Error('无法读取手写内容，请重试。');
  redrawInk(context, page.strokes);
  const pixels = context.getImageData(0, 0, INK_WIDTH, INK_HEIGHT).data;
  if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) return false;
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, INK_WIDTH, INK_HEIGHT);
  return true;
}

/** Capture the entire page once, when the learner submits. */
export async function prepareHandwritingAnswer(page: HandwritingPage, maxBytes?: number) {
  const ink = document.createElement('canvas');
  if (!renderHandwritingPage(ink, page)) return null;
  const blob = await new Promise<Blob>((resolve, reject) =>
    ink.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('无法读取手写内容，请重试。'))),
      'image/png',
    ),
  );
  const image = await preparePhotoAnswer(
    new File([blob], '手写作答.jpg', { type: 'image/png' }),
    maxBytes,
  );
  return { ...image, id: page.imageId };
}

/** Keep page order and skip blank sheets; each written page remains a separate readable image. */
export async function prepareHandwritingAnswers(answer: HandwritingAnswer, maxBytes?: number) {
  const images = [];
  const pages = handwritingPages(answer);
  for (let index = 0; index < pages.length; index++) {
    const image = await prepareHandwritingAnswer(pages[index], maxBytes);
    if (image) images.push({ ...image, name: `手写作答_第${index + 1}页.jpg` });
  }
  return images;
}

/** Snapshots use the same whole-page capture as explicit submissions. */
export async function prepareProblemHandwriting(
  answer: LocalProblemAnswer,
): Promise<LocalProblemAnswer> {
  if (answer.kind === 'text' && answer.handwriting) {
    const images = await prepareHandwritingAnswers(answer.handwriting);
    const { handwriting: _handwriting, ...plain } = answer;
    return { ...plain, images };
  }
  if (answer.kind === 'parts') {
    return {
      kind: 'parts',
      parts: Object.fromEntries(
        await Promise.all(
          Object.entries(answer.parts).map(async ([label, part]) => {
            if (!part.handwriting) return [label, part];
            const images = await prepareHandwritingAnswers(part.handwriting, 180 * 1024);
            const { handwriting: _handwriting, ...plain } = part;
            return [label, { ...plain, images }];
          }),
        ),
      ),
    };
  }
  return answer;
}
