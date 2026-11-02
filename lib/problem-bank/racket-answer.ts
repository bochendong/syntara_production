/** A non-executing reader for structured Racket answers. Never evaluates student code. */
export type RacketForm = {
  kind: 'atom' | 'string' | 'list' | 'quote';
  text: string;
  value: string;
  items: RacketForm[];
};
export type RacketAnswerSpec = {
  mode: 'constants' | 'expressions' | 'signatures' | 'template';
  starterCode?: string;
  sexpKeys?: string[];
  templateName?: string;
  examples?: Array<string | boolean | { struct: string }>;
};
export type RacketAnswerTable = {
  rows: Array<{ id: string; cells: Record<string, string> }>;
  columns: Array<{ id: string; role: 'given' | 'answer' }>;
};

export function readRacketForms(source: string): RacketForm[] {
  if (source.length > 40000) throw new Error('代码超过 40000 个字符。');
  let i = 0,
    depth = 0;
  const error = (message: string): never => {
    throw new Error(`${message}（第 ${source.slice(0, i).split('\n').length} 行）`);
  };
  const whitespace = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) i++;
      else if (source[i] === ';') {
        while (i < source.length && source[i] !== '\n') i++;
      } else if (source.startsWith('#|', i)) {
        let nested = 1;
        i += 2;
        while (i < source.length && nested) {
          if (source.startsWith('#|', i)) {
            nested++;
            i += 2;
          } else if (source.startsWith('|#', i)) {
            nested--;
            i += 2;
          } else i++;
        }
        if (nested) error('块注释缺少 |#');
      } else if (source.startsWith('#;', i)) {
        i += 2;
        whitespace();
        read();
      } else break;
    }
  };
  const read = (): RacketForm => {
    whitespace();
    const start = i;
    if (i >= source.length) error('表达式尚未完成');
    if (++depth > 200) error('表达式嵌套过深');
    let result: RacketForm;
    if ('([{'.includes(source[i])) {
      const close = { '(': ')', '[': ']', '{': '}' }[source[i]];
      i++;
      const items: RacketForm[] = [];
      whitespace();
      while (i < source.length && source[i] !== close) {
        if (')]}'.includes(source[i])) error('左右括号不匹配');
        items.push(read());
        whitespace();
      }
      if (i >= source.length) error(`缺少 ${close}`);
      i++;
      result = { kind: 'list', value: '', items, text: source.slice(start, i) };
    } else if (')]}'.includes(source[i])) return error('多出了右括号');
    else if (source[i] === '"') {
      i++;
      let value = '',
        closed = false;
      while (i < source.length) {
        const char = source[i++];
        if (char === '"') {
          closed = true;
          break;
        }
        if (char === '\\') {
          if (i >= source.length) error('字符串转义尚未完成');
          const escaped = source[i++];
          const escapes: Record<string, string> = {
            n: '\n',
            r: '\r',
            t: '\t',
            '"': '"',
            '\\': '\\',
          };
          if (!(escaped in escapes)) error('暂不支持这个字符串转义');
          value += escapes[escaped];
        } else value += char;
      }
      if (!closed) error('字符串缺少结束引号');
      result = { kind: 'string', value, items: [], text: source.slice(start, i) };
    } else if (source[i] === "'") {
      i++;
      const item = read();
      result = { kind: 'quote', value: '', items: [item], text: source.slice(start, i) };
    } else {
      while (i < source.length && !/[\s()[\]{};"']/.test(source[i])) i++;
      if (i === start) error('无法识别的字符');
      result = {
        kind: 'atom',
        value: source.slice(start, i),
        items: [],
        text: source.slice(start, i),
      };
    }
    depth--;
    return result;
  };
  const forms: RacketForm[] = [];
  whitespace();
  while (i < source.length) {
    forms.push(read());
    whitespace();
  }
  return forms;
}
export const racketHead = (form: RacketForm) => (form.kind === 'list' ? form.items[0]?.value : '');
export function racketAnswerSpec(content: Record<string, unknown>): RacketAnswerSpec | null {
  const value = content.racketAnswer as RacketAnswerSpec | undefined;
  return value && ['constants', 'expressions', 'signatures', 'template'].includes(value.mode)
    ? value
    : null;
}
function tableFields(content: RacketAnswerTable) {
  return content.rows.flatMap((row) =>
    content.columns
      .filter((c) => c.role === 'answer')
      .map((col) => ({
        key: `${row.id}:${col.id}`,
        name: row.cells.name || `ANSWER-${row.id.replace(/^statement_/, '').toUpperCase()}`,
      })),
  );
}
function valueSource(value: string) {
  if (!value.trim()) return '???';
  try {
    const forms = readRacketForms(value);
    if (
      forms.length === 1 &&
      (forms[0].kind !== 'atom' ||
        /^(?:true|false|#(?:true|false|t|f)|[-+]?\d+(?:\.\d+)?|empty)$/.test(value))
    )
      return value;
  } catch {}
  return JSON.stringify(value);
}
export function racketTableAnswerSource(
  content: RacketAnswerTable,
  spec: RacketAnswerSpec,
  cells: Record<string, string> = {},
) {
  const fields = tableFields(content);
  if (spec.mode === 'constants')
    return fields.map((f) => `(define ${f.name} ${valueSource(cells[f.key] || '')})`).join('\n');
  if (spec.mode === 'signatures')
    return fields.map((f, i) => `;; ${i + 1}\n${cells[f.key] || '(@signature ???)'}`).join('\n\n');
  return fields.map((f, i) => `;; ${i + 1}\n${cells[f.key] || ''}`).join('\n\n');
}
export function parseRacketTableAnswer(
  content: RacketAnswerTable,
  spec: RacketAnswerSpec,
  code: string,
) {
  const forms = readRacketForms(code),
    fields = tableFields(content),
    cells: Record<string, string> = {};
  if (spec.mode === 'constants') {
    const names = new Map(fields.map((f) => [f.name, f.key]));
    const seen = new Set<string>();
    for (const form of forms) {
      if (racketHead(form) === 'require') continue;
      if (racketHead(form) !== 'define' || form.items.length !== 3 || form.items[1].kind !== 'atom')
        throw new Error('请使用 (define 常量名 答案) 填写答案。');
      const name = form.items[1].value,
        key = names.get(name);
      if (!key) throw new Error(`没有需要填写的常量 ${name}，请保留给定的答案常量名。`);
      if (seen.has(name)) throw new Error(`常量 ${name} 重复定义。`);
      seen.add(name);
      const value = form.items[2];
      if (value.text.includes('???')) continue;
      if (
        !spec.sexpKeys?.includes(key) &&
        value.kind === 'atom' &&
        !/^(?:true|false|#(?:true|false|t|f)|[-+]?\d+(?:\.\d+)?|empty)$/.test(value.value)
      )
        throw new Error(`${name} 的字符串答案需要用双引号括起来。`);
      cells[key] =
        value.kind === 'string' && !spec.sexpKeys?.includes(key)
          ? value.value
          : ((
              { '#t': 'true', '#true': 'true', '#f': 'false', '#false': 'false' } as Record<
                string,
                string
              >
            )[value.text] ?? value.text);
    }
  } else {
    if (forms.length > fields.length)
      throw new Error(`需要 ${fields.length} 个答案，当前有 ${forms.length} 个。`);
    forms.forEach((form, i) => {
      if (spec.mode === 'signatures' && racketHead(form) !== '@signature')
        throw new Error(`第 ${i + 1} 个答案需要是 (@signature ...) 标签。`);
      if (!form.text.includes('???')) cells[fields[i].key] = form.text;
    });
  }
  return { cells, missing: fields.filter((f) => !cells[f.key]?.trim()).length };
}

/** Template checks compare tags and branches against the existing reference rubric. */
export function checkRacketTemplate(code: string, reference: string, spec: RacketAnswerSpec) {
  const student = readRacketForms(code),
    expected = readRacketForms(reference);
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const add = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, detail });
  const tags = (forms: RacketForm[], head: string) => forms.filter((f) => racketHead(f) === head);
  add(
    '只包含要求补写的标签和模板',
    student.every(
      (form) =>
        racketHead(form) === '@dd-template-rules' ||
        (racketHead(form) === 'define' &&
          form.items[1]?.kind === 'list' &&
          form.items[1].items[0]?.value === spec.templateName),
    ),
  );
  const canon = (f: RacketForm, parameter: string): string =>
    f.kind === 'list'
      ? `(${f.items.map((x) => canon(x, parameter)).join(' ')})`
      : f.kind === 'quote'
        ? `'${canon(f.items[0], parameter)}`
        : f.kind === 'string'
          ? JSON.stringify(f.value)
          : f.value === parameter
            ? '$argument'
            : f.value;
  const sr = tags(student, '@dd-template-rules'),
    er = tags(expected, '@dd-template-rules');
  add('数据模板规则', sr.length === 1 && er.length === 1 && canon(sr[0], '') === canon(er[0], ''));
  add('模板不包在 @template 中', tags(student, '@template').length === 0);
  const fn = (forms: RacketForm[]) =>
    forms.filter(
      (f) =>
        racketHead(f) === 'define' &&
        f.items[1]?.kind === 'list' &&
        f.items[1].items[0]?.value === spec.templateName,
    );
  const sf = fn(student),
    ef = fn(expected);
  add(
    '模板函数定义',
    sf.length === 1 && sf[0].items[1].items.length === 2 && sf[0].items.length === 3,
  );
  if (sf.length !== 1 || ef.length !== 1) return checks;
  const sp = sf[0].items[1].items[1]?.value,
    ep = ef[0].items[1].items[1]?.value;
  const sb = sf[0].items[2],
    eb = ef[0].items[2];
  const clauses = sb?.items.slice(1) ?? [],
    expectedClauses = eb.items.slice(1);
  add(
    'cond 分支数量与顺序',
    racketHead(sb) === 'cond' && clauses.length === expectedClauses.length,
  );
  if (racketHead(sb) !== 'cond' || clauses.length !== expectedClauses.length) return checks;
  type Example = string | boolean | { struct: string };
  const structPredicates = new Set(
    (spec.examples ?? []).flatMap((example) =>
      typeof example === 'object' ? [`${example.struct}?`] : [],
    ),
  );
  const question = (f: RacketForm, x: Example): unknown => {
    if (f.kind === 'string') return f.value;
    if (f.kind === 'atom') {
      if (f.value === sp) return x;
      if (['else', 'true', '#true', '#t'].includes(f.value)) return true;
      if (['false', '#false', '#f'].includes(f.value)) return false;
      throw new Error('无法验证的条件');
    }
    const head = racketHead(f),
      args = f.items.slice(1);
    if (head === 'and') return args.every((a) => question(a, x) === true);
    if (head === 'or') return args.some((a) => question(a, x) === true);
    const values = args.map((a) => question(a, x));
    if (head === 'not' && values.length === 1) return !values[0];
    if (head === 'string?' && values.length === 1) return typeof values[0] === 'string';
    if (head === 'boolean?' && values.length === 1) return typeof values[0] === 'boolean';
    if (head === 'true?' && values.length === 1) return values[0] === true;
    if (head === 'false?' && values.length === 1) return values[0] === false;
    if (head === 'string=?') {
      if (values.length !== 2 || values.some((v) => typeof v !== 'string'))
        throw new Error('string=? 缺少保护条件');
      return values[0] === values[1];
    }
    if ((head === 'equal?' || head === 'eq?') && values.length === 2)
      return JSON.stringify(values[0]) === JSON.stringify(values[1]);
    if (structPredicates.has(head ?? '') && values.length === 1 && typeof values[0] === 'object')
      return (values[0] as { struct?: string })?.struct === head.slice(0, -1);
    if (structPredicates.has(head ?? '') && values.length === 1) return false;
    throw new Error('无法验证的条件');
  };
  for (const [index, x] of (spec.examples ?? []).entries()) {
    try {
      let chosen = -1;
      for (let i = 0; i < clauses.length; i++) {
        if (clauses[i].kind !== 'list' || clauses[i].items.length !== 2)
          throw new Error('每个 cond 分支需要一个条件和一个答案');
        const result = question(clauses[i].items[0], x);
        if (typeof result !== 'boolean') throw new Error('cond 条件必须产生布尔值');
        if (result) {
          chosen = i;
          break;
        }
      }
      add(`类型分支 ${index + 1} 的条件与保护`, chosen === index);
    } catch (error) {
      add(
        `类型分支 ${index + 1} 的条件与保护`,
        false,
        error instanceof Error ? error.message : '条件错误',
      );
    }
  }
  clauses.forEach((clause, i) => {
    const a = clause.items[1],
      b = expectedClauses[i].items[1];
    const terms = (f: RacketForm, p: string) =>
      racketHead(f) === '...'
        ? f.items
            .slice(1)
            .map((x) => canon(x, p))
            .sort()
        : null;
    add(
      `模板分支 ${i + 1} 的字段与递归`,
      Boolean(
        a &&
        b &&
        JSON.stringify(terms(a, sp)) === JSON.stringify(terms(b, ep)) &&
        terms(a, sp) !== null,
      ),
    );
  });
  return checks;
}
