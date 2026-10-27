import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptResult,
  NotebookTableProblemRecord,
} from '@/lib/problem-bank';
import { matchTableCellLocally, tableCellKey } from '@/lib/problem-bank';
import { runTableCellChecks } from '@/lib/server/notebook-problems/judge';

/** 表格题逐格判分：能直接比的格子当场比，python_value / run_check 交给 Python 运行。 */
export async function evaluateNotebookTableProblem(args: {
  problem: NotebookTableProblemRecord;
  answer: NotebookProblemAttemptAnswer;
  language: 'zh-CN' | 'en-US';
}): Promise<{
  status: 'passed' | 'failed' | 'partial' | 'error';
  score: number;
  result: NotebookProblemAttemptResult;
}> {
  const zh = args.language === 'zh-CN';
  const { problem } = args;
  const filled = args.answer.cells ?? {};
  const graded = problem.grading.cells;
  if (graded.length === 0) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback: zh ? '这道表格题缺少标准答案。' : 'This table problem has no answer key.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }
  if (!Object.values(filled).some((value) => value.trim())) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback: zh ? '请先填写表格。' : 'Fill in the table first.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  const verdicts = new Map<string, boolean>();
  const pythonItems: Parameters<typeof runTableCellChecks>[0]['items'] = [];
  for (const cell of graded) {
    const key = tableCellKey(cell.rowId, cell.colId);
    const answer = filled[key] ?? '';
    const local = matchTableCellLocally(cell, answer);
    if (local !== null) {
      verdicts.set(key, local);
    } else if (cell.matcher === 'python_value' || cell.matcher === 'run_check') {
      pythonItems.push({
        key,
        matcher: cell.matcher,
        answer,
        accepted: cell.acceptedAnswers,
        check: cell.check,
      });
    }
  }
  try {
    const checked = await runTableCellChecks({
      items: pythonItems,
      setup: problem.publicContent.setupCode,
      files: problem.publicContent.files,
    });
    for (const item of pythonItems) verdicts.set(item.key, checked.get(item.key) ?? false);
  } catch (error) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          error instanceof Error
            ? error.message
            : zh
              ? '代码运行器暂时不可用，请稍后再试。'
              : 'Code runner unavailable. Please try again later.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  const weights = graded.map((cell) => (cell.points && cell.points > 0 ? cell.points : 1));
  const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
  const earnedWeight = graded.reduce(
    (acc, cell, index) =>
      acc + (verdicts.get(tableCellKey(cell.rowId, cell.colId)) ? weights[index] : 0),
    0,
  );
  const score = Math.round(((problem.points * earnedWeight) / totalWeight) * 100) / 100;
  const correctCount = graded.filter((cell) =>
    verdicts.get(tableCellKey(cell.rowId, cell.colId)),
  ).length;
  const status =
    correctCount === graded.length ? 'passed' : correctCount === 0 ? 'failed' : 'partial';
  return {
    status,
    score,
    result: {
      correct: status === 'passed',
      feedback: zh
        ? `答对 ${correctCount}/${graded.length} 格。`
        : `${correctCount}/${graded.length} cells correct.`,
      analysis: problem.grading.analysis,
      earnedPoints: score,
      publicCases: [],
      cells: graded.map((cell) => {
        const key = tableCellKey(cell.rowId, cell.colId);
        return { key, correct: verdicts.get(key) ?? false };
      }),
    },
  };
}
