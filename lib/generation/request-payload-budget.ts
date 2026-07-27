import { MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type { ImageMapping, PdfImage } from '@/lib/types/generation';

/**
 * Stay below common 4.5 MB serverless body limits with some headroom for
 * JSON wrappers and request metadata.
 */
export const SAFE_GENERATION_REQUEST_BYTES = Math.floor(4.0 * 1024 * 1024);

function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function stripInlineImageSrc(pdfImages?: PdfImage[]): PdfImage[] {
  return (pdfImages || []).map((image) =>
    image.src ? { ...image, src: '' } : image,
  );
}

function prioritizePdfImages(pdfImages: PdfImage[], preferredImageIds?: string[]): PdfImage[] {
  if (!preferredImageIds?.length) return pdfImages;

  const preferred = new Set(preferredImageIds);
  const preferredImages: PdfImage[] = [];
  const remainingImages: PdfImage[] = [];

  for (const image of pdfImages) {
    if (preferred.has(image.id)) {
      preferredImages.push(image);
    } else {
      remainingImages.push(image);
    }
  }

  return [...preferredImages, ...remainingImages];
}

export function buildBudgetedGenerationMedia(args: {
  basePayload: Record<string, unknown>;
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  preferredImageIds?: string[];
  maxRequestBytes?: number;
  maxVisionImages?: number;
}): {
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  requestBytes: number;
  retainedVisionImageIds: string[];
  omittedVisionImageIds: string[];
  omittedPdfImageIds: string[];
} {
  const maxRequestBytes = args.maxRequestBytes ?? SAFE_GENERATION_REQUEST_BYTES;
  const maxVisionImages = args.maxVisionImages ?? MAX_VISION_IMAGES;
  const basePayload = { ...args.basePayload };
  const orderedPdfImages = prioritizePdfImages(
    stripInlineImageSrc(args.pdfImages),
    args.preferredImageIds,
  );
  const omittedPdfImageIds: string[] = [];
  const omittedVisionImageIds: string[] = [];

  const keptPdfImages = [...orderedPdfImages];

  while (keptPdfImages.length > 0) {
    const payloadWithDescriptions = { ...basePayload, pdfImages: keptPdfImages };
    if (measureJsonBytes(payloadWithDescriptions) <= maxRequestBytes) {
      break;
    }
    const dropped = keptPdfImages.pop();
    if (dropped) omittedPdfImageIds.push(dropped.id);
  }

  const keptMapping: ImageMapping = {};
  const candidateVisionIds = keptPdfImages
    .filter((image) => !!args.imageMapping?.[image.id])
    .map((image) => image.id)
    .slice(0, maxVisionImages);

  for (const imageId of candidateVisionIds) {
    const src = args.imageMapping?.[imageId];
    if (!src) continue;

    const nextMapping = { ...keptMapping, [imageId]: src };
    const nextPayload = {
      ...basePayload,
      ...(keptPdfImages.length > 0 ? { pdfImages: keptPdfImages } : {}),
      imageMapping: nextMapping,
    };

    if (measureJsonBytes(nextPayload) <= maxRequestBytes) {
      keptMapping[imageId] = src;
    } else {
      omittedVisionImageIds.push(imageId);
    }
  }

  const finalPayload = {
    ...basePayload,
    ...(keptPdfImages.length > 0 ? { pdfImages: keptPdfImages } : {}),
    ...(Object.keys(keptMapping).length > 0 ? { imageMapping: keptMapping } : {}),
  };

  return {
    pdfImages: keptPdfImages.length > 0 ? keptPdfImages : undefined,
    imageMapping: Object.keys(keptMapping).length > 0 ? keptMapping : undefined,
    requestBytes: measureJsonBytes(finalPayload),
    retainedVisionImageIds: Object.keys(keptMapping),
    omittedVisionImageIds,
    omittedPdfImageIds,
  };
}
