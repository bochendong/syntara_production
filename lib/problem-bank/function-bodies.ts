/**
 * Whether a student has edited the bodies of the functions a problem asks them to design.
 * Design-recipe scoring only counts tests once a body differs from the starter's stub, so an
 * unedited stub that happens to pass some tests (e.g. `false`) earns no test credit.
 *
 * Bodies are compared after removing comments, Python docstrings and whitespace; signatures,
 * decorators and tags are not part of the body.
 */

/** Top-level forms of a Racket file, with `;` / `#| |#` / `#;` comments removed. */
function racketForms(source: string): string[] {
  const forms: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === ';') {
      while (i < source.length && source[i] !== '\n') i += 1;
      current += ' ';
      continue;
    }
    if (ch === '#' && source[i + 1] === '|') {
      const end = source.indexOf('|#', i + 2);
      i = end < 0 ? source.length : end + 1;
      current += ' ';
      continue;
    }
    if (ch === '#' && source[i + 1] === '\\') {
      // Character literal such as #\( or #\space.
      current += source.slice(i, i + 3);
      i += 2;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      current += source.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
      current += ch;
      if (depth === 0) {
        forms.push(current.trim());
        current = '';
      }
    } else if (depth > 0) {
      current += ch;
    }
  }
  return forms;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

/** name -> normalized body of each top-level `(define (name ...) body)`. */
function racketFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const form of racketForms(source)) {
    const header = form.match(/^[([]\s*define\s*[([]\s*([^\s()[\]]+)/);
    if (!header) continue;
    // Skip past the header list (define (name args ...) ...): it opens at the second bracket.
    const open = form.slice(1).search(/[([]/) + 1;
    let depth = 0;
    let end = open;
    for (; end < form.length; end += 1) {
      if (form[end] === '(' || form[end] === '[') depth += 1;
      else if (form[end] === ')' || form[end] === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.set(header[1], squash(form.slice(end + 1, -1)));
  }
  return bodies;
}

/** The line with its `#` comment removed (a `#` inside a string literal is kept). */
function withoutPythonComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/** name -> normalized body of each top-level `def name(...):`. */
function pythonFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (!header) continue;
    // The header ends at the first ':' outside brackets.
    let depth = 0;
    let row = i;
    let col = lines[i].indexOf('(');
    let rest = '';
    outer: for (; row < lines.length; row += 1, col = 0) {
      const text = withoutPythonComment(lines[row]);
      for (; col < text.length; col += 1) {
        const ch = text[col];
        if ('([{'.includes(ch)) depth += 1;
        else if (')]}'.includes(ch)) depth -= 1;
        else if (ch === ':' && depth === 0) {
          rest = text.slice(col + 1);
          break outer;
        }
      }
    }
    const body = [rest];
    let next = row + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() && !/^\s/.test(line) && !line.trim().startsWith('#')) break;
      body.push(line);
    }
    const code = body
      .join('\n')
      .replace(/^\s*(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*')/, '')
      .split('\n')
      .map(withoutPythonComment)
      .join('\n');
    bodies.set(header[1], squash(code));
    i = next - 1;
  }
  return bodies;
}

/** name -> normalized stub body the reference keeps as a comment, e.g. `# return 0  # stub`. */
function commentedStubs(language: string, reference: string): Map<string, string> {
  const stubs = new Map<string, string>();
  if (language === 'racket') {
    // ;(define (f n) false) ; stub
    for (const match of reference.matchAll(/^\s*;+\s*(\(define\s*\(.*\))\s*;+\s*stub\b/gim)) {
      for (const [name, body] of racketFunctionBodies(match[1])) stubs.set(name, body);
    }
    return stubs;
  }
  let current = '';
  for (const line of reference.split(/\r?\n/)) {
    current = line.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/)?.[1] ?? current;
    const stub = line.match(/^\s*#\s*(return\b.*?)\s*#\s*stub\b/i);
    if (current && stub) stubs.set(current, squash(stub[1]));
  }
  return stubs;
}

/**
 * True when at least one function the problem stubs (in the starter, or as the reference's
 * commented-out stub) has a body in the student's code that differs from that stub. Functions
 * without a stub, such as templates, don't count. With nothing to compare, the answer counts
 * as edited.
 */
export function designedFunctionsEdited(args: {
  language: string;
  code: string;
  starterCode?: string;
  referenceCode: string;
}): boolean {
  const bodiesOf = args.language === 'racket' ? racketFunctionBodies : pythonFunctionBodies;
  const starter = bodiesOf(args.starterCode ?? '');
  const commented = commentedStubs(args.language, args.referenceCode);
  const stubs = new Map(
    [...bodiesOf(args.referenceCode).keys()].flatMap((name) => {
      const stub = starter.get(name) ?? commented.get(name);
      return stub === undefined ? [] : [[name, stub] as const];
    }),
  );
  if (!stubs.size) return true;
  const student = bodiesOf(args.code);
  return [...stubs].some(([name, stub]) => {
    const mine = student.get(name);
    return mine !== undefined && mine !== stub;
  });
}
