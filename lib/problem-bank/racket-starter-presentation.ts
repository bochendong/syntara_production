/** Instruction comments duplicated in the statement; program documentation stays in code. */
const TASK_INSTRUCTION =
  /^(?:Consider the following (?:PARTIAL|type comment)|For the following type comment|Below is a partial data definition|Given the data definition[\s\S]*?design a|Design a function|Please design a function|Complete the design|You (?:must|MUST|are (?:given|not permitted))|Your (?:solution|function|answer|submission|design)|This (?:problem|file|starter file)|These problems|Note that|NOTE:\s*(?:This problem|If it is reasonable|the list of student|[-*]\s*you must)|PLEASE READ|HINT:|As always, a file|Ensure that you|The function must|To receive|For full credit|For maximum credit|In this problem|First read through|THE WORK YOU NEED TO DO|PROBLEM:?$)/i;

type CommentRange = { start: number; end: number; text: string };

/** Locate standalone comments without matching comment markers inside strings or characters. */
function standaloneComments(code: string): CommentRange[] {
  const comments: CommentRange[] = [];
  let index = 0;
  while (index < code.length) {
    if (code[index] === '"') {
      index++;
      while (index < code.length) {
        if (code[index] === '\\') index += 2;
        else if (code[index++] === '"') break;
      }
    } else if (code.startsWith('#\\', index)) {
      index += 2;
      if (/[A-Za-z]/.test(code[index] ?? '')) while (/[A-Za-z]/.test(code[index] ?? '')) index++;
      else index++;
    } else if (code.startsWith('#|', index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < code.length && depth) {
        if (code.startsWith('#|', index)) {
          depth++;
          index += 2;
        } else if (code.startsWith('|#', index)) {
          depth--;
          index += 2;
        } else index++;
      }
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = code.indexOf('\n', index);
      if (
        !depth &&
        !code.slice(lineStart, start).trim() &&
        !code.slice(index, lineEnd < 0 ? code.length : lineEnd).trim()
      )
        comments.push({
          start: lineStart,
          end: lineEnd < 0 ? code.length : lineEnd + 1,
          text: code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd + 1),
        });
    } else if (code[index] === ';') {
      const start = index;
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const end = code.indexOf('\n', index);
      index = end < 0 ? code.length : end + 1;
      if (!code.slice(lineStart, start).trim())
        comments.push({ start: lineStart, end: index, text: code.slice(lineStart, index) });
    } else index++;
  }
  // A bare comment line separates paragraphs, so type comments and task prose never merge.
  const groups: CommentRange[] = [];
  for (const comment of comments) {
    const previous = groups.at(-1);
    const blank = /^\s*;+\s*$/.test(comment.text);
    if (
      !blank &&
      previous &&
      previous.end === comment.start &&
      !/^\s*;+\s*$/.test(previous.text) &&
      !previous.text.trimStart().startsWith('#|') &&
      !comment.text.trimStart().startsWith('#|')
    ) {
      previous.end = comment.end;
      previous.text += comment.text;
    } else groups.push({ ...comment });
  }
  return groups;
}

/** With knownComments, migrate only exact original comments and preserve student-written notes. */
export function cleanRacketStarterInstructions(code: string, knownComments?: readonly string[]) {
  const known = knownComments ? new Set(knownComments) : null;
  const ranges = standaloneComments(code)
    .flatMap((comment): CommentRange[] => {
      if (known) {
        if (known.has(comment.text)) return [comment];
        if (comment.text.trimStart().startsWith('#|')) return [];
        const matches: CommentRange[] = [];
        for (const text of [...known].filter(Boolean).sort((a, b) => b.length - a.length)) {
          let from = 0;
          while (from < comment.text.length) {
            const start = comment.text.indexOf(text, from);
            if (start < 0) break;
            const end = start + text.length;
            if (
              (start === 0 || comment.text[start - 1] === '\n') &&
              !matches.some(
                (range) => comment.start + start < range.end && comment.start + end > range.start,
              )
            )
              matches.push({ start: comment.start + start, end: comment.start + end, text });
            from = end;
          }
        }
        return matches;
      }
      const prose = comment.text
        .replace(/^\s*#\|/, '')
        .replace(/\|#\s*$/, '')
        .replace(/^\s*;+\s?/gm, '')
        .trim();
      return TASK_INSTRUCTION.test(prose) ? [comment] : [];
    })
    .sort((a, b) => a.start - b.start);
  let cleaned = code;
  for (const range of [...ranges].reverse())
    cleaned = cleaned.slice(0, range.start) + cleaned.slice(range.end);
  return { code: cleaned, removedComments: ranges.map((range) => range.text) };
}
