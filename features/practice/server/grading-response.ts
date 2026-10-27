import { jsonrepair } from 'jsonrepair';
import { protectLatexCommandsBeforeJsonParse } from '@/lib/generation/json-repair';

export class GradingResponseError extends Error {}

/** Extract one complete object, ignoring braces inside feedback and surrounding Markdown. */
export function parseGradingJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new GradingResponseError('Grading response has no JSON object.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) {
      end = index + 1;
      break;
    }
  }
  // Do not invent closing braces or accept a truncated assessment.
  if (end < 0) throw new GradingResponseError('Grading response JSON is incomplete.');
  const candidate = protectLatexCommandsBeforeJsonParse(text.slice(start, end));
  let normalized = '';
  inString = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (char === '"') inString = !inString;
    if (inString && char === '\\') {
      const next = candidate[index + 1] ?? '';
      if (
        /["\\/bfnrt]/.test(next) ||
        (next === 'u' && /^[\da-f]{4}$/i.test(candidate.slice(index + 2, index + 6)))
      ) {
        normalized += char + next;
        index += 1;
      } else {
        // A literal LaTeX command such as \cup must survive JSON decoding.
        normalized += '\\\\';
      }
    } else if (inString && /[\n\r\t]/.test(char)) {
      normalized += JSON.stringify(char).slice(1, -1);
    } else {
      normalized += char;
    }
  }
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return JSON.parse(jsonrepair(normalized));
    } catch {
      throw new GradingResponseError('Grading response contained invalid JSON.');
    }
  }
}
