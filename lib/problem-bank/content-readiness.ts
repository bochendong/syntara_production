import type { NotebookProblemImportDraft } from './schema';

/** Delivery invariants apply to all generated/imported/edited subjects. */
export function problemContentReadinessErrors(draft: NotebookProblemImportDraft): string[] {
  const content = draft.publicContent;
  const text = content.type === 'fill_blank' ? content.stemTemplate : content.stem;
  const errors: string[] = [];
  let fence = '';
  let tableColumns = 0;
  let previousRow = 0;
  const cells = (line: string) =>
    line
      .trim()
      .replace(/`[^`]*`/g, 'CODE')
      .replace(/\\\|/g, 'PIPE')
      .replace(/^\||\|$/g, '')
      .split('|');
  for (const line of [...text.split('\n'), '']) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && /^\s*\|.*(?:`{3,}|~{3,})/.test(line)) {
      errors.push('题面结构：多行代码不得嵌入 Markdown 表格；请使用独立代码块并在后面放置对应填空');
    }
    if (!match) {
      if (fence) continue;
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const row = cells(line);
        const separator = row.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
        if (separator) {
          if (!previousRow || previousRow !== row.length)
            errors.push('题面结构：表格表头与分隔行列数不一致');
          tableColumns = row.length;
        } else if (tableColumns && row.length !== tableColumns) {
          errors.push('题面结构：表格各行列数必须一致；代码中的竖线需要转义');
        }
        previousRow = row.length;
      } else {
        if (previousRow > 1 && !tableColumns)
          errors.push('题面结构：表格缺少连续的表头和分隔行，不能用空行拆开表格');
        tableColumns = 0;
        previousRow = 0;
      }
      continue;
    }
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = '';
  }
  if (fence) errors.push('题面结构：代码围栏未闭合，请保留完整代码块与缩进');
  if (content.type === 'fill_blank') {
    for (const blank of content.blanks.filter((blank) => blank.answerKind === 'code_token')) {
      const codeBlocks = [
        ...text.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*[A-Za-z][^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm),
      ];
      if (
        !codeBlocks.some((block) =>
          [...block[2].matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].some(
            (match) => match[1].trim() === blank.id,
          ),
        )
      ) {
        errors.push('题面结构：代码填空必须保留在完整的带语言标记代码块内');
      }
    }
    const ids = content.blanks.map((blank) => blank.id);
    const markers = [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim());
    const gradingIds =
      draft.grading.type === 'fill_blank' ? draft.grading.blanks.map((blank) => blank.id) : [];
    if (
      new Set(ids).size !== ids.length ||
      new Set(gradingIds).size !== gradingIds.length ||
      ids.some((id) => !markers.includes(id) || !gradingIds.includes(id)) ||
      markers.some((id) => !ids.includes(id)) ||
      gradingIds.some((id) => !ids.includes(id))
    ) {
      errors.push('题面结构：填空标记、作答项和评分项必须一一对应');
    }
    if (
      draft.grading.type === 'fill_blank' &&
      draft.grading.blanks.some((blank) => !blank.acceptedAnswers.some((answer) => answer.trim()))
    ) {
      errors.push('题面结构：每个空格必须提供可验证的参考答案');
    }
  }
  return errors;
}
