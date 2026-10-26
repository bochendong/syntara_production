/** Insert a Python newline without treating colons inside strings/comments as blocks. */
export function pythonNewlineEdit(value: string, start: number, end = start) {
  const prefix = value.slice(0, start);
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const indent = prefix.slice(lineStart).match(/^[\t ]*/)?.[0] ?? '';
  let stringMarker: string | null = null;
  let comment = false;
  let codeLine = '';

  for (let i = 0; i < prefix.length; i += 1) {
    const char = prefix[i];
    if (char === '\n') {
      comment = false;
      codeLine = '';
      continue;
    }
    if (comment) continue;
    if (stringMarker) {
      if (char === '\\') {
        i += 1;
      } else if (prefix.startsWith(stringMarker, i)) {
        i += stringMarker.length - 1;
        stringMarker = null;
      }
      continue;
    }
    if (char === '#') {
      comment = true;
    } else if (char === '"' || char === "'") {
      stringMarker = prefix.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
      i += stringMarker.length - 1;
      codeLine += 's';
    } else {
      codeLine += char;
    }
  }

  const extra =
    !stringMarker && codeLine.trimEnd().endsWith(':')
      ? indent.includes('\t')
        ? '\t'
        : '    '
      : '';
  const insertion = `\n${indent}${extra}`;
  return {
    value: `${prefix}${insertion}${value.slice(end)}`,
    caret: start + insertion.length,
  };
}
