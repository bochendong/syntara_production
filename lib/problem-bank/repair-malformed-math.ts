const HAN_TEXT = /[\u3400-\u9fff]/u;
const MATH_EXPRESSION = /[=^_\\<>≤≥+*/]|^[A-Za-z](?:\d+)?$|^\d+(?:\.\d+)?$/;
const DOLLAR_BEFORE_CJK_PROSE = /\$[\u3400-\u9fff]/u;

function isMathFragment(value: string): boolean {
  const trimmed = value.trim().replace(/[,.;，。；]\s*$/, '');
  return Boolean(trimmed && !HAN_TEXT.test(trimmed) && MATH_EXPRESSION.test(trimmed));
}

function repairLine(line: string): string {
  if (!line.includes('$')) return line;
  if (!/\${3,}/.test(line) && !DOLLAR_BEFORE_CJK_PROSE.test(line)) {
    return line;
  }

  const segments = line.split(/\$+/);
  let output = '';
  let previousWasMath = false;
  for (const segment of segments) {
    const raw = segment.trim();
    if (!raw) continue;
    if (!isMathFragment(raw)) {
      output += segment;
      previousWasMath = false;
      continue;
    }

    const punctuation = raw.match(/([,.;，。；])$/)?.[1] ?? '';
    const expression = punctuation ? raw.slice(0, -1).trimEnd() : raw;
    if (previousWasMath) {
      output = output.trimEnd();
      if (!/[,.;，。；]$/.test(output)) output += '、';
    } else if (HAN_TEXT.test(output.at(-1) ?? '')) output += ' ';
    output += `$${expression}$${punctuation}`;
    previousWasMath = true;
  }

  return output
    .replace(/[ \t]+([，。！？；：,.!?])/g, '$1')
    .replace(/,(?=[\u3400-\u9fff])/gu, '，')
    .replace(/,(?=\$)/g, '，')
    .replace(/\.(?=[\u3400-\u9fff])/gu, '。')
    .replace(/\.(?=\$)/g, '。')
    .replace(/(\$[^$]+\$、\$[^$]+\$)\s+(?=[\u3400-\u9fff])/gu, '$1；')
    .replace(/([：；])\s+-\s*/g, '$1\n- ')
    .replace(/\s+([：；])\s+-\s*/g, '$1\n- ')
    .replace(/([：；])\s*(?=\d+[.)]\s)/g, '$1\n')
    .replace(/。\s+(?=[\u3400-\u9fff])/gu, '。\n\n')
    .trim();
}

/** Preserve the stored question while making legacy AI-generated dollar runs readable. */
export function repairMalformedProblemMath(text: string): string {
  if (!text.includes('$')) return text;
  const parts = text.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`[^`\n]*`)/g);
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\\{1,2}\s*\$\s*(\d+(?:\.\d+)?)(?!\s*\$)/g, 'USD $1')
            .split('\n')
            .map(repairLine)
            .join('\n'),
    )
    .join('');
}
