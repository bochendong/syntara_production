import JSZip from 'jszip';

const DOCUMENT_XML_PATH = 'word/document.xml';
const MAX_DOCX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ENTRY_COUNT = 2_048;
const MAX_DOCX_DECLARED_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_DOCX_XML_PART_BYTES = 16 * 1024 * 1024;
const OPTIONAL_NOTE_PARTS = [
  { path: 'word/footnotes.xml', label: 'Footnotes' },
  { path: 'word/endnotes.xml', label: 'Endnotes' },
] as const;

type SizedZipEntry = JSZip.JSZipObject & {
  _data?: {
    uncompressedSize?: number;
  };
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|quot);/gi, (entity): string => {
    const normalized = entity.toLowerCase();
    if (normalized === '&amp;') return '&';
    if (normalized === '&apos;') return "'";
    if (normalized === '&gt;') return '>';
    if (normalized === '&lt;') return '<';
    if (normalized === '&quot;') return '"';

    const numericValue = normalized.startsWith('&#x')
      ? Number.parseInt(normalized.slice(3, -1), 16)
      : Number.parseInt(normalized.slice(2, -1), 10);
    if (
      !Number.isInteger(numericValue) ||
      numericValue < 0 ||
      numericValue > 0x10ffff ||
      (numericValue >= 0xd800 && numericValue <= 0xdfff)
    ) {
      return entity;
    }
    return String.fromCodePoint(numericValue);
  });
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize;
  return Number.isFinite(size) && Number(size) >= 0 ? Number(size) : 0;
}

function validateArchiveShape(archive: JSZip): void {
  const entries = Object.values(archive.files);
  if (entries.length > MAX_DOCX_ENTRY_COUNT) {
    throw new Error(
      `Invalid DOCX file: archive contains more than ${MAX_DOCX_ENTRY_COUNT} entries.`,
    );
  }

  const declaredBytes = entries.reduce(
    (total, entry) => total + declaredUncompressedSize(entry),
    0,
  );
  if (declaredBytes > MAX_DOCX_DECLARED_UNCOMPRESSED_BYTES) {
    throw new Error('Invalid DOCX file: declared uncompressed content is too large.');
  }
}

async function readXmlPart(entry: JSZip.JSZipObject, partPath: string): Promise<string> {
  if (declaredUncompressedSize(entry) > MAX_DOCX_XML_PART_BYTES) {
    throw new Error(`Invalid DOCX file: ${partPath} is too large.`);
  }

  const stream = entry.nodeStream('nodebuffer') as NodeJS.ReadableStream & {
    destroy?: () => void;
  };
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_DOCX_XML_PART_BYTES) {
        settled = true;
        stream.destroy?.();
        reject(new Error(`Invalid DOCX file: ${partPath} is too large.`));
        return;
      }
      chunks.push(buffer);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, totalBytes).toString('utf8'));
    });
  });
}

function extractTextFromOpenXml(xml: string): {
  text: string;
  paragraphCount: number;
  tableRowCount: number;
} {
  const parts: string[] = [];
  const tokenPattern =
    /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>|<w:softHyphen\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(xml))) {
    const token = match[0];
    if (match[1] !== undefined) {
      parts.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')));
    } else if (/^<w:tab\b/i.test(token) || /^<\/w:tc>/i.test(token)) {
      parts.push('\t');
    } else if (/^<w:(?:br|cr)\b/i.test(token) || /^<\/w:(?:p|tr)>/i.test(token)) {
      parts.push('\n');
    } else if (/^<w:noBreakHyphen\b/i.test(token)) {
      parts.push('-');
    } else if (/^<w:softHyphen\b/i.test(token)) {
      parts.push('\u00ad');
    }
  }

  return {
    text: normalizeExtractedText(parts.join('')),
    paragraphCount: (xml.match(/<\/w:p>/gi) || []).length,
    tableRowCount: (xml.match(/<\/w:tr>/gi) || []).length,
  };
}

export type ParsedDocxContent = {
  text: string;
  metadata: {
    paragraphCount: number;
    tableRowCount: number;
    notePartCount: number;
    fileName?: string;
    fileSize?: number;
  };
};

/**
 * Extract readable text from a DOCX OpenXML package without invoking an LLM.
 * The source-ingest route keeps the original file hash and uploads the original
 * package separately, while this deterministic text is used for classification,
 * deduplication, course-memory extraction, and notebook generation.
 */
export async function parseDocxBuffer(args: {
  buffer: Buffer;
  fileName?: string;
  fileSize?: number;
}): Promise<ParsedDocxContent> {
  if (args.buffer.length > MAX_DOCX_ARCHIVE_BYTES) {
    throw new Error('Invalid DOCX file: archive is larger than 50 MB.');
  }
  const archive = await JSZip.loadAsync(args.buffer);
  validateArchiveShape(archive);
  const documentEntry = archive.file(DOCUMENT_XML_PATH);
  if (!documentEntry) {
    throw new Error('Invalid DOCX file: word/document.xml is missing.');
  }

  const documentXml = await readXmlPart(documentEntry, DOCUMENT_XML_PATH);
  const document = extractTextFromOpenXml(documentXml);
  const noteSections: string[] = [];

  for (const notePart of OPTIONAL_NOTE_PARTS) {
    const entry = archive.file(notePart.path);
    if (!entry) continue;
    const parsed = extractTextFromOpenXml(await readXmlPart(entry, notePart.path));
    if (parsed.text) {
      noteSections.push(`${notePart.label}\n${parsed.text}`);
    }
  }

  const text = normalizeExtractedText(
    [document.text, ...noteSections].filter(Boolean).join('\n\n'),
  );
  if (!text) {
    throw new Error('DOCX file contains no usable text.');
  }

  return {
    text,
    metadata: {
      paragraphCount: document.paragraphCount,
      tableRowCount: document.tableRowCount,
      notePartCount: noteSections.length,
      fileName: args.fileName,
      fileSize: args.fileSize,
    },
  };
}
