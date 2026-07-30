import type { NextRequest } from 'next/server';

import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';

export interface GradeQuizAnswerInput {
  question: string;
  userAnswer: string;
  points: number;
  commentPrompt?: string;
  language?: string;
  questionType?: 'short_answer' | 'proof' | 'code_tracing';
  referenceAnswer?: string;
  proof?: string;
  analysis?: string;
}

export interface GradeQuizAnswerResult {
  score: number;
  comment: string;
}

function getQuestionTypeLabel(
  questionType: GradeQuizAnswerInput['questionType'],
  isZh: boolean,
): string {
  if (questionType === 'proof') return isZh ? '证明题' : 'proof question';
  if (questionType === 'code_tracing') return isZh ? '代码追踪题' : 'code tracing question';
  return isZh ? '简答题' : 'short-answer question';
}

function buildGradePrompts(input: GradeQuizAnswerInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const isZh = input.language === 'zh-CN';
  const questionTypeLabel = getQuestionTypeLabel(input.questionType, isZh);

  const systemPrompt = isZh
    ? `你是一位专业的教育评估专家。你正在评分一道${questionTypeLabel}。请根据题目、参考信息和学生答案进行评分并给出简短评语。
必须以如下 JSON 格式回复（不要包含其他内容）：
{"score": <0到${input.points}的整数>, "comment": "<一两句评语>"}`
    : `You are a professional educational assessor. You are grading a ${questionTypeLabel}. Grade the student's answer using the question and reference material, then provide brief feedback.
You must reply in the following JSON format only (no other content):
{"score": <integer from 0 to ${input.points}>, "comment": "<one or two sentences of feedback>"}`;

  const userPrompt = isZh
    ? `题目：${input.question}
题型：${questionTypeLabel}
满分：${input.points}分
${input.commentPrompt ? `评分要点：${input.commentPrompt}\n` : ''}${input.referenceAnswer ? `参考答案：${input.referenceAnswer}\n` : ''}${input.proof ? `参考证明：${input.proof}\n` : ''}${input.analysis ? `解析：${input.analysis}\n` : ''}学生答案：${input.userAnswer}`
    : `Question: ${input.question}
Question type: ${questionTypeLabel}
Full marks: ${input.points} points
${input.commentPrompt ? `Grading guidance: ${input.commentPrompt}\n` : ''}${input.referenceAnswer ? `Reference answer: ${input.referenceAnswer}\n` : ''}${input.proof ? `Reference proof: ${input.proof}\n` : ''}${input.analysis ? `Analysis: ${input.analysis}\n` : ''}Student answer: ${input.userAnswer}`;

  return { systemPrompt, userPrompt };
}

function parseGradeResponse(text: string, input: GradeQuizAnswerInput): GradeQuizAnswerResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI grading response did not contain a JSON object.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('AI grading response contained invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI grading response must be a JSON object.');
  }

  const { score, comment } = parsed as Record<string, unknown>;
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > input.points
  ) {
    throw new Error(`AI grading score must be an integer from 0 to ${input.points}.`);
  }
  if (typeof comment !== 'string' || !comment.trim()) {
    throw new Error('AI grading comment must be a non-empty string.');
  }
  if (comment.trim().length > 2_000) {
    throw new Error('AI grading comment exceeded the maximum length.');
  }

  return {
    score,
    comment: comment.trim(),
  };
}

export async function gradeQuizAnswer(
  input: GradeQuizAnswerInput,
  request: NextRequest,
): Promise<GradeQuizAnswerResult> {
  if (!Number.isInteger(input.points) || input.points < 1 || input.points > 100) {
    throw new Error('Grading points must be an integer from 1 to 100.');
  }
  const { model: languageModel } = await resolveModelFromHeaders(request);
  const { systemPrompt, userPrompt } = buildGradePrompts(input);
  const result = await runWithRequestContext(request, '/api/quiz-grade', () =>
    callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'quiz-grade',
    ),
  );

  return parseGradeResponse(result.text.trim(), input);
}
