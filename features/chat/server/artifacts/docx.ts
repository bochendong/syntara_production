/**
 * Render chat-authored Markdown into a Word document (.docx) built by hand
 * with jszip: document, styles, numbering, settings, footer and core props.
 *
 * Math is converted to native OMML (editable Word equations) through the
 * shared LaTeX → OMML engine; when a formula cannot be converted it falls back
 * to a readable linear form so the document never fails on one bad formula.
 */
import JSZip from 'jszip';

import { latexToOmml } from '@/lib/export/latex-to-omml';

import { latexToReadableText } from './latex-readable';
import { assertValidDocxPackage } from './xml-check';
import {
  extractDocumentTitle,
  parseMarkdownBlocks,
  type ChatDocumentImage,
  type ChatDocumentImages,
  type InlineNode,
  type MarkdownBlock,
  type MarkdownImageSource,
  type MarkdownList,
  type TableAlign,
} from './markdown-blocks';

export type RenderMarkdownDocxInput = {
  title: string;
  markdown: string;
  /** Images referenced as `![alt](asset:{id})`, keyed by asset id. */
  images?: ChatDocumentImages;
  author?: string;
};

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};
const REL_TYPE = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
};

const LATIN_FONT = 'Calibri';
const EAST_ASIA_FONT = 'Microsoft YaHei';
const CODE_FONT = 'Consolas';

/**
 * Concatenate XML fragments. Do not join template literals with `+` in this file:
 * the SWC minifier used by `next build` (Next 16.1.2) drops literal text between
 * folded template literals (`${PAGE.height}"/>` + `<w:pgMar ...` lost `"/>`).
 * scripts/maintenance/verify-chat-artifacts.mjs checks the minified renderer.
 */
function xml(...parts: string[]): string {
  return parts.join('');
}

const PAGE = { width: 11906, height: 16838, margin: 1304 } as const;
const TEXT_WIDTH_TWIPS = PAGE.width - PAGE.margin * 2;
const EMU_PER_PX = 9525;
const MAX_IMAGE_WIDTH_EMU = Math.round((TEXT_WIDTH_TWIPS / 1440) * 914400);
const MAX_IMAGE_HEIGHT_EMU = 8 * 914400;
const BULLET_ABSTRACT_ID = 1;
const ORDERED_ABSTRACT_ID = 2;

// Characters that are not allowed in XML 1.0 documents.
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  size?: number;
  hyperlink?: boolean;
};

function runProperties(style: RunStyle): string {
  const parts: string[] = [];
  if (style.hyperlink) parts.push('<w:rStyle w:val="Hyperlink"/>');
  if (style.code) {
    parts.push(
      `<w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:eastAsia="${EAST_ASIA_FONT}" w:cs="${CODE_FONT}"/>`,
    );
  }
  if (style.bold) parts.push('<w:b/><w:bCs/>');
  if (style.italic) parts.push('<w:i/><w:iCs/>');
  if (style.strike) parts.push('<w:strike/>');
  if (style.color) parts.push(`<w:color w:val="${style.color}"/>`);
  if (style.size) parts.push(`<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>`);
  if (style.code) parts.push('<w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/>');
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function textRun(text: string, style: RunStyle = {}): string {
  if (!text) return '';
  const props = runProperties(style);
  const segments = text.split('\t');
  const content = segments
    .map(
      (segment, index) =>
        (index > 0 ? '<w:tab/>' : '') +
        (segment ? `<w:t xml:space="preserve">${escapeXml(segment)}</w:t>` : ''),
    )
    .join('');
  return `<w:r>${props}${content}</w:r>`;
}

const MATH_RUN_PROPERTIES = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="${EAST_ASIA_FONT}" w:cs="Cambria Math"/></w:rPr>`;

/**
 * The shared OMML engine emits DrawingML run properties (`a:rPr`) because it
 * was written for PowerPoint; WordprocessingML expects `w:rPr` inside `m:r`.
 */
export function ommlForWord(omml: string): string | null {
  const converted = omml
    .replace(/<a:rPr\b[^>]*\/>/g, MATH_RUN_PROPERTIES)
    .replace(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/g, MATH_RUN_PROPERTIES)
    .replace(INVALID_XML_CHARS, '');
  if (/<a:|<\/a:/.test(converted)) return null;
  if (!/^<m:oMath[\s>]/.test(converted.trim())) return null;
  return converted.trim();
}

function latexToWordMath(latex: string): string | null {
  try {
    const omml = latexToOmml(latex);
    return omml ? ommlForWord(omml) : null;
  } catch {
    return null;
  }
}

type ListInstance = { numId: number; abstractId: number; level: 0 | 1; start: number };
type MediaEntry = { name: string; data: Buffer };
type Relationship = { id: string; type: string; target: string; external?: boolean };

type PreparedImage = { data: Buffer; extension: 'png' | 'jpeg'; width: number; height: number };

async function prepareImage(image: ChatDocumentImage): Promise<PreparedImage | null> {
  try {
    const sharp = (await import('sharp')).default;
    const pipeline = sharp(image.buffer, { failOn: 'none' }).rotate();
    const metadata = await pipeline.metadata();
    const isJpeg = metadata.format === 'jpeg';
    const isPng = metadata.format === 'png';
    const data = isJpeg || isPng ? image.buffer : await pipeline.png().toBuffer();
    const width = metadata.autoOrient?.width ?? metadata.width ?? image.width ?? 800;
    const height = metadata.autoOrient?.height ?? metadata.height ?? image.height ?? 600;
    return { data, extension: isJpeg ? 'jpeg' : 'png', width, height };
  } catch {
    return null;
  }
}

function decodeImageSource(
  source: MarkdownImageSource,
  images: ChatDocumentImages | undefined,
): ChatDocumentImage | null {
  if (source.kind === 'asset') return images?.[source.assetId] ?? null;
  if (source.kind === 'data') {
    try {
      return {
        buffer: Buffer.from(source.base64.replace(/\s+/g, ''), 'base64'),
        mimeType: source.mimeType,
      };
    } catch {
      return null;
    }
  }
  // Remote URLs are never fetched while rendering (no SSRF from documents).
  return null;
}

function columnWeights(header: InlineNode[][], rows: InlineNode[][][]): number[] {
  const textWeight = (nodes: InlineNode[]) =>
    nodes.reduce((total, node) => {
      if (node.type === 'break') return total;
      const text = node.type === 'text' ? node.text : node.latex;
      return (
        total +
        Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
      );
    }, 0);
  return header.map((cell, column) => {
    const lengths = [textWeight(cell), ...rows.map((row) => textWeight(row[column] ?? []))];
    return Math.min(60, Math.max(4, ...lengths));
  });
}

class DocxBuilder {
  readonly body: string[] = [];
  readonly relationships: Relationship[] = [
    { id: 'rId1', type: REL_TYPE.styles, target: 'styles.xml' },
    { id: 'rId2', type: REL_TYPE.numbering, target: 'numbering.xml' },
    { id: 'rId3', type: REL_TYPE.settings, target: 'settings.xml' },
    { id: 'rId4', type: REL_TYPE.footer, target: 'footer1.xml' },
  ];
  readonly media: MediaEntry[] = [];
  readonly lists: ListInstance[] = [];
  private nextRelationship = 10;
  private nextDrawingId = 1;
  private readonly hyperlinkIds = new Map<string, string>();

  constructor(private readonly images: ChatDocumentImages | undefined) {}

  private addRelationship(type: string, target: string, external = false): string {
    const id = `rId${this.nextRelationship}`;
    this.nextRelationship += 1;
    this.relationships.push({ id, type, target, external });
    return id;
  }

  private hyperlinkId(url: string): string {
    const existing = this.hyperlinkIds.get(url);
    if (existing) return existing;
    const id = this.addRelationship(REL_TYPE.hyperlink, url, true);
    this.hyperlinkIds.set(url, id);
    return id;
  }

  private newList(ordered: boolean, level: 0 | 1, start: number): number {
    const numId = this.lists.length + 1;
    this.lists.push({
      numId,
      abstractId: ordered ? ORDERED_ABSTRACT_ID : BULLET_ABSTRACT_ID,
      level,
      start: Math.max(1, start),
    });
    return numId;
  }

  inlineXml(nodes: InlineNode[], base: RunStyle = {}): string {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === 'break') {
        parts.push('<w:r><w:br/></w:r>');
        continue;
      }
      if (node.type === 'math') {
        const omml = latexToWordMath(node.latex);
        parts.push(
          omml ??
            textRun(latexToReadableText(node.latex), { ...base, italic: true, bold: node.bold }),
        );
        continue;
      }
      const style: RunStyle = {
        ...base,
        bold: base.bold || node.bold,
        italic: base.italic || node.italic,
        strike: node.strike,
        code: node.code,
        hyperlink: !!node.link,
      };
      const run = textRun(node.text, style);
      if (node.link) {
        parts.push(
          `<w:hyperlink r:id="${this.hyperlinkId(node.link)}" w:history="1">${run}</w:hyperlink>`,
        );
      } else {
        parts.push(run);
      }
    }
    return parts.join('');
  }

  paragraph(content: string, properties = ''): void {
    this.body.push(`<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`);
  }

  renderBlocks(blocks: MarkdownBlock[], options: { quote?: boolean } = {}): Promise<void> {
    return blocks.reduce(
      (previous, block) => previous.then(() => this.renderBlock(block, options)),
      Promise.resolve(),
    );
  }

  private async renderBlock(block: MarkdownBlock, options: { quote?: boolean }): Promise<void> {
    switch (block.type) {
      case 'heading':
        this.paragraph(this.inlineXml(block.inlines), `<w:pStyle w:val="Heading${block.level}"/>`);
        return;
      case 'paragraph':
        this.paragraph(
          this.inlineXml(block.inlines),
          options.quote ? '<w:pStyle w:val="Quote"/>' : '',
        );
        return;
      case 'list':
        this.renderList(block, 0);
        return;
      case 'table':
        this.renderTable(block.header, block.rows, block.align);
        return;
      case 'code':
        this.renderCode(block.text);
        return;
      case 'hr':
        this.paragraph(
          '',
          '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="120" w:after="240"/>',
        );
        return;
      case 'blockquote':
        await this.renderBlocks(block.blocks, { quote: true });
        return;
      case 'math': {
        const omml = latexToWordMath(block.latex);
        if (omml) {
          this.paragraph(`<m:oMathPara>${omml}</m:oMathPara>`, '<w:jc w:val="center"/>');
        } else {
          const lines = latexToReadableText(block.latex, { inline: false }).split('\n');
          this.paragraph(
            lines
              .map(
                (line, index) =>
                  (index ? '<w:r><w:br/></w:r>' : '') + textRun(line, { italic: true }),
              )
              .join(''),
            '<w:jc w:val="center"/>',
          );
        }
        return;
      }
      case 'image':
        await this.renderImage(block.alt, block.source);
        return;
      case 'pagebreak':
        this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        return;
    }
  }

  private renderList(list: MarkdownList, level: 0 | 1): void {
    const numId = this.newList(list.ordered, level, list.start);
    for (const item of list.items) {
      this.paragraph(
        this.inlineXml(item.inlines),
        `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr><w:contextualSpacing/>`,
      );
      if (item.children?.items.length) this.renderList(item.children, 1);
    }
  }

  private renderTable(header: InlineNode[][], rows: InlineNode[][][], align: TableAlign[]): void {
    const weights = columnWeights(header, rows);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const widths = weights.map((weight) => Math.round((TEXT_WIDTH_TWIPS * weight) / totalWeight));
    const border = (side: string) =>
      `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`;
    const cell = (nodes: InlineNode[], column: number, isHeader: boolean) => {
      const jc = align[column] === 'center' ? 'center' : align[column] === 'right' ? 'right' : '';
      const pPr = `<w:pStyle w:val="TableText"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}`;
      const shading = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF7"/>' : '';
      const content = this.inlineXml(nodes, isHeader ? { bold: true } : {});
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/>${shading}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p></w:tc>`;
    };
    const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header
      .map((nodes, column) => cell(nodes, column, true))
      .join('')}</w:tr>`;
    const bodyRows = rows
      .map(
        (row) =>
          `<w:tr><w:trPr><w:cantSplit/></w:trPr>${header
            .map((_, column) => cell(row[column] ?? [], column, false))
            .join('')}</w:tr>`,
      )
      .join('');
    this.body.push(
      `<w:tbl><w:tblPr><w:tblStyle w:val="SyntaraTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${[
        'top',
        'left',
        'bottom',
        'right',
        'insideH',
        'insideV',
      ]
        .map(border)
        .join(
          '',
        )}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths
        .map((width) => `<w:gridCol w:w="${width}"/>`)
        .join('')}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>`,
    );
    // Word requires a paragraph between adjacent tables and after a final table.
    this.paragraph('', '<w:spacing w:before="0" w:after="60"/>');
  }

  private renderCode(text: string): void {
    const lines = text.replace(/\s+$/, '').split('\n');
    lines.forEach((line) => {
      this.paragraph(textRun(line || ' ', {}), '<w:pStyle w:val="CodeBlock"/>');
    });
  }

  private async renderImage(alt: string, source: MarkdownImageSource): Promise<void> {
    const raw = decodeImageSource(source, this.images);
    const prepared = raw ? await prepareImage(raw) : null;
    if (!prepared) {
      this.paragraph(
        textRun(`[图片${alt ? `：${alt}` : ''}]`, { italic: true, color: '808080' }),
        '<w:jc w:val="center"/>',
      );
      return;
    }
    const index = this.media.length + 1;
    const name = `image${index}.${prepared.extension === 'jpeg' ? 'jpeg' : 'png'}`;
    this.media.push({ name, data: prepared.data });
    const relationshipId = this.addRelationship(REL_TYPE.image, `media/${name}`);
    let cx = prepared.width * EMU_PER_PX;
    let cy = prepared.height * EMU_PER_PX;
    const scale = Math.min(1, MAX_IMAGE_WIDTH_EMU / cx, MAX_IMAGE_HEIGHT_EMU / cy);
    cx = Math.max(1, Math.round(cx * scale));
    cy = Math.max(1, Math.round(cy * scale));
    const id = this.nextDrawingId;
    this.nextDrawingId += 1;
    const description = escapeXml(alt || name);
    const drawing = xml(
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`,
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`,
      `<wp:docPr id="${id}" name="Picture ${id}" descr="${description}"/>`,
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`,
      `<a:graphic><a:graphicData uri="${NS.pic}"><pic:pic>`,
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`,
      `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`,
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
    );
    this.paragraph(
      drawing,
      '<w:keepNext/><w:spacing w:before="120" w:after="60"/><w:jc w:val="center"/>',
    );
    if (alt) this.paragraph(textRun(alt, {}), '<w:pStyle w:val="Caption"/>');
  }
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function fonts(eastAsia = EAST_ASIA_FONT, latin = LATIN_FONT): string {
  return `<w:rFonts w:ascii="${latin}" w:hAnsi="${latin}" w:eastAsia="${eastAsia}" w:cs="${latin}"/>`;
}

function headingStyle(level: 1 | 2 | 3, size: number, color: string, before: number): string {
  return xml(
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>`,
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`,
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>`,
    `<w:rPr>${fonts()}<w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`,
  );
}

function stylesXml(): string {
  return xml(
    XML_HEADER,
    `<w:styles xmlns:w="${NS.w}">`,
    `<w:docDefaults><w:rPrDefault><w:rPr>${fonts()}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`,
    `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`,
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`,
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`,
    `<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="2F5496"/></w:pBdr><w:spacing w:before="0" w:after="300"/><w:jc w:val="left"/></w:pPr>`,
    `<w:rPr>${fonts()}<w:b/><w:bCs/><w:color w:val="1F2937"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>`,
    headingStyle(1, 32, '1F3864', 360),
    headingStyle(2, 28, '2F5496', 300),
    headingStyle(3, 24, '2F5496', 240),
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:jc w:val="left"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>`,
    `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="A5B4CB"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F5F7FA"/><w:ind w:left="284" w:right="284"/></w:pPr>`,
    `<w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/>`,
    `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="170" w:right="170"/><w:contextualSpacing/><w:jc w:val="left"/></w:pPr>`,
    `<w:rPr>${fonts(EAST_ASIA_FONT, CODE_FONT)}<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="808080"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>`,
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`,
    `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`,
    `<w:style w:type="table" w:styleId="SyntaraTable"><w:name w:val="Syntara Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>`,
    `<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders></w:tblPr>`,
    `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E8EEF7"/></w:tcPr></w:tblStylePr></w:style>`,
    `</w:styles>`,
  );
}

function levelXml(
  level: number,
  format: string,
  text: string,
  start: number,
  indent: number,
  font?: string,
): string {
  return xml(
    `<w:lvl w:ilvl="${level}"><w:start w:val="${start}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="left"/>`,
    `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>`,
    font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : '',
    `</w:lvl>`,
  );
}

function numberingXml(lists: ListInstance[]): string {
  const bullet = xml(
    `<w:abstractNum w:abstractNumId="${BULLET_ABSTRACT_ID}"><w:multiLevelType w:val="hybridMultilevel"/>`,
    levelXml(0, 'bullet', '•', 1, 720, 'Arial'),
    levelXml(1, 'bullet', '◦', 1, 1440, 'Arial'),
    `</w:abstractNum>`,
  );
  const ordered = xml(
    `<w:abstractNum w:abstractNumId="${ORDERED_ABSTRACT_ID}"><w:multiLevelType w:val="hybridMultilevel"/>`,
    levelXml(0, 'decimal', '%1.', 1, 720),
    levelXml(1, 'lowerLetter', '%2)', 1, 1440),
    `</w:abstractNum>`,
  );
  const instances = lists
    .map((list) =>
      xml(
        `<w:num w:numId="${list.numId}"><w:abstractNumId w:val="${list.abstractId}"/>`,
        `<w:lvlOverride w:ilvl="${list.level}"><w:startOverride w:val="${list.start}"/></w:lvlOverride></w:num>`,
      ),
    )
    .join('');
  return xml(
    XML_HEADER,
    `<w:numbering xmlns:w="${NS.w}">${bullet}${ordered}${instances}</w:numbering>`,
  );
}

function settingsXml(): string {
  return xml(
    XML_HEADER,
    `<w:settings xmlns:w="${NS.w}" xmlns:m="${NS.m}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/>`,
    `<w:characterSpacingControl w:val="compressPunctuation"/>`,
    `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>`,
    `<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:defJc m:val="centerGroup"/></m:mathPr>`,
    `</w:settings>`,
  );
}

function footerXml(): string {
  return xml(
    XML_HEADER,
    `<w:ftr xmlns:w="${NS.w}" xmlns:r="${NS.r}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>`,
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>`,
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`,
    `</w:p></w:ftr>`,
  );
}

function coreXml(title: string, author: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return xml(
    XML_HEADER,
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `<dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author)}</dc:creator><cp:lastModifiedBy>${escapeXml(author)}</cp:lastModifiedBy>`,
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`,
    `</cp:coreProperties>`,
  );
}

function appXml(): string {
  return (
    XML_HEADER +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Syntara</Application><DocSecurity>0</DocSecurity></Properties>`
  );
}

function contentTypesXml(): string {
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return xml(
    XML_HEADER,
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    `<Default Extension="png" ContentType="image/png"/>`,
    `<Default Extension="jpeg" ContentType="image/jpeg"/>`,
    `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>`,
    `<Override PartName="/word/numbering.xml" ContentType="${main}.numbering+xml"/>`,
    `<Override PartName="/word/settings.xml" ContentType="${main}.settings+xml"/>`,
    `<Override PartName="/word/footer1.xml" ContentType="${main}.footer+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
    `</Types>`,
  );
}

function packageRelsXml(): string {
  return xml(
    XML_HEADER,
    `<Relationships xmlns="${NS.rel}">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`,
    `</Relationships>`,
  );
}

function documentRelsXml(relationships: Relationship[]): string {
  return xml(
    XML_HEADER,
    `<Relationships xmlns="${NS.rel}">`,
    relationships
      .map(
        (rel) =>
          `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`,
      )
      .join(''),
    `</Relationships>`,
  );
}

function documentXml(body: string[]): string {
  const sectPr = xml(
    `<w:sectPr><w:footerReference w:type="default" r:id="rId4"/>`,
    `<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>`,
    `<w:pgMar w:top="1304" w:right="${PAGE.margin}" w:bottom="1304" w:left="${PAGE.margin}" w:header="708" w:footer="567" w:gutter="0"/>`,
    `<w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr>`,
  );
  return xml(
    XML_HEADER,
    `<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:m="${NS.m}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}">`,
    `<w:body>${body.join('')}${sectPr}</w:body></w:document>`,
  );
}

/** Render chat Markdown into a .docx file. */
export async function renderMarkdownToDocx(input: RenderMarkdownDocxInput): Promise<Buffer> {
  const parsed = extractDocumentTitle(input.title.trim(), parseMarkdownBlocks(input.markdown));
  const title = parsed.title || '文档';
  const builder = new DocxBuilder(input.images);
  builder.paragraph(textRun(title), '<w:pStyle w:val="Title"/>');
  await builder.renderBlocks(parsed.blocks);

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml());
  zip.file('_rels/.rels', packageRelsXml());
  zip.file('docProps/core.xml', coreXml(title, input.author || 'Syntara'));
  zip.file('docProps/app.xml', appXml());
  zip.file('word/document.xml', documentXml(builder.body));
  zip.file('word/_rels/document.xml.rels', documentRelsXml(builder.relationships));
  zip.file('word/styles.xml', stylesXml());
  zip.file('word/numbering.xml', numberingXml(builder.lists));
  zip.file('word/settings.xml', settingsXml());
  zip.file('word/footer1.xml', footerXml());
  for (const entry of builder.media) zip.file(`word/media/${entry.name}`, entry.data);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  // Never hand out a package Word cannot open; the tool reports this as a failure.
  await assertValidDocxPackage(buffer);
  return buffer;
}
