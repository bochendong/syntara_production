const CJK_TEXT_REGEX = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const EN_WORD_REGEX = /[A-Za-z]{3,}/g;

function collectStringLeaves(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStringLeaves(child, output);
    }
  }
  return output;
}

function normalizeLanguageProbeText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasUnexpectedCjkForLanguage(
  value: unknown,
  language: 'zh-CN' | 'en-US',
): boolean {
  const leaves = collectStringLeaves(value).map(normalizeLanguageProbeText).filter(Boolean);
  if (leaves.length === 0) return false;

  if (language === 'en-US') {
    return leaves.some((text) => CJK_TEXT_REGEX.test(text));
  }

  let totalCjkChars = 0;
  let englishHeavySegments = 0;
  for (const text of leaves) {
    const cjkChars = (text.match(CJK_TEXT_REGEX) || []).length;
    totalCjkChars += cjkChars;

    const enWords = text.match(EN_WORD_REGEX) || [];
    const enChars = enWords.join('').length;
    const hasCjk = cjkChars > 0;
    const looksLikeProse = enWords.length >= 4 || enChars >= 20;
    if (!hasCjk && looksLikeProse) {
      englishHeavySegments += 1;
    }
  }

  if (totalCjkChars >= 6) return false;
  return englishHeavySegments >= 2;
}
