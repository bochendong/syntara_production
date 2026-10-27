import type {
  NotebookProblemGradingTable,
  NotebookProblemImportDraft,
  NotebookProblemPublicTable,
} from '@/lib/problem-bank';
import {
  matchTableCellLocally,
  normalizeTableOutput,
  tableRowCode,
  tableRunResultText,
} from '@/lib/problem-bank';
import { runTableCellChecks, runTableRows } from '@/lib/server/notebook-problems/judge';

const NOTE_PREFIX = '表格核对：';

/**
 * 真跑表格里每一行，核对 AI 给的 output / python_value 答案。
 * 不一致时以运行结果为准，并在草稿上留一条提醒，让老师过目。
 */
export async function verifyTableAnswers(
  content: NotebookProblemPublicTable,
  grading: NotebookProblemGradingTable,
): Promise<{ grading: NotebookProblemGradingTable; corrections: string[] }> {
  if (!content.runnable) throw new Error('表格未配置可执行代码');
  const rows = content.rows
    .map((row) => ({ id: row.id, code: tableRowCode(content, row.id) }))
    .filter((row): row is { id: string; code: string } => Boolean(row.code));
  if (rows.length !== content.rows.length) throw new Error('表格存在无法运行的行');
  const runs = new Map(
    (await runTableRows({ rows, setup: content.setupCode, files: content.files })).map((run) => [
      run.id,
      run,
    ]),
  );
  const columns = new Map(content.columns.map((column) => [column.id, column]));
  const corrections: string[] = [];
  const pendingValueChecks: Array<{ index: number; executed: string }> = [];
  const cells = grading.cells.map((cell) => ({ ...cell }));

  cells.forEach((cell, index) => {
    const run = runs.get(cell.rowId);
    const column = columns.get(cell.colId);
    if (!run || !column) return;
    if (cell.matcher === 'output') {
      const executed = tableRunResultText(run);
      if (matchTableCellLocally(cell, executed)) return;
      cell.acceptedAnswers = [executed];
      corrections.push(
        `第 ${content.rows.findIndex((row) => row.id === cell.rowId) + 1} 行：${normalizeTableOutput(executed)}`,
      );
    } else if (cell.matcher === 'python_value') {
      const executed = run.errorType ? `ERROR (${run.errorType})` : run.value;
      if (executed === null) return;
      if (run.errorType) {
        if (!matchTableCellLocally(cell, executed)) {
          cell.acceptedAnswers = [executed];
          corrections.push(
            `第 ${content.rows.findIndex((row) => row.id === cell.rowId) + 1} 行：${executed}`,
          );
        }
        return;
      }
      pendingValueChecks.push({ index, executed });
    }
  });

  if (pendingValueChecks.length > 0) {
    const verdicts = await runTableCellChecks({
      items: pendingValueChecks.map(({ index, executed }) => ({
        key: String(index),
        matcher: 'python_value' as const,
        answer: executed,
        accepted: cells[index].acceptedAnswers,
      })),
    });
    for (const { index, executed } of pendingValueChecks) {
      if (verdicts.get(String(index))) continue;
      cells[index].acceptedAnswers = [executed];
      corrections.push(
        `第 ${content.rows.findIndex((row) => row.id === cells[index].rowId) + 1} 行：${executed}`,
      );
    }
  }
  return { grading: { ...grading, cells }, corrections };
}

export async function verifyImportedTableDrafts(
  drafts: NotebookProblemImportDraft[],
): Promise<NotebookProblemImportDraft[]> {
  return Promise.all(
    drafts.map(async (draft) => {
      try {
        if (draft.publicContent.type === 'table' && draft.grading.type === 'table') {
          const { grading, corrections } = await verifyTableAnswers(
            draft.publicContent,
            draft.grading,
          );
          return withCorrections(draft, { ...draft, grading }, corrections);
        }
        if (draft.publicContent.type === 'multipart' && draft.grading.type === 'multipart') {
          if (!draft.publicContent.parts.some((part) => part.content.type === 'table'))
            return draft;
          const corrections: string[] = [];
          const parts = await Promise.all(
            draft.grading.parts.map(async (entry) => {
              const part =
                draft.publicContent.type === 'multipart'
                  ? draft.publicContent.parts.find((item) => item.label === entry.label)
                  : undefined;
              if (part?.content.type !== 'table' || entry.grading.type !== 'table') return entry;
              const verified = await verifyTableAnswers(part.content, entry.grading);
              corrections.push(...verified.corrections.map((note) => `(${entry.label}) ${note}`));
              return { ...entry, grading: verified.grading };
            }),
          );
          return withCorrections(
            draft,
            { ...draft, grading: { ...draft.grading, parts } },
            corrections,
          );
        }
      } catch {
        const sourceMeta = { ...draft.sourceMeta };
        delete sourceMeta.tableVerification;
        return {
          ...draft,
          sourceMeta,
          status: 'draft',
          validationErrors: [
            ...draft.validationErrors.filter((error) => !error.startsWith(NOTE_PREFIX)),
            `${NOTE_PREFIX}运行核对未完成，请老师检查表格答案。`,
          ],
        };
      }
      return draft;
    }),
  );
}

function withCorrections(
  original: NotebookProblemImportDraft,
  next: NotebookProblemImportDraft,
  corrections: string[],
): NotebookProblemImportDraft {
  const validationErrors = original.validationErrors.filter(
    (error) => !error.startsWith(NOTE_PREFIX),
  );
  return {
    ...next,
    status: corrections.length ? 'draft' : next.status,
    sourceMeta: {
      ...next.sourceMeta,
      tableVerification: { checkedBy: 'python-runner', corrected: corrections.length },
    },
    validationErrors: corrections.length
      ? [
          ...validationErrors,
          `${NOTE_PREFIX}有 ${corrections.length} 格和运行结果不一致，已按运行结果更正，请老师过目：${corrections.slice(0, 6).join('；')}`,
        ]
      : validationErrors,
  };
}
