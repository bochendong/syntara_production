/** Separate the original exam's grading instructions from the actual task. */
export function racketStatementConstraints(text: string) {
  const blocks: string[] = [];
  let block: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    }
    if (!line.trim() && !fence) {
      if (block.length) blocks.push(block.join('\n'));
      block = [];
    } else block.push(line);
  }
  if (block.length) blocks.push(block.join('\n'));

  const description: string[] = [];
  const constraints: string[] = [];
  let grading = false;
  // Imported exams use these rules in table/short-answer tasks too, and translations
  // do not retain the English lead-in. Recognize the rule itself, not just its header.
  const isRule = (part: string) => {
    const text = part
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\*\*/g, '')
      .trim();
    return (
      /^(?:Your (?:function design|answer|design|submission) (?:must|should) include\b|(?:You|Files?|The file|Your submission)\b[^\n]{0,70}(?:must not (?:edit|comment|delete|have any errors)|must (?:pass|follow)|must run)|You (?:MUST NOT|must not)\s+(?:in any way\s+)?(?:edit|comment|delete)|To receive (?:full|substantial) credit\b|NOTE ALSO THAT YOU MUST NOT CHANGE|ALSO NOTE THAT THE USUAL RULES ABOUT CHECK SYNTAX)/i.test(
        text,
      ) ||
      /^(?:(?:NOTE:|Note that:?|注意[：:]?)\s*)?(?:-\s*)?(?:This|The) (?:problem|question|file)\b[^\n]{0,55}\bautograded\b/i.test(
        text,
      ) ||
      /^(?:Be VERY CAREFUL WRITING THE SIGNATURE|BUT BE CAREFUL\. The autograder)/i.test(text) ||
      /^(?:(?:注意|说明)[：:]?\s*)?(?:本题|此题|本文件|本题目)[^\n]{0,35}自动评分/.test(text) ||
      /^(?:不得(?:修改|编辑|删除|注释)|不(?:要|得)修改|只能修改|提交前必须运行|(?:提交|整份文件|文件|程序|点击)[^\n]{0,65}(?:Check Syntax|Run|检查语法|不得存在任何错误)|(?:获得|要获得)满分必须|(?:函数)?设计(?:必须|应当)包含|答案(?:还)?(?:必须|须)包含)/.test(
        text,
      )
    );
  };
  for (const part of blocks.flatMap((item) =>
    /^\s*[-*]\s+/.test(item) ? item.split(/\n(?=\s*[-*]\s+)/) : [item],
  )) {
    if (/^#{1,6}\s*(?:约束限制条件|约束与限制|Constraints(?: and restrictions)?)\s*$/i.test(part)) {
      grading = true;
    } else if (!/^(?:```|~~~)/.test(part) && isRule(part)) {
      grading = true;
      constraints.push(
        ...part.split(/\n(?=\s*[-*]\s+)/).map((item) => item.replace(/^\s*[-*]\s+/, '')),
      );
    } else if (grading && /^\s*[-*]\s+/.test(part)) {
      constraints.push(
        ...part.split(/\n(?=\s*[-*]\s+)/).map((item) => item.replace(/^\s*[-*]\s+/, '')),
      );
    } else if (
      grading &&
      constraints.length &&
      ((/^(?:```|~~~)/.test(part) && /:\s*$/.test(constraints[constraints.length - 1])) ||
        /^This would be a valid function body\b/.test(part) ||
        /\bwill of$/.test(constraints[constraints.length - 1]))
    ) {
      constraints[constraints.length - 1] += `\n\n${part}`;
    } else {
      grading = false;
      description.push(part);
    }
  }
  return { description: description.join('\n\n'), constraints };
}

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
  language?: string;
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
  const extractedConstraints: string[] = [];
  const splitRacketText = (text: string) => {
    if (!['racket', 'scheme'].includes(content.language?.trim().toLowerCase() ?? '')) return text;
    const result = racketStatementConstraints(text);
    extractedConstraints.push(...result.constraints);
    return result.description;
  };
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
      .replace(
        /(?:(?:^|\n)#{1,6}[ \t]+(?:给定代码|Provided code)[ \t]*\n+)?```(?:python|py|racket|rkt|scheme)?[ \t]*\n([\s\S]*?)```/g,
        (block, code: string) => (alreadyInEditor(code) ? '' : block),
      )
      .replace(/^\s*\*\*Write the function body:\*\*\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  const fallback =
    locale === 'zh-CN'
      ? '根据右侧函数头和 docstring，补全函数体。'
      : 'Complete the function body using the header and docstring on the right.';
  const stem = cleanText(splitRacketText(content.stem)) || fallback;
  const sections = (content.statementSections ?? [])
    .map((section) => ({
      ...section,
      kind: section.kind ?? 'overview',
      body: cleanText(splitRacketText(section.body ?? '')),
      items: (section.items ?? []).filter((item) => !FILLER.has(normalize(item))),
      code: section.code && !alreadyInEditor(section.code) ? section.code : undefined,
    }))
    .filter((section) => section.body || section.items.length || section.code);
  const hasDocstringExamples = /(?:"""|''')[\s\S]*>>>/.test(given);
  return {
    stem,
    sections,
    samples: hasDocstringExamples ? [] : (content.sampleIO ?? []),
    constraints: [...new Set([...(content.constraints ?? []), ...extractedConstraints])].filter(
      (item) => !FILLER.has(normalize(item)),
    ),
    starterDescription: cleanText(content.starterCodeDescription) || undefined,
  };
}
