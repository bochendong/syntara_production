import type { LanguageModel } from 'ai';
import { callLLM } from '@/lib/ai/llm';
import type { NotebookProblemImportDraft } from '@/lib/problem-bank';
import { parseJsonObject, usageOf } from './import.figures';
import type { ImportUsageSummary } from './import.core.types';
import { mergeImportUsage } from './import.core.usage';

/**
 * Independent answer check for imported problems. A second model call sees only what
 * a student sees (stem, options, blanks, attached figures) — never the stored answer —
 * and solves from scratch. Objective answers are compared in code; open answers are
 * compared by a separate judge call. Disagreement, missing givens, or a stem that
 * gives the answer away become review issues instead of silently shipping.
 */

const VERIFY_CONCURRENCY = 4;

export type AnswerVerification = {
  verdict: 'agree' | 'disagree' | 'unsolvable' | 'skipped' | 'error';
  issues: string[];
  independentAnswer?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numericValue(value: string): number | null {
  const cleaned = value
    .replace(/\\[,!;: ]/g, '')
    .replace(/\\(?:text|mathrm)\{[^}]*\}/g, '')
    .replace(/[$\s,]/g, '')
    .replace(/\\%|%$/, '');
  const fraction = cleaned.match(/^\\d?frac\{(-?[\d.]+)\}\{(-?[\d.]+)\}$/);
  if (fraction) {
    const value = Number(fraction[1]) / Number(fraction[2]);
    return Number.isFinite(value) ? value : null;
  }
  const match = cleaned.match(/^[=≈]?(-?\d+(?:\.\d+)?(?:e-?\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/[\s$`'"“”‘’.,，。;；:：()（）\\{}]/g, '');
}

function numbersAgree(left: number, right: number, tolerance?: number, relative?: number) {
  const absolute = tolerance ?? 0;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-9);
  // Report-rounded sources commonly differ in the third significant figure.
  const rel = relative ?? 0.01;
  return Math.abs(left - right) <= Math.max(absolute, rel * scale);
}

function valueMatches(candidate: string, accepted: string[], tolerance?: number): boolean {
  const candidateNumber = numericValue(candidate);
  for (const answer of accepted) {
    const acceptedNumber = numericValue(answer);
    if (candidateNumber !== null && acceptedNumber !== null) {
      if (numbersAgree(candidateNumber, acceptedNumber, tolerance)) return true;
      continue;
    }
    if (normalizeText(candidate) === normalizeText(answer)) return true;
  }
  return false;
}

function studentFacingContent(draft: NotebookProblemImportDraft): string {
  const content = draft.publicContent;
  const parts: string[] = [`Title: ${draft.title}`];
  if ('stem' in content && content.stem) parts.push(`Problem:\n${content.stem}`);
  if (content.type === 'fill_blank') {
    parts.push(`Problem (blanks marked {{id}}):\n${content.stemTemplate}`);
    parts.push(`Blank ids: ${content.blanks.map((blank) => blank.id).join(', ')}`);
  }
  if (content.type === 'choice') {
    parts.push(
      `Selection mode: ${content.selectionMode}\nOptions:\n${content.options
        .map((option) => `[${option.id}] ${option.label}`)
        .join('\n')}`,
    );
  }
  if (content.type === 'calculation' && content.unit) parts.push(`Answer unit: ${content.unit}`);
  return parts.join('\n\n');
}

function figureParts(draft: NotebookProblemImportDraft) {
  return (draft.publicContent.assets?.images ?? [])
    .filter((image) => image.role !== 'explanation')
    .slice(0, 6)
    .flatMap((image) => {
      const match = image.src.match(/^data:([^;]+);base64,(.+)$/);
      return match
        ? [
            { type: 'text' as const, text: `${image.caption ?? image.alt ?? 'Figure'}:` },
            {
              type: 'image' as const,
              image: Buffer.from(match[2]!, 'base64'),
              mediaType: match[1]!,
            },
          ]
        : [];
    });
}

function referenceSummary(draft: NotebookProblemImportDraft): string {
  const grading = draft.grading;
  switch (grading.type) {
    case 'short_answer':
      return grading.referenceAnswer ?? grading.rubric ?? '';
    case 'proof':
      return grading.referenceProof ?? grading.rubric ?? '';
    case 'calculation':
      return [grading.referenceAnswer, ...grading.acceptedForms].filter(Boolean).join(' | ');
    case 'choice':
      return grading.correctOptionIds.join(', ');
    case 'fill_blank':
      return grading.blanks
        .map((blank) => `${blank.id}: ${blank.acceptedAnswers.join(' / ')}`)
        .join('; ');
    default:
      return '';
  }
}

async function solveIndependently(args: {
  draft: NotebookProblemImportDraft;
  model: LanguageModel;
}) {
  const instruction = `Solve this problem from scratch exactly as a strong student would, using only the text and figures given here. Do not assume any answer is provided.

${studentFacingContent(args.draft)}

Return strict JSON only:
{"missingInformation": null or "what given/figure/table is missing so the problem cannot be answered as written",
 "answerGivenAwayInProblem": null or "quote of problem text that already states the result the student must find",
 "selectedOptionIds": ["..."] (choice problems only),
 "blanks": {"blank_id": "answer"} (fill-blank problems only),
 "finalAnswer": "final answer in the shortest form (number with unit, expression, or one-sentence conclusion)",
 "solution": "concise worked solution, max 120 words"}`;
  return callLLM(
    {
      model: args.model,
      system:
        'You are an independent expert solver checking an exam problem. Output machine-readable JSON only.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: instruction }, ...figureParts(args.draft)],
        },
      ],
      maxOutputTokens: 3000,
    },
    'problem-bank-import-independent-solve',
  );
}

async function judgeOpenAnswer(args: {
  draft: NotebookProblemImportDraft;
  model: LanguageModel;
  independent: string;
}) {
  const instruction = `Two solvers answered the same problem independently. Decide whether their final results agree in substance (equivalent values, conclusions, or structures). Ignore wording, method, and level of detail.

${studentFacingContent(args.draft)}

Answer A (stored reference):
${referenceSummary(args.draft).slice(0, 4000)}

Answer B (independent solve):
${args.independent.slice(0, 3000)}

Return strict JSON only: {"agree": true|false, "reason": "one sentence naming the specific disagreement, or empty"}`;
  return callLLM(
    {
      model: args.model,
      system: 'You compare two solutions for substantive agreement. Output JSON only.',
      messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
      maxOutputTokens: 400,
    },
    'problem-bank-import-answer-judge',
  );
}

export async function verifyDraftAnswer(args: {
  draft: NotebookProblemImportDraft;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{ result: AnswerVerification; usage: ImportUsageSummary | null }> {
  const { draft } = args;
  const zh = args.language === 'zh-CN';
  // Code problems are verified by executing the reference solution against tests.
  if (draft.type === 'code') return { result: { verdict: 'skipped', issues: [] }, usage: null };

  let usage: ImportUsageSummary | null = null;
  try {
    const solved = await solveIndependently({ draft, model: args.model });
    usage = mergeImportUsage(usage, usageOf(args.model, solved));
    const parsed = parseJsonObject(solved.text);
    if (!parsed) return { result: { verdict: 'error', issues: [] }, usage };

    const issues: string[] = [];
    const missing =
      typeof parsed.missingInformation === 'string' ? parsed.missingInformation.trim() : '';
    const leak =
      typeof parsed.answerGivenAwayInProblem === 'string'
        ? parsed.answerGivenAwayInProblem.trim()
        : '';
    if (leak) {
      issues.push(
        zh
          ? `题干可能已透露应由学生得出的结论：${leak.slice(0, 200)}`
          : `The stem may give away the result students must find: ${leak.slice(0, 200)}`,
      );
    }
    if (missing) {
      issues.push(
        zh
          ? `独立求解认为缺少作答条件：${missing.slice(0, 240)}`
          : `Independent solve reports missing givens: ${missing.slice(0, 240)}`,
      );
      return { result: { verdict: 'unsolvable', issues }, usage };
    }

    const finalAnswer = typeof parsed.finalAnswer === 'string' ? parsed.finalAnswer.trim() : '';
    let agree: boolean | null = null;
    let detail = '';
    const grading = draft.grading;

    if (grading.type === 'choice') {
      const selected = Array.isArray(parsed.selectedOptionIds)
        ? parsed.selectedOptionIds.filter((id): id is string => typeof id === 'string')
        : [];
      const expected = new Set(grading.correctOptionIds);
      agree =
        selected.length === expected.size && selected.every((optionId) => expected.has(optionId));
      detail = `${selected.join(', ') || '—'} vs ${grading.correctOptionIds.join(', ') || '—'}`;
    } else if (grading.type === 'fill_blank') {
      const answers = asRecord(parsed.blanks);
      const mismatched = grading.blanks.filter((blank) => {
        const candidate = answers[blank.id];
        return (
          typeof candidate !== 'string' ||
          !valueMatches(candidate, blank.acceptedAnswers, blank.tolerance)
        );
      });
      agree = mismatched.length === 0;
      detail = mismatched
        .map(
          (blank) =>
            `${blank.id}: ${String(answers[blank.id] ?? '—')} vs ${blank.acceptedAnswers[0]}`,
        )
        .join('; ');
    } else if (grading.type === 'calculation') {
      const accepted = [grading.referenceAnswer, ...grading.acceptedForms].filter(
        (value): value is string => Boolean(value),
      );
      const candidateNumber = numericValue(finalAnswer);
      if (candidateNumber !== null && accepted.some((value) => numericValue(value) !== null)) {
        agree = accepted.some((value) => {
          const expected = numericValue(value);
          return (
            expected !== null &&
            numbersAgree(candidateNumber, expected, grading.tolerance, grading.relativeTolerance)
          );
        });
        detail = `${finalAnswer} vs ${accepted[0]}`;
      }
    }

    if (agree === null) {
      const judged = await judgeOpenAnswer({
        draft,
        model: args.model,
        independent: `${finalAnswer}\n${typeof parsed.solution === 'string' ? parsed.solution : ''}`,
      });
      usage = mergeImportUsage(usage, usageOf(args.model, judged));
      const verdict = parseJsonObject(judged.text);
      if (!verdict || typeof verdict.agree !== 'boolean') {
        return { result: { verdict: 'error', issues, independentAnswer: finalAnswer }, usage };
      }
      agree = verdict.agree;
      detail = typeof verdict.reason === 'string' ? verdict.reason : '';
    }

    if (!agree) {
      issues.push(
        zh
          ? `独立复算与参考答案不一致，请人工核对：${detail.slice(0, 240)}`
          : `Independent solve disagrees with the reference answer; review it: ${detail.slice(0, 240)}`,
      );
    }
    return {
      result: {
        verdict: agree ? 'agree' : 'disagree',
        issues,
        independentAnswer: finalAnswer.slice(0, 500),
      },
      usage,
    };
  } catch {
    return { result: { verdict: 'error', issues: [] }, usage };
  }
}

export async function verifyDraftAnswers(args: {
  drafts: NotebookProblemImportDraft[];
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{ results: AnswerVerification[]; usage: ImportUsageSummary | null }> {
  const results: AnswerVerification[] = new Array(args.drafts.length);
  let usage: ImportUsageSummary | null = null;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, args.drafts.length) }, async () => {
      while (next < args.drafts.length) {
        const index = next++;
        const verified = await verifyDraftAnswer({
          draft: args.drafts[index]!,
          model: args.model,
          language: args.language,
        });
        results[index] = verified.result;
        usage = mergeImportUsage(usage, verified.usage);
      }
    }),
  );
  return { results, usage };
}
