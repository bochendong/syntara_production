/**
 * Convert LaTeX math into a compact, readable linear form for renderers that
 * cannot typeset math (the canvas PDF renderer, and the DOCX fallback when
 * OMML conversion fails).
 *
 * `latexToMathLines` keeps superscripts/subscripts as positioned runs so the
 * PDF renderer can draw them raised/lowered; `latexToReadableText` flattens
 * them into Unicode super/subscripts where possible (x^2 → x², a_1 → a₁).
 */

export type MathRun = { text: string; script?: 'sup' | 'sub' };

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  leq: '≤',
  le: '≤',
  leqslant: '≤',
  geq: '≥',
  ge: '≥',
  geqslant: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  cong: '≅',
  sim: '∼',
  simeq: '≃',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  times: '×',
  div: '÷',
  cdot: '·',
  ast: '∗',
  star: '⋆',
  pm: '±',
  mp: '∓',
  circ: '∘',
  bullet: '•',
  oplus: '⊕',
  otimes: '⊗',
  infty: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  partial: '∂',
  nabla: '∇',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  in: '∈',
  notin: '∉',
  ni: '∋',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  emptyset: '∅',
  varnothing: '∅',
  neg: '¬',
  lnot: '¬',
  land: '∧',
  wedge: '∧',
  lor: '∨',
  vee: '∨',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  gets: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  iff: '⇔',
  implies: '⇒',
  leftrightarrow: '↔',
  longrightarrow: '⟶',
  Longrightarrow: '⟹',
  mapsto: '↦',
  uparrow: '↑',
  downarrow: '↓',
  angle: '∠',
  triangle: '△',
  perp: '⊥',
  parallel: '∥',
  degree: '°',
  prime: '′',
  ldots: '…',
  dots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  therefore: '∴',
  because: '∵',
  ell: 'ℓ',
  hbar: 'ℏ',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  mid: '|',
  vert: '|',
  Vert: '‖',
  lvert: '|',
  rvert: '|',
  lVert: '‖',
  rVert: '‖',
  langle: '⟨',
  rangle: '⟩',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  lbrace: '{',
  rbrace: '}',
  backslash: '\\',
  square: '□',
  Box: '□',
  checkmark: '✓',
  quad: '  ',
  qquad: '    ',
  ',': ' ',
  ';': ' ',
  ':': ' ',
  '>': ' ',
  '!': '',
  ' ': ' ',
  '{': '{',
  '}': '}',
  '%': '%',
  $: '$',
  '&': '&',
  _: '_',
  '#': '#',
  '|': '‖',
  colon: ':',
  cdotp: '·',
  percent: '%',
};

const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'log',
  'ln',
  'lg',
  'exp',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'gcd',
  'deg',
  'dim',
  'ker',
  'arg',
  'Pr',
  'mod',
  'bmod',
]);

const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ' };

const DROP_COMMANDS = new Set([
  'left',
  'right',
  'big',
  'Big',
  'bigg',
  'Bigg',
  'bigl',
  'bigr',
  'Bigl',
  'Bigr',
  'biggl',
  'biggr',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'limits',
  'nolimits',
  'middle',
  'nonumber',
  'notag',
  'label',
  'tag',
]);

const TEXT_COMMANDS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'mathtt',
  'operatorname',
  'boldsymbol',
  'bm',
  'mbox',
  'textup',
  'mathcal',
  'mathscr',
  'mathfrak',
  'emph',
  'textnormal',
  'hbox',
  'boxed',
  'underline',
  'cancel',
  'pmb',
]);

const ACCENTS: Record<string, { mark: string; label: string }> = {
  overline: { mark: '̄', label: 'bar' },
  bar: { mark: '̄', label: 'bar' },
  hat: { mark: '̂', label: 'hat' },
  widehat: { mark: '̂', label: 'hat' },
  tilde: { mark: '̃', label: 'tilde' },
  widetilde: { mark: '̃', label: 'tilde' },
  dot: { mark: '̇', label: 'dot' },
  ddot: { mark: '̈', label: 'ddot' },
  vec: { mark: '⃗', label: 'vec' },
  overrightarrow: { mark: '⃗', label: 'vec' },
};

const RELATIONS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '→', '⇒', '⇔', '⟹']);

type Token = {
  kind: 'cmd' | 'char' | 'space' | 'open' | 'close' | 'sup' | 'sub' | 'amp' | 'newline';
  value: string;
};

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < latex.length) {
    const char = latex[index];
    if (char === '\\') {
      if (latex[index + 1] === '\\') {
        tokens.push({ kind: 'newline', value: '\\\\' });
        index += 2;
        continue;
      }
      const name = /^[a-zA-Z]+/.exec(latex.slice(index + 1));
      if (name) {
        tokens.push({ kind: 'cmd', value: name[0] });
        index += 1 + name[0].length;
        while (latex[index] === ' ') index += 1; // spaces after a control word
        continue;
      }
      if (index + 1 < latex.length) {
        tokens.push({ kind: 'cmd', value: latex[index + 1] });
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === '{') tokens.push({ kind: 'open', value: char });
    else if (char === '}') tokens.push({ kind: 'close', value: char });
    else if (char === '^') tokens.push({ kind: 'sup', value: char });
    else if (char === '_') tokens.push({ kind: 'sub', value: char });
    else if (char === '&') tokens.push({ kind: 'amp', value: char });
    else if (char === '~') tokens.push({ kind: 'char', value: ' ' });
    else if (char === "'") tokens.push({ kind: 'char', value: '′' });
    else if (/\s/.test(char)) tokens.push({ kind: 'space', value: ' ' });
    else tokens.push({ kind: 'char', value: char });
    index += 1;
  }
  return tokens;
}

function runsText(runs: MathRun[]): string {
  return runs.map((run) => run.text).join('');
}

function joinRows(rows: MathRun[][], separator: string): MathRun[] {
  const joined: MathRun[] = [];
  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) joined.push({ text: separator });
    joined.push(...row);
  });
  return joined;
}

function flatten(lines: MathRun[][]): MathRun[] {
  return joinRows(lines, '; ');
}

function wrapIfComplex(runs: MathRun[]): MathRun[] {
  const text = runsText(runs).trim();
  if (!text) return runs;
  const hasScript = runs.some((run) => run.script);
  if (!hasScript && /^(?:[\p{N}.]+|\p{L}[′\p{M}]*|\([^()]*\)|√[\p{L}\p{N}]+)$/u.test(text)) {
    return runs;
  }
  // A single base with one script (x², aₙ) stays bare.
  if (
    runs.length === 2 &&
    !runs[0].script &&
    runs[1].script &&
    /^(?:\p{L}|[\p{N}.]+)$/u.test(runs[0].text)
  ) {
    return runs;
  }
  return [{ text: '(' }, ...runs, { text: ')' }];
}

class Converter {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  /** Parse until the end (or a closing brace when `stopAtClose`); returns lines of runs. */
  parseSequence(stopAtClose: boolean, inline: boolean): MathRun[][] {
    const lines: MathRun[][] = [[]];
    // A bare fraction like 1/2 is wrapped in parentheses when something
    // multiplies it directly ("(1/2)x", "2(a/b)").
    let fraction: { line: MathRun[]; start: number; end: number } | null = null;
    const wrapFraction = () => {
      if (!fraction) return;
      fraction.line.splice(fraction.end, 0, { text: ')' });
      fraction.line.splice(fraction.start, 0, { text: '(' });
      fraction = null;
    };
    const push = (runs: MathRun[]) => {
      const line = lines[lines.length - 1];
      const first = runs[0]?.text ?? '';
      if (fraction && fraction.line === line && /^[\p{L}\p{N}(√]/u.test(first)) wrapFraction();
      fraction = null;
      line.push(...runs);
    };
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (token.kind === 'space') {
        this.index += 1;
        continue;
      }
      if (token.kind === 'close') {
        this.index += 1;
        if (stopAtClose) return lines;
        continue;
      }
      if (token.kind === 'newline') {
        this.index += 1;
        this.readOptionalArgument(); // \\[2pt]
        if (inline) push([{ text: '; ' }]);
        else lines.push([]);
        continue;
      }
      if (token.kind === 'amp') {
        this.index += 1;
        push([{ text: ' ' }]);
        continue;
      }
      if (token.kind === 'sup' || token.kind === 'sub') {
        this.index += 1;
        push(this.scriptRuns(token.kind));
        continue;
      }
      if (token.kind === 'cmd' && token.value === 'end') return lines;
      const isFraction = token.kind === 'cmd' && /^[dtc]?frac$/.test(token.value);
      const atom = this.parseAtom(inline);
      if (!inline && atom.length > 1) {
        push(atom[0]);
        for (const extra of atom.slice(1)) lines.push([...extra]);
        continue;
      }
      const runs = flatten(atom);
      const line = lines[lines.length - 1];
      const previous = runsText(line).slice(-1);
      push(runs);
      if (isFraction) {
        const start = line.length - runs.length;
        fraction = { line, start, end: line.length };
        if (/[\p{L}\p{N})]/u.test(previous)) wrapFraction();
      }
    }
    return lines;
  }

  private scriptRuns(kind: 'sup' | 'sub'): MathRun[] {
    const text = runsText(flatten(this.parseArgument())).trim();
    if (kind === 'sup' && (text === '∘' || text === '°')) return [{ text: '°' }];
    if (kind === 'sup' && /^′+$/.test(text)) return [{ text }];
    return text ? [{ text, script: kind }] : [];
  }

  private readOptionalArgument(): string {
    const token = this.tokens[this.index];
    if (token?.kind !== 'char' || token.value !== '[') return '';
    let depth = 0;
    let value = '';
    for (let index = this.index; index < this.tokens.length; index += 1) {
      const current = this.tokens[index];
      if (current.kind === 'char' && current.value === '[') depth += 1;
      if (current.kind === 'char' && current.value === ']') {
        depth -= 1;
        if (depth === 0) {
          this.index = index + 1;
          return value.slice(1);
        }
      }
      value += current.kind === 'cmd' ? `\\${current.value}` : current.value;
    }
    return '';
  }

  /** One argument: a braced group or a single token. */
  parseArgument(): MathRun[][] {
    while (this.tokens[this.index]?.kind === 'space') this.index += 1;
    const token = this.tokens[this.index];
    if (!token || token.kind === 'close') return [[]];
    if (token.kind === 'open') {
      this.index += 1;
      return this.parseSequence(true, true);
    }
    return [flatten(this.parseAtom(true))];
  }

  /** Read a braced group verbatim (\text{}, environment names, colors). */
  private rawGroupText(): string {
    while (this.tokens[this.index]?.kind === 'space') this.index += 1;
    const token = this.tokens[this.index];
    if (!token) return '';
    if (token.kind !== 'open') {
      this.index += 1;
      return token.kind === 'cmd' ? `\\${token.value}` : token.value;
    }
    let depth = 0;
    let value = '';
    for (; this.index < this.tokens.length; this.index += 1) {
      const current = this.tokens[this.index];
      if (current.kind === 'open') {
        depth += 1;
        if (depth === 1) continue;
      }
      if (current.kind === 'close') {
        depth -= 1;
        if (depth === 0) {
          this.index += 1;
          return value;
        }
      }
      if (current.kind === 'cmd')
        value += /^[a-zA-Z]+$/.test(current.value) ? `\\${current.value} ` : current.value;
      else value += current.value;
    }
    return value;
  }

  parseAtom(inline: boolean): MathRun[][] {
    const token = this.tokens[this.index];
    this.index += 1;
    if (token.kind === 'open') return this.parseSequence(true, inline);
    if (token.kind === 'char') return [[{ text: token.value }]];
    if (token.kind !== 'cmd') return [[]];
    const name = token.value;

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const numerator = flatten(this.parseArgument());
      const denominator = flatten(this.parseArgument());
      return [[...wrapIfComplex(numerator), { text: '/' }, ...wrapIfComplex(denominator)]];
    }
    if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
      const n = flatten(this.parseArgument());
      const k = flatten(this.parseArgument());
      return [[{ text: 'C(' }, ...n, { text: ', ' }, ...k, { text: ')' }]];
    }
    if (name === 'sqrt') {
      const degree = this.readOptionalArgument();
      const radicand = flatten(this.parseArgument());
      const prefix: MathRun[] = degree ? [{ text: degree, script: 'sup' }] : [];
      return [[...prefix, { text: '√' }, ...wrapIfComplex(radicand)]];
    }
    if (TEXT_COMMANDS.has(name)) {
      if (name.startsWith('text') || name === 'mbox' || name === 'hbox') {
        return [[{ text: this.rawGroupText().replace(/\\([{}%$&#_])/g, '$1') }]];
      }
      return [flatten(this.parseArgument())];
    }
    if (name === 'mathbb') {
      const inner = this.rawGroupText();
      return [
        [
          {
            text: Array.from(inner)
              .map((char) => BLACKBOARD[char] ?? char)
              .join(''),
          },
        ],
      ];
    }
    const accent = ACCENTS[name];
    if (accent) {
      const inner = flatten(this.parseArgument());
      const text = runsText(inner);
      if (Array.from(text).length === 1) return [[{ text: text + accent.mark }]];
      return [[{ text: `${accent.label}(` }, ...inner, { text: ')' }]];
    }
    if (name === 'begin') {
      const environment = this.rawGroupText().trim().replace(/\*$/, '');
      if (/^(?:array|tabular)$/.test(environment)) this.rawGroupText(); // column spec
      return this.parseEnvironment(environment, inline);
    }
    if (name === 'end') {
      this.rawGroupText();
      return [[]];
    }
    if (name === 'not') {
      const text = runsText(flatten(this.parseArgument()));
      if (text === '=') return [[{ text: '≠' }]];
      if (text === '∈') return [[{ text: '∉' }]];
      return [[{ text: `¬${text}` }]];
    }
    if (name === 'pmod') {
      return [[{ text: ' (mod ' }, ...flatten(this.parseArgument()), { text: ')' }]];
    }
    if (name === 'stackrel' || name === 'overset' || name === 'underset') {
      this.parseArgument();
      return [flatten(this.parseArgument())];
    }
    if (name === 'color') {
      this.rawGroupText();
      return [[]];
    }
    if (name === 'textcolor') {
      this.rawGroupText();
      return [flatten(this.parseArgument())];
    }
    if (name === 'hspace' || name === 'vspace' || name === 'phantom') {
      this.rawGroupText();
      return [[{ text: ' ' }]];
    }
    if (DROP_COMMANDS.has(name)) {
      if (name === 'label' || name === 'tag') this.rawGroupText();
      const next = this.tokens[this.index];
      if ((name === 'left' || name === 'right') && next?.kind === 'char' && next.value === '.') {
        this.index += 1;
      }
      return [[]];
    }
    if (FUNCTIONS.has(name)) return [[{ text: name === 'bmod' ? ' mod ' : `${name} ` }]];
    if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) return [[{ text: SYMBOLS[name] }]];
    return [[{ text: name }]];
  }

  private parseEnvironment(environment: string, inline: boolean): MathRun[][] {
    const isMatrix = /matrix|array/.test(environment);
    const rows: MathRun[][] = [[]];
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (token.kind === 'cmd' && token.value === 'end') {
        this.index += 1;
        this.rawGroupText();
        break;
      }
      if (token.kind === 'newline') {
        this.index += 1;
        this.readOptionalArgument();
        rows.push([]);
        continue;
      }
      if (token.kind === 'amp') {
        this.index += 1;
        rows[rows.length - 1].push({ text: isMatrix || environment === 'cases' ? ', ' : ' ' });
        continue;
      }
      if (token.kind === 'close' || token.kind === 'space') {
        this.index += 1;
        continue;
      }
      if (token.kind === 'sup' || token.kind === 'sub') {
        this.index += 1;
        rows[rows.length - 1].push(...this.scriptRuns(token.kind));
        continue;
      }
      rows[rows.length - 1].push(...flatten(this.parseAtom(true)));
    }
    const nonEmpty = rows.filter((row) => runsText(row).trim());
    if (/matrix/.test(environment)) {
      const open = environment.startsWith('p') ? '(' : environment.startsWith('v') ? '|' : '[';
      const close = open === '(' ? ')' : open === '[' ? ']' : open;
      return [[{ text: open }, ...joinRows(nonEmpty, '; '), { text: close }]];
    }
    if (environment === 'cases') {
      if (inline) return [[{ text: '{ ' }, ...joinRows(nonEmpty, '; '), { text: ' }' }]];
      return nonEmpty.map((row) => [{ text: '{ ' }, ...row]);
    }
    if (inline) return [joinRows(nonEmpty, '; ')];
    return nonEmpty.length ? nonEmpty : [[]];
  }
}

function normalizeRuns(runs: MathRun[]): MathRun[] {
  const merged: MathRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const text = run.script
      ? run.text
      : Array.from(run.text)
          .map((char) => (RELATIONS.has(char) ? ` ${char} ` : char))
          .join('');
    const last = merged[merged.length - 1];
    if (last && last.script === run.script) last.text += text;
    else merged.push({ text, script: run.script });
  }
  const cleaned = merged.map((run) => ({ ...run, text: run.text.replace(/\s+/g, ' ') }));
  for (let index = 1; index < cleaned.length; index += 1) {
    if (cleaned[index].script && !cleaned[index - 1].script) {
      cleaned[index - 1].text = cleaned[index - 1].text.replace(/\s+$/, '');
    }
  }
  // Separate a big operator's limits from its operand: ∑ᵢ₌₁ⁿ i, ∫₀¹ x² dx.
  for (let index = 1; index < cleaned.length - 1; index += 1) {
    const base = cleaned[index - 1];
    const next = cleaned[index + 1];
    if (
      cleaned[index].script &&
      !base.script &&
      /(?:[∑∏∫∬∭∮⋃⋂]|lim)\s*$/u.test(base.text.replace(/\s+$/, '')) &&
      (next.script ? cleaned[index + 2] && !cleaned[index + 2].script : true)
    ) {
      const target = next.script ? cleaned[index + 2] : next;
      if (!/^\s/.test(target.text)) target.text = ` ${target.text}`;
    }
  }
  const result = cleaned.filter((run) => run.text);
  if (result.length) {
    result[0].text = result[0].text.replace(/^\s+/, '');
    const last = result[result.length - 1];
    last.text = last.text.replace(/\s+$/, '');
  }
  return result.filter((run) => run.text);
}

/**
 * Convert LaTeX into lines of runs. Display math may produce several lines
 * (aligned/cases environments or `\\`); inline math always yields one line.
 */
export function latexToMathLines(latex: string, options: { inline?: boolean } = {}): MathRun[][] {
  const inline = options.inline ?? false;
  try {
    const converter = new Converter(tokenize(latex.trim()));
    const lines = converter.parseSequence(false, inline).map(normalizeRuns);
    if (inline) return [normalizeRuns(flatten(lines.filter((line) => line.length)))];
    const nonEmpty = lines.filter((line) => line.length);
    return nonEmpty.length ? nonEmpty : [[{ text: latex }]];
  } catch {
    return [[{ text: latex }]];
  }
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
  x: 'ₓ',
  i: 'ᵢ',
  j: 'ⱼ',
  n: 'ₙ',
  k: 'ₖ',
  m: 'ₘ',
};

/** Render a script run as Unicode super/subscripts, or ^x / _(…) when impossible. */
export function mathScriptToText(run: MathRun): string {
  if (!run.script) return run.text;
  const table = run.script === 'sup' ? SUPERSCRIPT : SUBSCRIPT;
  const chars = Array.from(run.text.replace(/\s+/g, ''));
  if (chars.length && chars.every((char) => char in table)) {
    return chars.map((char) => table[char]).join('');
  }
  const marker = run.script === 'sup' ? '^' : '_';
  return chars.length === 1 ? `${marker}${chars[0]}` : `${marker}(${chars.join('')})`;
}

/** Flatten LaTeX into readable Unicode text (one line for inline math). */
export function latexToReadableText(latex: string, options: { inline?: boolean } = {}): string {
  const inline = options.inline ?? true;
  return latexToMathLines(latex, { inline })
    .map((line) => line.map(mathScriptToText).join(''))
    .join('\n');
}
