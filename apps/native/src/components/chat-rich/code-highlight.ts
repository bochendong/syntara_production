/**
 * 聊天代码块的轻量语法高亮（配色对齐 VS Code Dark Modern / Dark+）。
 * 不引第三方库：按语言给关键字表 + 注释/字符串规则，逐字符扫描出 token，再按行切开给行号用。
 */

export type CodeTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'control'
  | 'type'
  | 'function'
  | 'variable'
  | 'property'
  | 'constant'
  | 'decorator'
  | 'tag'
  | 'attr'
  | 'punct'
  | 'inserted'
  | 'deleted'
  | 'meta';

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

interface LanguageSpec {
  label: string;
  /** 蓝色：声明 / 存储类关键字（def、const、class、int…） */
  keywords?: string[];
  /** 紫色：流程控制（if、return、import…） */
  control?: string[];
  /** 青色：内置类型 */
  types?: string[];
  /** 蓝色：true / false / None 之类 */
  constants?: string[];
  /** 黄色：内置函数（不跟括号时也上色） */
  builtins?: string[];
  lineComment?: string[];
  blockComment?: [string, string];
  quotes?: string[];
  /** 三引号字符串（Python） */
  tripleQuotes?: boolean;
  /** `模板字符串` 里的 ${…} 用变量色 */
  template?: boolean;
  /** @装饰器 / 注解 */
  decorators?: boolean;
  /** $VAR（shell、php） */
  dollarVars?: boolean;
  /** 首字母大写的标识符当类型（TS、Java、C#、Rust…） */
  pascalTypes?: boolean;
  caseInsensitive?: boolean;
  mode?: 'markup' | 'css' | 'json';
}

const C_CONTROL = [
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'goto',
  'try',
  'catch',
  'finally',
  'throw',
];

const JS_SPEC: LanguageSpec = {
  label: 'JavaScript',
  keywords: [
    'const',
    'let',
    'var',
    'function',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'typeof',
    'instanceof',
    'in',
    'of',
    'delete',
    'void',
    'async',
    'static',
    'get',
    'set',
    'type',
    'interface',
    'enum',
    'implements',
    'declare',
    'readonly',
    'public',
    'private',
    'protected',
    'abstract',
    'namespace',
    'keyof',
    'as',
    'satisfies',
  ],
  control: [...C_CONTROL, 'import', 'export', 'from', 'await', 'yield'],
  types: ['string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint'],
  constants: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'", '`'],
  template: true,
  decorators: true,
  pascalTypes: true,
};

const C_SPEC: LanguageSpec = {
  label: 'C',
  keywords: [
    'struct',
    'union',
    'enum',
    'typedef',
    'static',
    'const',
    'extern',
    'sizeof',
    'volatile',
    'register',
    'inline',
    'unsigned',
    'signed',
    'auto',
  ],
  control: [...C_CONTROL, '#include', '#define', '#ifdef', '#ifndef', '#endif', '#if', '#pragma'],
  types: ['int', 'char', 'float', 'double', 'long', 'short', 'void', 'bool', 'size_t'],
  constants: ['NULL', 'true', 'false'],
  builtins: ['printf', 'scanf', 'malloc', 'free', 'strlen', 'memcpy'],
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'"],
};

const CPP_SPEC: LanguageSpec = {
  ...C_SPEC,
  label: 'C++',
  keywords: [
    ...(C_SPEC.keywords ?? []),
    'class',
    'public',
    'private',
    'protected',
    'virtual',
    'override',
    'template',
    'typename',
    'namespace',
    'using',
    'new',
    'delete',
    'this',
    'operator',
    'friend',
    'constexpr',
    'nullptr',
    'explicit',
    'noexcept',
  ],
  types: [...(C_SPEC.types ?? []), 'string', 'vector', 'map', 'set', 'pair', 'std'],
  builtins: ['cout', 'cin', 'endl', 'printf', 'make_pair', 'push_back'],
  constants: ['true', 'false', 'nullptr', 'NULL'],
  pascalTypes: true,
};

const JAVA_SPEC: LanguageSpec = {
  label: 'Java',
  keywords: [
    'class',
    'interface',
    'enum',
    'extends',
    'implements',
    'public',
    'private',
    'protected',
    'static',
    'final',
    'abstract',
    'new',
    'this',
    'super',
    'void',
    'synchronized',
    'instanceof',
    'record',
    'var',
    'throws',
  ],
  control: [...C_CONTROL, 'import', 'package'],
  types: ['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'String'],
  constants: ['true', 'false', 'null'],
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'"],
  decorators: true,
  pascalTypes: true,
};

const SPECS: Record<string, LanguageSpec> = {
  python: {
    label: 'Python',
    keywords: [
      'def',
      'class',
      'lambda',
      'global',
      'nonlocal',
      'and',
      'or',
      'not',
      'in',
      'is',
      'del',
      'async',
    ],
    control: [
      'if',
      'elif',
      'else',
      'for',
      'while',
      'break',
      'continue',
      'return',
      'try',
      'except',
      'finally',
      'raise',
      'with',
      'as',
      'import',
      'from',
      'pass',
      'yield',
      'await',
      'assert',
      'match',
      'case',
    ],
    types: [
      'int',
      'float',
      'str',
      'bool',
      'list',
      'dict',
      'set',
      'tuple',
      'bytes',
      'object',
      'type',
    ],
    constants: ['True', 'False', 'None', 'self', 'cls'],
    builtins: [
      'print',
      'len',
      'range',
      'enumerate',
      'zip',
      'map',
      'filter',
      'sorted',
      'sum',
      'min',
      'max',
      'abs',
      'input',
      'open',
      'isinstance',
      'super',
      'reversed',
      'any',
      'all',
      'round',
    ],
    lineComment: ['#'],
    quotes: ['"', "'"],
    tripleQuotes: true,
    decorators: true,
    pascalTypes: true,
  },
  javascript: JS_SPEC,
  typescript: { ...JS_SPEC, label: 'TypeScript' },
  jsx: { ...JS_SPEC, label: 'JSX' },
  tsx: { ...JS_SPEC, label: 'TSX' },
  java: JAVA_SPEC,
  kotlin: {
    ...JAVA_SPEC,
    label: 'Kotlin',
    keywords: [...(JAVA_SPEC.keywords ?? []), 'fun', 'val', 'object', 'data', 'when', 'is', 'in'],
  },
  c: C_SPEC,
  cpp: CPP_SPEC,
  csharp: {
    ...JAVA_SPEC,
    label: 'C#',
    keywords: [
      ...(JAVA_SPEC.keywords ?? []),
      'using',
      'namespace',
      'readonly',
      'struct',
      'override',
      'virtual',
      'async',
      'get',
      'set',
    ],
    control: [...C_CONTROL, 'await', 'foreach', 'in'],
    types: [...(JAVA_SPEC.types ?? []), 'string', 'bool', 'decimal', 'object'],
  },
  go: {
    label: 'Go',
    keywords: [
      'func',
      'var',
      'const',
      'type',
      'struct',
      'interface',
      'map',
      'chan',
      'package',
      'go',
      'defer',
      'range',
    ],
    control: [...C_CONTROL, 'import', 'select', 'fallthrough'],
    types: ['int', 'int64', 'float64', 'string', 'bool', 'byte', 'rune', 'error', 'any'],
    constants: ['true', 'false', 'nil', 'iota'],
    builtins: ['make', 'len', 'cap', 'append', 'panic', 'new', 'delete'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
    pascalTypes: true,
  },
  rust: {
    label: 'Rust',
    keywords: [
      'fn',
      'let',
      'mut',
      'const',
      'static',
      'struct',
      'enum',
      'impl',
      'trait',
      'pub',
      'use',
      'mod',
      'crate',
      'self',
      'Self',
      'ref',
      'move',
      'dyn',
      'where',
      'as',
      'unsafe',
      'async',
    ],
    control: [
      'if',
      'else',
      'match',
      'for',
      'while',
      'loop',
      'break',
      'continue',
      'return',
      'in',
      'await',
    ],
    types: [
      'i32',
      'i64',
      'u8',
      'u32',
      'u64',
      'usize',
      'f32',
      'f64',
      'bool',
      'char',
      'str',
      'String',
      'Vec',
      'Option',
      'Result',
    ],
    constants: ['true', 'false', 'None', 'Some', 'Ok', 'Err'],
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
    pascalTypes: true,
  },
  sql: {
    label: 'SQL',
    keywords: [
      'select',
      'from',
      'where',
      'and',
      'or',
      'not',
      'insert',
      'into',
      'values',
      'update',
      'set',
      'delete',
      'create',
      'table',
      'drop',
      'alter',
      'index',
      'primary',
      'key',
      'foreign',
      'references',
      'join',
      'left',
      'right',
      'inner',
      'outer',
      'on',
      'as',
      'group',
      'by',
      'order',
      'having',
      'limit',
      'offset',
      'distinct',
      'union',
      'all',
      'in',
      'is',
      'like',
      'between',
      'exists',
      'case',
      'when',
      'then',
      'else',
      'end',
      'asc',
      'desc',
      'with',
      'default',
    ],
    types: [
      'int',
      'integer',
      'varchar',
      'text',
      'char',
      'date',
      'timestamp',
      'boolean',
      'float',
      'decimal',
      'serial',
    ],
    constants: ['null', 'true', 'false'],
    builtins: ['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'now'],
    lineComment: ['--'],
    blockComment: ['/*', '*/'],
    quotes: ["'", '"'],
    caseInsensitive: true,
  },
  bash: {
    label: 'Shell',
    keywords: ['function', 'local', 'export', 'readonly', 'declare', 'unset'],
    control: [
      'if',
      'then',
      'else',
      'elif',
      'fi',
      'for',
      'while',
      'until',
      'do',
      'done',
      'case',
      'esac',
      'in',
      'return',
      'exit',
    ],
    builtins: [
      'echo',
      'cd',
      'ls',
      'cat',
      'grep',
      'sed',
      'awk',
      'mkdir',
      'rm',
      'cp',
      'mv',
      'git',
      'npm',
      'pnpm',
      'pip',
      'python',
      'python3',
      'node',
      'source',
      'sudo',
      'chmod',
      'curl',
      'printf',
    ],
    lineComment: ['#'],
    quotes: ['"', "'"],
    dollarVars: true,
  },
  r: {
    label: 'R',
    keywords: ['function', 'in'],
    control: ['if', 'else', 'for', 'while', 'repeat', 'break', 'next', 'return', 'library'],
    constants: ['TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN'],
    lineComment: ['#'],
    quotes: ['"', "'"],
  },
  matlab: {
    label: 'MATLAB',
    keywords: ['function', 'end', 'global', 'persistent'],
    control: [
      'if',
      'elseif',
      'else',
      'for',
      'while',
      'switch',
      'case',
      'otherwise',
      'break',
      'continue',
      'return',
      'try',
      'catch',
    ],
    constants: ['true', 'false', 'pi', 'inf', 'NaN'],
    builtins: ['disp', 'zeros', 'ones', 'size', 'length', 'plot', 'fprintf'],
    lineComment: ['%'],
    quotes: ["'", '"'],
  },
  haskell: {
    label: 'Haskell',
    keywords: [
      'data',
      'type',
      'newtype',
      'class',
      'instance',
      'deriving',
      'where',
      'let',
      'in',
      'module',
    ],
    control: ['if', 'then', 'else', 'case', 'of', 'do', 'import'],
    constants: ['True', 'False', 'Nothing', 'Just'],
    lineComment: ['--'],
    blockComment: ['{-', '-}'],
    quotes: ['"'],
    pascalTypes: true,
  },
  json: { label: 'JSON', constants: ['true', 'false', 'null'], quotes: ['"'], mode: 'json' },
  yaml: {
    label: 'YAML',
    constants: ['true', 'false', 'null', 'yes', 'no'],
    lineComment: ['#'],
    quotes: ['"', "'"],
    mode: 'json',
  },
  html: { label: 'HTML', mode: 'markup' },
  xml: { label: 'XML', mode: 'markup' },
  css: { label: 'CSS', blockComment: ['/*', '*/'], quotes: ['"', "'"], mode: 'css' },
};

const ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  golang: 'go',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  terminal: 'bash',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  yml: 'yaml',
  htm: 'html',
  vue: 'html',
  svg: 'xml',
  scss: 'css',
  less: 'css',
  hs: 'haskell',
  m: 'matlab',
  octave: 'matlab',
};

const PLAIN_LABELS: Record<string, string> = {
  text: '纯文本',
  txt: '纯文本',
  plaintext: '纯文本',
  markdown: 'Markdown',
  md: 'Markdown',
  diff: 'Diff',
  latex: 'LaTeX',
  tex: 'LaTeX',
};

function resolveLanguage(language: string): { id: string; spec?: LanguageSpec } {
  const raw = language.trim().toLowerCase();
  const id = ALIASES[raw] ?? raw;
  return { id, spec: SPECS[id] };
}

/** 顶栏显示的语言名；没写语言就叫「代码」。 */
export function codeLanguageLabel(language: string): string {
  const raw = language.trim().toLowerCase();
  if (!raw) return '代码';
  const { spec } = resolveLanguage(raw);
  return spec?.label ?? PLAIN_LABELS[raw] ?? language.trim();
}

/** 语言标签前那颗小点的颜色（参考各语言在 VS Code 文件图标里的主色）。 */
export function codeLanguageColor(language: string): string {
  const { id } = resolveLanguage(language);
  const colors: Record<string, string> = {
    python: '#3b82f6',
    javascript: '#f1e05a',
    jsx: '#61dafb',
    typescript: '#3178c6',
    tsx: '#61dafb',
    java: '#e76f00',
    kotlin: '#a97bff',
    c: '#7f9cc4',
    cpp: '#f34b7d',
    csharp: '#68217a',
    go: '#00add8',
    rust: '#dea584',
    sql: '#e38c00',
    bash: '#89e051',
    r: '#276dc3',
    matlab: '#e16737',
    haskell: '#a07ccf',
    json: '#cbcb41',
    yaml: '#cb171e',
    html: '#e34c26',
    xml: '#e37933',
    css: '#563d7c',
  };
  return colors[id] ?? '#8b949e';
}

function push(tokens: CodeToken[], kind: CodeTokenKind, text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

/** 从 start 读到匹配的引号（处理转义）；读不到就吃到行尾/全文末尾（流式输出时常见）。 */
function readString(code: string, start: number, quote: string, multiline: boolean): number {
  let index = start + quote.length;
  while (index < code.length) {
    const char = code[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (code.startsWith(quote, index)) return index + quote.length;
    if (char === '\n' && !multiline) return index;
    index += 1;
  }
  return code.length;
}

function tokenizeTemplate(tokens: CodeToken[], text: string) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('${', cursor);
    if (open === -1) break;
    let depth = 1;
    let close = open + 2;
    while (close < text.length && depth > 0) {
      if (text[close] === '{') depth += 1;
      else if (text[close] === '}') depth -= 1;
      close += 1;
    }
    push(tokens, 'string', text.slice(cursor, open));
    push(tokens, 'keyword', '${');
    push(tokens, 'variable', text.slice(open + 2, depth === 0 ? close - 1 : close));
    if (depth === 0) push(tokens, 'keyword', '}');
    cursor = close;
  }
  push(tokens, 'string', text.slice(cursor));
}

function tokenizeMarkup(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;
  while (cursor < code.length) {
    if (code.startsWith('<!--', cursor)) {
      const end = code.indexOf('-->', cursor);
      const stop = end === -1 ? code.length : end + 3;
      push(tokens, 'comment', code.slice(cursor, stop));
      cursor = stop;
      continue;
    }
    if (code[cursor] === '<') {
      const match = code.slice(cursor).match(/^<\/?[!?]?[A-Za-z][\w:.-]*/);
      if (match) {
        push(tokens, 'punct', match[0].startsWith('</') ? '</' : '<');
        push(tokens, 'tag', match[0].replace(/^<\/?/, ''));
        cursor += match[0].length;
        while (cursor < code.length && code[cursor] !== '>') {
          const attr = code.slice(cursor).match(/^[A-Za-z_:@][\w:.-]*/);
          if (attr) {
            push(tokens, 'attr', attr[0]);
            cursor += attr[0].length;
            continue;
          }
          if (code[cursor] === '"' || code[cursor] === "'") {
            const end = readString(code, cursor, code[cursor], true);
            push(tokens, 'string', code.slice(cursor, end));
            cursor = end;
            continue;
          }
          push(tokens, 'punct', code[cursor]);
          cursor += 1;
        }
        if (code[cursor] === '>') {
          push(tokens, 'punct', '>');
          cursor += 1;
        }
        continue;
      }
    }
    push(tokens, 'plain', code[cursor]);
    cursor += 1;
  }
  return tokens;
}

function tokenizeCss(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;
  let inBlock = 0;
  while (cursor < code.length) {
    const char = code[cursor];
    if (code.startsWith('/*', cursor)) {
      const end = code.indexOf('*/', cursor + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(tokens, 'comment', code.slice(cursor, stop));
      cursor = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = readString(code, cursor, char, false);
      push(tokens, 'string', code.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (char === '{' || char === '}') {
      inBlock += char === '{' ? 1 : -1;
      push(tokens, 'punct', char);
      cursor += 1;
      continue;
    }
    if (inBlock > 0) {
      const prop = code.slice(cursor).match(/^(--)?[a-zA-Z-]+(?=\s*:)/);
      if (prop) {
        push(tokens, 'property', prop[0]);
        cursor += prop[0].length;
        continue;
      }
      const num = code.slice(cursor).match(/^-?\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?/);
      if (num && !/[\w-]/.test(code[cursor - 1] ?? '')) {
        push(tokens, 'number', num[0]);
        cursor += num[0].length;
        continue;
      }
      const hex = code.slice(cursor).match(/^#[0-9a-fA-F]{3,8}\b/);
      if (hex) {
        push(tokens, 'number', hex[0]);
        cursor += hex[0].length;
        continue;
      }
      const fn = code.slice(cursor).match(/^[a-zA-Z-]+(?=\()/);
      if (fn) {
        push(tokens, 'function', fn[0]);
        cursor += fn[0].length;
        continue;
      }
      push(tokens, /[:;,()]/.test(char) ? 'punct' : 'string', char);
      cursor += 1;
      continue;
    }
    const at = code.slice(cursor).match(/^@[\w-]+/);
    if (at) {
      push(tokens, 'control', at[0]);
      cursor += at[0].length;
      continue;
    }
    push(tokens, /\s/.test(char) ? 'plain' : 'tag', char);
    cursor += 1;
  }
  return tokens;
}

function tokenizeGeneric(code: string, spec: LanguageSpec, json: boolean): CodeToken[] {
  const tokens: CodeToken[] = [];
  const norm = (word: string) => (spec.caseInsensitive ? word.toLowerCase() : word);
  const keywords = new Set(spec.keywords ?? []);
  const control = new Set(spec.control ?? []);
  const types = new Set(spec.types ?? []);
  const constants = new Set(spec.constants ?? []);
  const builtins = new Set(spec.builtins ?? []);
  let previousWord = '';
  let cursor = 0;

  while (cursor < code.length) {
    const char = code[cursor];
    const rest = code.slice(cursor, cursor + 4);

    const lineComment = spec.lineComment?.find((marker) => code.startsWith(marker, cursor));
    // shell 里 # 只在行首或空白后才算注释（不然 $# 之类会被吃掉）。
    if (lineComment && !(spec.dollarVars && cursor > 0 && !/\s/.test(code[cursor - 1]))) {
      const end = code.indexOf('\n', cursor);
      const stop = end === -1 ? code.length : end;
      push(tokens, 'comment', code.slice(cursor, stop));
      cursor = stop;
      continue;
    }

    if (spec.blockComment && code.startsWith(spec.blockComment[0], cursor)) {
      const end = code.indexOf(spec.blockComment[1], cursor + spec.blockComment[0].length);
      const stop = end === -1 ? code.length : end + spec.blockComment[1].length;
      push(tokens, 'comment', code.slice(cursor, stop));
      cursor = stop;
      continue;
    }

    if (spec.quotes?.includes(char)) {
      const triple = spec.tripleQuotes && rest.startsWith(char.repeat(3));
      const quote = triple ? char.repeat(3) : char;
      const end = readString(code, cursor, quote, triple || char === '`');
      const text = code.slice(cursor, end);
      // JSON / YAML 里冒号前的字符串是键。
      if (json && /^\s*:/.test(code.slice(end))) push(tokens, 'property', text);
      else if (char === '`' && spec.template) tokenizeTemplate(tokens, text);
      else push(tokens, 'string', text);
      cursor = end;
      previousWord = '';
      continue;
    }

    if (spec.dollarVars && char === '$') {
      const match = code.slice(cursor).match(/^\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9#?@*!$-])/);
      if (match) {
        push(tokens, 'variable', match[0]);
        cursor += match[0].length;
        continue;
      }
    }

    if (spec.decorators && char === '@' && /[A-Za-z_]/.test(code[cursor + 1] ?? '')) {
      const match = code.slice(cursor).match(/^@[\w.]+/);
      if (match) {
        push(tokens, 'decorator', match[0]);
        cursor += match[0].length;
        continue;
      }
    }

    if (/\d/.test(char) && !/[\w$]/.test(code[cursor - 1] ?? '')) {
      const match = code
        .slice(cursor)
        .match(/^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/);
      if (match) {
        push(tokens, 'number', match[0]);
        cursor += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_#]/.test(char) || (json && /[\w-]/.test(char))) {
      const match = code.slice(cursor).match(json ? /^[\w.-]+/ : /^#?[A-Za-z_]\w*/);
      if (match && (match[0][0] !== '#' || control.has(match[0]))) {
        const word = match[0];
        const key = norm(word);
        const after = code.slice(cursor + word.length);
        let kind: CodeTokenKind = 'variable';
        if (json) {
          kind = constants.has(key) ? 'constant' : /^\s*:/.test(after) ? 'property' : 'string';
        } else if (control.has(key)) kind = 'control';
        else if (keywords.has(key)) kind = 'keyword';
        else if (constants.has(key)) kind = 'constant';
        else if (types.has(key)) kind = 'type';
        else if (/^(?:def|fn|func|fun|function)$/.test(previousWord)) kind = 'function';
        else if (
          /^(?:class|struct|interface|enum|trait|type|extends|implements|new)$/.test(previousWord)
        )
          kind = 'type';
        else if (/^\s*\(/.test(after) || builtins.has(key)) kind = 'function';
        else if (spec.pascalTypes && /^[A-Z][a-z0-9]\w*$/.test(word)) kind = 'type';
        else if (/^[A-Z][A-Z0-9_]+$/.test(word)) kind = 'constant';
        else if (code[cursor - 1] === '.') kind = 'property';
        push(tokens, kind, word);
        previousWord = key;
        cursor += word.length;
        continue;
      }
    }

    if (!/\s/.test(char)) previousWord = /[.]/.test(char) ? previousWord : '';
    push(tokens, /[\s]/.test(char) ? 'plain' : 'punct', char);
    cursor += 1;
  }
  return tokens;
}

/** 高亮整段代码，按行切好（每行是一串 token），空行也保留。 */
export function highlightCodeLines(code: string, language: string): CodeToken[][] {
  const { id, spec } = resolveLanguage(language);
  if (id === 'diff' || id === 'patch') {
    return code.split('\n').map((line) => {
      const kind: CodeTokenKind = /^(?:\+\+\+|---|@@)/.test(line)
        ? 'meta'
        : line.startsWith('+')
          ? 'inserted'
          : line.startsWith('-')
            ? 'deleted'
            : 'plain';
      return line ? [{ kind, text: line }] : [];
    });
  }
  const tokens = !spec
    ? [{ kind: 'plain' as const, text: code }]
    : spec.mode === 'markup'
      ? tokenizeMarkup(code)
      : spec.mode === 'css'
        ? tokenizeCss(code)
        : tokenizeGeneric(code, spec, spec.mode === 'json');

  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: token.kind, text: part });
    });
  }
  return lines;
}
