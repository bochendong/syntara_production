import { nanoid } from 'nanoid';
import type { GeneratedQuizContent, SceneOutline } from '@/lib/types/generation';
import type { QuizQuestion } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';
import type { AICallFn, CoursePersonalizationContext } from './pipeline-types';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { parseJsonResponse } from './json-repair';
import { formatCoursePersonalizationForPrompt } from './prompt-formatters';
import { hasUnexpectedCjkForLanguage } from './language-guard';

const log = createLogger('Generation');

export async function generateQuizContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  courseContext?: CoursePersonalizationContext,
): Promise<GeneratedQuizContent | null> {
  const lang = outline.language || 'zh-CN';
  const quizConfig = outline.quizConfig || {
    questionCount: 3,
    difficulty: 'medium',
    questionTypes: ['single'],
  };

  const prompts = buildPrompt(PROMPT_IDS.QUIZ_CONTENT, {
    language: lang,
    title: outline.title,
    description: outline.description,
    keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
    questionCount: quizConfig.questionCount,
    difficulty: quizConfig.difficulty,
    questionTypes: quizConfig.questionTypes.join(', '),
    coursePersonalization: formatCoursePersonalizationForPrompt(courseContext, lang),
  });

  if (!prompts) {
    return null;
  }

  log.debug(`Generating quiz content for: ${outline.title}`);
  const response = await aiCall(prompts.system, prompts.user);
  const generatedQuestions = parseJsonResponse<QuizQuestion[]>(response);

  if (!generatedQuestions || !Array.isArray(generatedQuestions)) {
    log.error(`Failed to parse AI response for: ${outline.title}`);
    return null;
  }
  if (hasUnexpectedCjkForLanguage(generatedQuestions, lang)) {
    log.warn(`Quiz content language mismatch for: ${outline.title}`);
    return null;
  }

  log.debug(`Got ${generatedQuestions.length} questions for: ${outline.title}`);

  const questions: QuizQuestion[] = generatedQuestions.map((q) => {
    const normalizedType = normalizeQuizQuestionType(q.type);
    const hasOptions =
      normalizedType !== 'short_answer' && normalizedType !== 'proof' && normalizedType !== 'code';
    const normalizedOptions = hasOptions ? normalizeQuizOptions(q.options) : undefined;
    return {
      ...q,
      type: normalizedType,
      id: q.id || `q_${nanoid(8)}`,
      language: q.type === 'code' || q.language === 'python' ? 'python' : undefined,
      options: normalizedOptions,
      answer: normalizeQuestionAnswer(
        q as unknown as Record<string, unknown>,
        normalizedType,
        normalizedOptions,
      ),
      correctAnswer: normalizeCorrectAnswer(
        q as unknown as Record<string, unknown>,
        normalizedType,
        normalizedOptions,
      ),
      hasAnswer: resolveQuestionHasAnswer(
        q as unknown as Record<string, unknown>,
        normalizedType,
        normalizedOptions,
      ),
      testCases: normalizeQuizTestCases((q as { testCases?: unknown[] }).testCases),
    };
  });

  return { questions };
}

function normalizeQuizOptions(
  options: unknown[] | undefined,
): { value: string; label: string }[] | undefined {
  if (!options || !Array.isArray(options)) return undefined;

  return options.map((opt, index) => {
    const letter = String.fromCharCode(65 + index);

    if (typeof opt === 'string') {
      return { value: letter, label: opt };
    }

    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      return {
        value: typeof obj.value === 'string' ? obj.value : letter,
        label: typeof obj.label === 'string' ? obj.label : String(obj.value || obj.text || letter),
      };
    }

    return { value: letter, label: String(opt) };
  });
}

function normalizeQuizQuestionType(type: unknown): QuizQuestion['type'] {
  const raw = typeof type === 'string' ? type : 'single';
  if (raw === 'text') return 'short_answer';
  if (raw === 'multiple_choice') return 'multiple_choice';
  if (raw === 'proof') return 'proof';
  if (raw === 'code_tracing') return 'code_tracing';
  if (raw === 'code') return 'code';
  if (raw === 'short_answer') return 'short_answer';
  if (raw === 'multiple') return 'multiple';
  return 'single';
}

function normalizeQuestionAnswer(
  question: Record<string, unknown>,
  type: QuizQuestion['type'],
  options?: { value: string; label: string }[],
): string | string[] | undefined {
  const raw = question.answer ?? question.correctAnswer ?? question.correct_answer;
  if (raw == null) return undefined;

  if (type === 'short_answer' || type === 'proof') {
    if (Array.isArray(raw)) {
      return raw.map(String).join('\n');
    }
    return String(raw);
  }

  if (type === 'code') {
    return typeof raw === 'string' ? raw : undefined;
  }

  if (type === 'code_tracing' && (!options || options.length === 0)) {
    if (Array.isArray(raw)) {
      return raw.map(String).join('\n');
    }
    return String(raw);
  }

  const normalized = normalizeChoiceAnswerValues(raw, options);
  if (!normalized) return undefined;

  if (type === 'single' || type === 'multiple_choice') {
    return normalized[0];
  }
  return normalized;
}

function normalizeCorrectAnswer(
  question: Record<string, unknown>,
  type: QuizQuestion['type'],
  options?: { value: string; label: string }[],
): string | string[] | undefined {
  const raw = question.correctAnswer ?? question.answer ?? question.correct_answer;
  if (raw == null) return undefined;

  if (type === 'short_answer' || type === 'proof' || type === 'code') {
    if (Array.isArray(raw)) return raw.map(String).join('\n');
    return String(raw);
  }

  if (type === 'code_tracing' && (!options || options.length === 0)) {
    if (Array.isArray(raw)) return raw.map(String).join('\n');
    return String(raw);
  }

  const normalized = normalizeChoiceAnswerValues(raw, options);
  if (!normalized) return undefined;
  if (type === 'single' || type === 'multiple_choice') return normalized[0];
  return normalized;
}

function normalizeChoiceAnswerValues(
  raw: unknown,
  options?: { value: string; label: string }[],
): string[] | undefined {
  const list = Array.isArray(raw) ? raw : [raw];
  const normalized = list
    .map((entry) => normalizeChoiceAnswerValue(entry, options))
    .filter((value): value is string => Boolean(value));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeChoiceAnswerValue(
  raw: unknown,
  options?: { value: string; label: string }[],
): string | null {
  const optionValues = options?.map((opt) => String(opt.value).toUpperCase()) ?? [];
  const optionLabels = options?.map((opt) => opt.label.trim()) ?? [];

  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return optionValues[raw] ?? null;
  }

  const text = String(raw).trim();
  if (!text) return null;

  const upper = text.toUpperCase();
  if (upper.length === 1 && optionValues.includes(upper)) {
    return upper;
  }

  const directIndex = optionLabels.findIndex((label) => label === text);
  if (directIndex >= 0) {
    return optionValues[directIndex] ?? null;
  }

  const prefixedIndex = optionLabels.findIndex(
    (label, idx) => `${optionValues[idx]}. ${label}` === text,
  );
  if (prefixedIndex >= 0) {
    return optionValues[prefixedIndex] ?? null;
  }

  const letterMatch = upper.match(/\b([A-Z])\b/);
  if (letterMatch && optionValues.includes(letterMatch[1])) {
    return letterMatch[1];
  }

  return null;
}

function resolveQuestionHasAnswer(
  question: Record<string, unknown>,
  type: QuizQuestion['type'],
  options?: { value: string; label: string }[],
): boolean {
  if (typeof question.hasAnswer === 'boolean') return question.hasAnswer;
  if (type === 'short_answer' || type === 'proof') return false;
  if (type === 'code') return true;
  if (type === 'code_tracing') return !!options?.length;
  return true;
}

function normalizeQuizTestCases(
  testCases: unknown[] | undefined,
): QuizQuestion['testCases'] | undefined {
  if (!Array.isArray(testCases) || testCases.length === 0) return undefined;

  return testCases
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const expression =
        typeof obj.expression === 'string'
          ? obj.expression
          : typeof obj.input === 'string'
            ? obj.input
            : undefined;
      const expected =
        typeof obj.expected === 'string'
          ? obj.expected
          : obj.output != null
            ? JSON.stringify(obj.output)
            : undefined;

      if (!expression || !expected) return null;

      return {
        id: typeof obj.id === 'string' ? obj.id : `case_${index + 1}`,
        description: typeof obj.description === 'string' ? obj.description : undefined,
        expression,
        expected,
        hidden: Boolean(obj.hidden),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
