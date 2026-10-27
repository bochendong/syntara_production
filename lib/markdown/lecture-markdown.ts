/** Repair legacy lecture formatting at display time, keeping stored material unchanged. */
export function normalizeLectureMarkdownForRendering(markdown: string): string {
  let fence: { marker: string; length: number } | null = null;
  let displayMath = false;
  let htmlCode: string | null = null;

  return markdown
    .split('\n')
    .map((line) => {
      const fenceLine = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (
          fenceLine &&
          fenceLine[1][0] === fence.marker &&
          fenceLine[1].length >= fence.length &&
          line.slice(fenceLine[0].length).trim() === ''
        )
          fence = null;
        return line;
      }
      if (fenceLine) {
        fence = { marker: fenceLine[1][0], length: fenceLine[1].length };
        return line;
      }
      if (htmlCode) {
        if (new RegExp(`</${htmlCode}\\s*>`, 'i').test(line)) htmlCode = null;
        return line;
      }
      const htmlStart = /<(pre|code|script|style)\b/i.exec(line);
      if (htmlStart) {
        if (!new RegExp(`</${htmlStart[1]}\\s*>`, 'i').test(line)) htmlCode = htmlStart[1];
        return line;
      }
      if (line.trim() === '$$') {
        displayMath = !displayMath;
        return line;
      }
      if (displayMath || /^(?: {4}|\t)/.test(line)) return line;

      // remark-math treats $$...$$ on one line as inline math. Give display
      // equations their own delimiter lines so commands such as \tag work.
      const equation = /^( {0,3})\$\$([^$\r\n]+)\$\$[ \t]*\r?$/.exec(line);
      if (equation) {
        const indent = equation[1];
        return `${indent}$$\n${indent}${equation[2].trim()}\n${indent}$$`;
      }
      // Escaped asterisks may be literal teaching examples, not strong markers.
      if (/\\\*/.test(line)) return line;

      const protectedSpans: string[] = [];
      let token = '\uE000LECTURE';
      while (line.includes(token)) token += '_';
      const held = line.replace(
        /(`+).*?\1|(?<!\\)\$\$[^$\n]*\$\$|(?<!\\)\$[^$\n]+\$/g,
        (span) => `${token}${protectedSpans.push(span) - 1}\uE001`,
      );
      const repaired = held.replace(
        /(?<![\\*])\*\*(?!\*)([^*\n]+?)\*\*(?!\*)/g,
        (whole, inner: string) => {
          const body = inner.trim();
          if (!body) return whole;
          const leading = inner.match(/^[ \t]*/)?.[0] ?? '';
          const trailing = inner.match(/[ \t]*$/)?.[0] ?? '';
          return `${leading}**${body}**${trailing}`;
        },
      );
      return repaired.replace(
        new RegExp(`${token}(\\d+)\uE001`, 'g'),
        (_, index: string) => protectedSpans[Number(index)],
      );
    })
    .join('\n');
}
