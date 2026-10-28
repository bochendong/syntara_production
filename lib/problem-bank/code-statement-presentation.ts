type StatementKind =
  | 'overview'
  | 'requirements'
  | 'interface'
  | 'invariants'
  | 'examples'
  | 'constraints'
  | 'notes';
type StatementSection = {
  id: string;
  kind?: StatementKind;
  title: string;
  body?: string;
  items?: string[];
  code?: string;
  codeLanguage?: string;
  language?: string;
};
type CodeStatementInput = {
  stem: string;
  template?: string;
  starterCode?: string;
  statementSections?: StatementSection[];
  sampleIO?: Array<{ input: string; output: string; explanation?: string }>;
  constraints?: string[];
  starterCodeDescription?: string;
};

const FILLER = new Set([
  'Complete only the editable blanks. Preserve the supplied headers and documentation.',
  'The editable starter contains the required interface. All functions in this question are submitted together.',
  'Verified examples are shown below.',
  'The source restrictions in the task are part of grading.',
  'Use only the introductory Python constructs allowed in the statement.',
  'Preserve the specified return and mutation behavior.',
]);
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Remove presentation duplication; keep original content and all specific restrictions intact. */
export function codeStatementPresentation(content: CodeStatementInput, locale: 'zh-CN' | 'en-US') {
  const given = content.template || content.starterCode || '';
  const givenText = normalize(given.replace(/\{\{[\w-]+\}\}/g, ''));
  const alreadyInEditor = (code: string) =>
    Boolean(code.trim() && givenText.includes(normalize(code)));
  const cleanText = (text = '') => {
    if (FILLER.has(normalize(text))) return '';
    if (
      normalize(text) === 'Write a complete function including the required course docstring.' &&
      /doctest/i.test(content.stem) &&
      /header/i.test(content.stem)
    )
      return '';
    return text
      .replace(/```(?:python|py)?\s*\n([\s\S]*?)```/g, (block, code: string) =>
        alreadyInEditor(code) ? '' : block,
      )
      .replace(/^\s*\*\*Write the function body:\*\*\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  const fallback =
    locale === 'zh-CN'
      ? '根据右侧函数头和 docstring，补全函数体。'
      : 'Complete the function body using the header and docstring on the right.';
  const stem = cleanText(content.stem) || fallback;
  const sections = (content.statementSections ?? [])
    .map((section) => ({
      ...section,
      kind: section.kind ?? 'overview',
      body: cleanText(section.body),
      items: (section.items ?? []).filter((item) => !FILLER.has(normalize(item))),
      code: section.code && !alreadyInEditor(section.code) ? section.code : undefined,
    }))
    .filter((section) => section.body || section.items.length || section.code);
  const hasDocstringExamples = /(?:"""|''')[\s\S]*>>>/.test(given);
  return {
    stem,
    sections,
    samples: hasDocstringExamples ? [] : (content.sampleIO ?? []),
    constraints: (content.constraints ?? []).filter((item) => !FILLER.has(normalize(item))),
    starterDescription: cleanText(content.starterCodeDescription) || undefined,
  };
}
