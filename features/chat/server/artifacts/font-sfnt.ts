/**
 * Convert WOFF 1.0 fonts to plain SFNT (TrueType/OpenType) buffers.
 *
 * Skia's PDF backend embeds .woff2 faces as Type 3 fonts whose ToUnicode maps
 * lose characters, so text copied or extracted from chat PDFs came out with
 * digits and identifiers missing. Plain TrueType faces embed as CID fonts with
 * correct mappings. WOFF 1.0 is just zlib-compressed SFNT tables, so it is
 * converted here without extra dependencies.
 */
import { inflateSync } from 'node:zlib';

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'

function tagName(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 255, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255);
}

/**
 * @param dropTables Tables to omit. Dropping GSUB keeps one glyph per character:
 *   contextual substitutions (e.g. Noto's `locl`/`ccmp` digit variants, ligatures)
 *   produce glyphs without a cmap entry, which PDF text extraction cannot map back.
 */
export function woffToSfnt(woff: Buffer, dropTables: string[] = []): Buffer {
  if (woff.length < 44 || woff.readUInt32BE(0) !== WOFF_SIGNATURE) {
    throw new Error('Not a WOFF 1.0 font');
  }
  const flavor = woff.readUInt32BE(4);
  const declared = woff.readUInt16BE(12);
  const tables: Array<{ tag: number; checksum: number; data: Buffer }> = [];
  for (let index = 0; index < declared; index += 1) {
    const entry = 44 + index * 20;
    const tag = woff.readUInt32BE(entry);
    if (dropTables.includes(tagName(tag))) continue;
    const offset = woff.readUInt32BE(entry + 4);
    const compressedLength = woff.readUInt32BE(entry + 8);
    const originalLength = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compressedLength);
    const data = compressedLength < originalLength ? inflateSync(raw) : raw;
    if (data.length !== originalLength) throw new Error(`Corrupt WOFF table ${tagName(tag)}`);
    tables.push({ tag, checksum: woff.readUInt32BE(entry + 16), data });
  }
  const count = tables.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12 + 16 * count);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(count, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(count * 16 - searchRange, 10);
  const chunks: Buffer[] = [header];
  let offset = header.length;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    header.writeUInt32BE(table.tag, record);
    header.writeUInt32BE(table.checksum, record + 4);
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(table.data.length, record + 12);
    const padding = (4 - (table.data.length % 4)) % 4;
    chunks.push(table.data, Buffer.alloc(padding));
    offset += table.data.length + padding;
  });
  return Buffer.concat(chunks);
}
