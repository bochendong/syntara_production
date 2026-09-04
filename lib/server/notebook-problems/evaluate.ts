import type { LanguageModel } from 'ai';
import { callLLM } from '@/lib/ai/llm';
import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptResult,
  NotebookProblemRecord,
} from '@/lib/problem-bank';
import {
  isNotebookCalculationProblemRecord,
  isNotebookChoiceProblemRecord,
  isNotebookFillBlankProblemRecord,
  isNotebookProofProblemRecord,
  isNotebookShortAnswerProblemRecord,
} from '@/lib/problem-bank';

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function extractNumericValue(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreToStatus(score: number, totalPoints: number) {
  if (score <= 0) return 'failed' as const;
  if (score >= totalPoints) return 'passed' as const;
  return 'partial' as const;
}

export async function gradeNotebookTextProblem(args: {
  problem: NotebookProblemRecord;
  answer: NotebookProblemAttemptAnswer;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{
  status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
  score: number;
  result: NotebookProblemAttemptResult;
}> {
  const userAnswer = args.answer.text?.trim() || '';
  const imageAnswers = args.answer.images ?? [];
  if (!userAnswer && imageAnswers.length > 0) {
    return {
      status: 'pending',
      score: 0,
      result: {
        correct: null,
        feedback:
          args.language === 'zh-CN'
            ? `已收到 ${imageAnswers.length} 张照片答案，需要教师人工查看。`
            : `${imageAnswers.length} photo answer(s) received. Manual review is needed.`,
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  if (!userAnswer) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback: args.language === 'zh-CN' ? '请先填写答案。' : 'Please enter an answer.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  const grading = args.problem.grading;
  const questionTypeLabel =
    args.problem.type === 'proof'
      ? args.language === 'zh-CN'
        ? '证明题'
        : 'proof question'
      : args.language === 'zh-CN'
        ? '简答题'
        : 'short-answer question';
  const systemPrompt =
    args.language === 'zh-CN'
      ? `你是一位专业的教育评估专家。你正在评分一道${questionTypeLabel}。请逐项核对评分量表，再根据题目、参考信息和学生答案评分并给出简短评语。
必须以如下 JSON 格式回复（不要包含其他内容）：
{"score": <0到${args.problem.points}的数字>, "criteria": [{"id":"<评分点 id>","earnedPoints":<得分>,"evidence":"<学生答案中的依据>"}], "comment": "<一两句评语>"}`
      : `You are a professional educational assessor. You are grading a ${questionTypeLabel}. Check each rubric criterion before assigning a score, then give brief feedback.
You must reply in the following JSON format only:
{"score": <number from 0 to ${args.problem.points}>, "criteria": [{"id":"<criterion id>","earnedPoints":<points>,"evidence":"<evidence from the response>"}], "comment": "<one or two sentences of feedback>"}`;

  const rubricCriteria =
    grading.type === 'short_answer' || grading.type === 'proof'
      ? (grading.rubricCriteria ?? [])
      : [];

  const rubricBits = [
    grading.type === 'short_answer' ? grading.rubric : undefined,
    grading.type === 'proof' ? grading.rubric : undefined,
    grading.type === 'short_answer' ? grading.referenceAnswer : undefined,
    grading.type === 'proof' ? grading.referenceProof : undefined,
    grading.analysis,
    rubricCriteria.length > 0
      ? `${args.language === 'zh-CN' ? '结构化评分点' : 'Structured rubric'}:\n${JSON.stringify(
          rubricCriteria,
        )}`
      : undefined,
  ].filter(Boolean);

  const prompt = `${args.language === 'zh-CN' ? '题目' : 'Problem'}: ${
    isNotebookShortAnswerProblemRecord(args.problem) || isNotebookProofProblemRecord(args.problem)
      ? args.problem.publicContent.stem
      : ''
  }
${args.language === 'zh-CN' ? '满分' : 'Full marks'}: ${args.problem.points}
${rubricBits.length > 0 ? `${args.language === 'zh-CN' ? '评分参考' : 'Reference'}:\n${rubricBits.join('\n\n')}\n` : ''}${
    args.language === 'zh-CN' ? '学生答案' : 'Student answer'
  }: ${userAnswer}`;

  try {
    const llm = await callLLM(
      {
        model: args.model,
        system: systemPrompt,
        prompt,
      },
      'notebook-problem-text-grade',
    );
    const match = llm.text.trim().match(/\{[\s\S]*\}/);
    const parsed = match
      ? (JSON.parse(match[0]) as {
          score?: unknown;
          comment?: unknown;
          criteria?: Array<{ id?: unknown; earnedPoints?: unknown; evidence?: unknown }>;
        })
      : {};
    const criterionMaxById = new Map(
      rubricCriteria.map((criterion) => [criterion.id, criterion.points] as const),
    );
    const criterionScores = Array.isArray(parsed.criteria)
      ? parsed.criteria.flatMap((criterion) => {
          const id = String(criterion.id ?? '');
          const maximum = criterionMaxById.get(id);
          if (maximum == null) return [];
          return [Math.max(0, Math.min(maximum, Number(criterion.earnedPoints) || 0))];
        })
      : [];
    const rawScore =
      rubricCriteria.length > 0 && criterionScores.length === rubricCriteria.length
        ? criterionScores.reduce((total, value) => total + value, 0)
        : Number(parsed.score) || 0;
    const score = Math.max(0, Math.min(args.problem.points, rawScore));
    return {
      status: scoreToStatus(score, args.problem.points),
      score,
      result: {
        correct: score >= Math.max(1, Math.round(args.problem.points * 0.8)),
        feedback: String(parsed.comment || ''),
        analysis: grading.analysis,
        earnedPoints: score,
        publicCases: [],
      },
    };
  } catch (error) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          error instanceof Error
            ? error.message
            : args.language === 'zh-CN'
              ? '评分服务暂时不可用。'
              : 'Grading is temporarily unavailable.',
        analysis: grading.analysis,
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }
}

export async function evaluateNotebookNonCodeProblem(args: {
  problem: NotebookProblemRecord;
  answer: NotebookProblemAttemptAnswer;
  model?: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{
  status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
  score: number;
  result: NotebookProblemAttemptResult;
}> {
  const { problem, answer } = args;
  const imageAnswers = answer.images ?? [];
  const photoOnlyAnswer = imageAnswers.length > 0 && !(answer.text ?? '').trim();

  if (
    photoOnlyAnswer &&
    (isNotebookCalculationProblemRecord(problem) ||
      isNotebookShortAnswerProblemRecord(problem) ||
      isNotebookProofProblemRecord(problem))
  ) {
    return {
      status: 'pending',
      score: 0,
      result: {
        correct: null,
        feedback:
          args.language === 'zh-CN'
            ? `已收到 ${imageAnswers.length} 张照片答案，需要教师人工查看。`
            : `${imageAnswers.length} photo answer(s) received. Manual review is needed.`,
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  if (isNotebookChoiceProblemRecord(problem)) {
    const selected = (answer.selectedOptionIds ?? []).map((item) => item.trim()).filter(Boolean);
    const correct = arraysEqual(selected, problem.grading.correctOptionIds);
    const score = correct ? problem.points : 0;
    return {
      status: correct ? 'passed' : 'failed',
      score,
      result: {
        correct,
        feedback: correct
          ? args.language === 'zh-CN'
            ? '回答正确。'
            : 'Correct.'
          : args.language === 'zh-CN'
            ? '回答不正确。'
            : 'Incorrect.',
        analysis: problem.grading.analysis,
        earnedPoints: score,
        publicCases: [],
      },
    };
  }

  if (isNotebookFillBlankProblemRecord(problem)) {
    const filled = answer.blanks ?? {};
    const correctBlanks = problem.grading.blanks.filter((blank) => {
      const userValue = filled[blank.id] || '';
      return blank.acceptedAnswers.some((candidate) => {
        if (blank.matcher === 'numeric_tolerance') {
          const actual = extractNumericValue(userValue);
          const expected = extractNumericValue(candidate);
          return (
            actual != null &&
            expected != null &&
            Math.abs(actual - expected) <= (blank.tolerance ?? 0)
          );
        }
        if (blank.matcher === 'exact' || blank.caseSensitive) {
          return userValue.trim() === candidate.trim();
        }
        return normalizeText(userValue) === normalizeText(candidate);
      });
    }).length;
    const total = problem.grading.blanks.length;
    const score = total > 0 ? (problem.points * correctBlanks) / total : 0;
    return {
      status: scoreToStatus(score, problem.points),
      score,
      result: {
        correct: correctBlanks === total,
        feedback:
          args.language === 'zh-CN'
            ? `答对 ${correctBlanks}/${total} 个空。`
            : `Filled ${correctBlanks}/${total} blanks correctly.`,
        analysis: problem.grading.analysis,
        earnedPoints: score,
        publicCases: [],
      },
    };
  }

  if (isNotebookCalculationProblemRecord(problem)) {
    const submitted = answer.text?.trim() || '';
    const accepted = [
      ...(problem.grading.referenceAnswer ? [problem.grading.referenceAnswer] : []),
      ...problem.grading.acceptedForms,
    ];
    if (accepted.length === 0) {
      return {
        status: 'pending',
        score: 0,
        result: {
          correct: null,
          feedback:
            args.language === 'zh-CN'
              ? '这道计算题缺少标准答案，已记录作答并等待人工判分。'
              : 'This calculation problem has no reference answer. The response was saved for manual grading.',
          earnedPoints: 0,
          publicCases: [],
        },
      };
    }
    const directMatch = accepted.some(
      (candidate) => normalizeText(candidate) === normalizeText(submitted),
    );
    let numericMatch = false;
    if (
      !directMatch &&
      (typeof problem.grading.tolerance === 'number' ||
        typeof problem.grading.relativeTolerance === 'number')
    ) {
      const userNumeric = extractNumericValue(submitted);
      numericMatch = accepted.some((candidate) => {
        const expectedNumeric = extractNumericValue(candidate);
        if (userNumeric == null || expectedNumeric == null) return false;
        const difference = Math.abs(userNumeric - expectedNumeric);
        const absoluteMatch =
          typeof problem.grading.tolerance === 'number' &&
          difference <= problem.grading.tolerance;
        const relativeMatch =
          typeof problem.grading.relativeTolerance === 'number' &&
          difference <= Math.abs(expectedNumeric) * problem.grading.relativeTolerance;
        return absoluteMatch || relativeMatch;
      });
    }
    const correct = directMatch || numericMatch;
    const score = correct ? problem.points : 0;
    return {
      status: correct ? 'passed' : 'failed',
      score,
      result: {
        correct,
        feedback: correct
          ? args.language === 'zh-CN'
            ? '计算结果正确。'
            : 'Correct.'
          : args.language === 'zh-CN'
            ? '计算结果不正确。'
            : 'Incorrect.',
        analysis: problem.grading.analysis,
        earnedPoints: score,
        publicCases: [],
      },
    };
  }

  if (isNotebookShortAnswerProblemRecord(problem) || isNotebookProofProblemRecord(problem)) {
    if (!args.model) {
      return {
        status: 'error',
        score: 0,
        result: {
          correct: false,
          feedback:
            args.language === 'zh-CN'
              ? '当前没有可用模型，无法批改文本题。'
              : 'No model is available to grade this text response.',
          earnedPoints: 0,
          publicCases: [],
        },
      };
    }
    return gradeNotebookTextProblem({
      problem,
      answer,
      model: args.model,
      language: args.language,
    });
  }

  return {
    status: 'error',
    score: 0,
    result: {
      correct: false,
      feedback:
        args.language === 'zh-CN'
          ? '该题型需要专用评测流程。'
          : 'This problem type requires a dedicated evaluation flow.',
      earnedPoints: 0,
      publicCases: [],
    },
  };
}
