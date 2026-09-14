/** Recover legacy two-column code/answer tables without changing any code whitespace.
 * GFM cannot contain fenced blocks in cells. Expand complete rows into sections;
 * incomplete/ambiguous input is left untouched rather than guessing program semantics.
 */
export function expandLegacyCodeTables(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let outerFence = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (outerFence) {
      output.push(line);
      if (new RegExp(`^\\s*${outerFence[0]}{${outerFence.length},}\\s*$`).test(line))
        outerFence = '';
      continue;
    }
    if (fence) {
      outerFence = fence[1];
      output.push(line);
      continue;
    }
    const header = line.match(/^\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*$/);
    if (!header || !/^\s*\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*$/.test(lines[i + 1] || '')) {
      output.push(line);
      continue;
    }
    let cursor = i + 2;
    const sections: string[] = [];
    while (cursor < lines.length) {
      while (!lines[cursor]?.trim() && cursor < lines.length) cursor += 1;
      const start = lines[cursor]?.match(/^\s*\|[ \t]*(`{3,}|~{3,})([A-Za-z0-9_+.-]*)[ \t]*$/);
      if (!start) break;
      const endPattern = new RegExp(
        `^[ \\t]*${start[1][0]}{${start[1].length},}[ \\t]*\\|[ \\t]*(.*?)[ \\t]*\\|[ \\t]*$`,
      );
      const code: string[] = [];
      let end = cursor + 1;
      while (end < lines.length && !endPattern.test(lines[end])) {
        code.push(lines[end]);
        end += 1;
      }
      if (end === lines.length) break;
      const answer = lines[end].match(endPattern)![1];
      sections.push(
        `**${header[1].trim()} ${sections.length + 1}**\n\n${start[1]}${start[2]}\n${code.join('\n')}\n${start[1]}\n\n${header[2].trim()}\n\n${answer}`,
      );
      cursor = end + 1;
    }
    // Never remove a header from a partially understood table.
    if (!sections.length || lines[cursor]?.trim().startsWith('|')) {
      output.push(line);
      continue;
    }
    output.push(sections.join('\n\n'));
    i = cursor - 1;
  }
  return output.join('\n');
}
