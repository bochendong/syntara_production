import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  notebookProblemImportDraftSchema,
  type NotebookProblemImportDraft,
} from '@/lib/problem-bank/schema';
import { assembleCodeFromSlots, codeSlotTemplateFor } from '@/lib/problem-bank/code-slots';
import { multipartCodePartDrafts } from '@/lib/problem-bank/multipart';
import { codeReferenceSolution } from '@/lib/problem-bank/code-readiness';
import type { NotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';
import {
  judgeNotebookCodeProblem,
  verifyNotebookCodeDraftReferenceAnswer,
} from '@/lib/server/notebook-problems/judge';

const counterexampleSchema = z
  .object({
    id: z.string().min(1).max(80),
    part: z.string().min(1).max(40).optional(),
    code: z.string().min(1).max(30000),
    reason: z.string().min(1).max(500),
  })
  .strict();
export const codePreflightSchema = z
  .object({
    courseId: z.string().min(1).max(200),
    draft: notebookProblemImportDraftSchema,
    counterexamples: z.array(counterexampleSchema).min(1).max(24),
  })
  .strict();
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
export function codeDraftFingerprint(draft: NotebookProblemImportDraft) {
  return createHash('sha256').update(stable(draft)).digest('hex');
}
function secret() {
  const value = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('Code preflight signing is unavailable');
  return value;
}
export function signCodePreflight(args: {
  courseId: string;
  userId: string;
  keyId: string;
  draft: NotebookProblemImportDraft;
  now?: number;
}) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      courseId: args.courseId,
      userId: args.userId,
      keyId: args.keyId,
      draftFingerprint: codeDraftFingerprint(args.draft),
      expiresAt: (args.now ?? Date.now()) + 24 * 60 * 60 * 1000,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function verifyCodePreflight(
  token: string,
  args: {
    courseId: string;
    userId: string;
    keyId: string;
    draft: NotebookProblemImportDraft;
    now?: number;
    allowExpiredCommittedReplay?: boolean;
  },
) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const expected = createHmac('sha256', secret()).update(parts[0]).digest();
    const signature = Buffer.from(parts[1], 'base64url');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return (
      payload.v === 1 &&
      payload.courseId === args.courseId &&
      payload.userId === args.userId &&
      payload.keyId === args.keyId &&
      payload.draftFingerprint === codeDraftFingerprint(args.draft) &&
      Number.isSafeInteger(payload.expiresAt) &&
      (payload.expiresAt > (args.now ?? Date.now()) || args.allowExpiredCommittedReplay === true)
    );
  } catch {
    return false;
  }
}
async function validateSingleCodeQuestion(
  input: z.infer<typeof codePreflightSchema>,
  actor: { userId: string; keyId: string },
  courseIdentity?: NotebookProblemCourseIdentity,
) {
  const data = codePreflightSchema.parse(input);
  const draft = { ...data.draft, notebookId: null };
  if (
    draft.type !== 'code' ||
    draft.publicContent.type !== 'code' ||
    draft.grading.type !== 'code' ||
    !draft.secretJudge ||
    draft.notebookId ||
    draft.points !== 100 ||
    draft.validationErrors.length
  )
    throw new Error('Invalid executable question');
  const verified = await verifyNotebookCodeDraftReferenceAnswer(draft);
  const slots = codeSlotTemplateFor(draft.publicContent);
  const starter = slots
    ? assembleCodeFromSlots(
        slots.template,
        slots.slots,
        Object.fromEntries(
          slots.slots.map((slot) => [slot.id, slot.kind === 'expr' ? 'None' : '']),
        ),
      )
    : draft.publicContent.starterCode;
  const problem = {
    ...draft,
    id: draft.draftId,
    courseId: data.courseId,
    notebookId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  async function judge(code: string) {
    if (!code?.trim()) return { status: 'error', result: { feedback: 'Empty code' } };
    return judgeNotebookCodeProblem({
      problem,
      secretJudge: draft.secretJudge,
      userAnswer: { code },
      kind: 'submit',
      language: 'en-US',
      courseIdentity,
    });
  }
  const referenceResult = await judge(codeReferenceSolution(draft));
  const starterResult = await judge(starter ?? '');
  const counterexampleResults = [];
  for (const candidate of data.counterexamples)
    counterexampleResults.push({ id: candidate.id, ...(await judge(candidate.code)) });
  const rejected = (status: string) => status === 'failed' || status === 'partial';
  const starterRejected = rejected(starterResult.status);
  const incorrectRejected = counterexampleResults.every((x) => rejected(x.status));
  const referencePassed = verified.passed && referenceResult.status === 'passed';
  const valid = referencePassed && starterRejected && incorrectRejected;
  const validatedDraft = notebookProblemImportDraftSchema.parse({
    ...draft,
    publicContent: { ...draft.publicContent, secretConfigPresent: true },
    grading: { ...draft.grading, publishRequirementsMet: valid },
    sourceMeta: {
      ...draft.sourceMeta,
      codeVerification: {
        passed: valid,
        publicTestCount: verified.publicTestCount,
        secretTestCount: verified.secretTestCount,
        checkedBy: 'python-runner',
        exampleCount: draft.publicContent.sampleIO.length,
      },
    },
  });
  return {
    valid,
    checkedBy: 'python-runner',
    courseId: data.courseId,
    draftFingerprint: codeDraftFingerprint(validatedDraft),
    referencePassed,
    starterRejected,
    incorrectRejected,
    publicCases: verified.publicTestCount,
    privateCases: verified.secretTestCount,
    errors: verified.errors,
    referenceResult,
    starterResult,
    counterexampleResults,
    validatedDraft,
    ...(valid
      ? { proof: signCodePreflight({ ...actor, courseId: data.courseId, draft: validatedDraft }) }
      : {}),
  };
}

/** Validate every code part and bind one proof to the complete multipart payload. */
export async function validateCodeQuestion(
  input: z.infer<typeof codePreflightSchema>,
  actor: { userId: string; keyId: string },
  courseIdentity?: NotebookProblemCourseIdentity,
) {
  const data = codePreflightSchema.parse(input);
  if (data.draft.type !== 'multipart') {
    if (data.counterexamples.length > 2 || data.counterexamples.some((candidate) => candidate.part))
      throw new Error('Standalone code requires one or two unscoped counterexamples');
    return validateSingleCodeQuestion(data, actor, courseIdentity);
  }
  const codeParts = multipartCodePartDrafts(data.draft);
  const labels = new Set(codeParts.map((part) => part.label));
  if (
    !codeParts.length ||
    data.counterexamples.some((candidate) => !candidate.part || !labels.has(candidate.part))
  )
    throw new Error('Counterexamples must identify an existing code part');
  const reports: Array<{
    label: string;
    report: Awaited<ReturnType<typeof validateSingleCodeQuestion>>;
  }> = [];
  for (const part of codeParts) {
    const candidates = data.counterexamples.filter((candidate) => candidate.part === part.label);
    if (candidates.length < 1 || candidates.length > 2)
      throw new Error('Each code part requires one or two counterexamples');
    const report = await validateSingleCodeQuestion(
      { courseId: data.courseId, draft: part.draft, counterexamples: candidates },
      actor,
      courseIdentity,
    );
    reports.push({ label: part.label, report });
  }
  const valid = reports.every(({ report }) => report.valid);
  if (data.draft.publicContent.type !== 'multipart' || data.draft.grading.type !== 'multipart')
    throw new Error('Invalid multipart question');
  const validatedDraft = notebookProblemImportDraftSchema.parse({
    ...data.draft,
    publicContent: {
      ...data.draft.publicContent,
      parts: data.draft.publicContent.parts.map((part) => {
        const report = reports.find((item) => item.label === part.label)?.report;
        return report ? { ...part, content: report.validatedDraft.publicContent } : part;
      }),
    },
    grading: {
      ...data.draft.grading,
      parts: data.draft.grading.parts.map((part) => {
        const report = reports.find((item) => item.label === part.label)?.report;
        return report ? { ...part, grading: report.validatedDraft.grading } : part;
      }),
    },
    sourceMeta: {
      ...data.draft.sourceMeta,
      codeVerification: {
        passed: valid,
        checkedBy: 'python-runner',
        parts: Object.fromEntries(
          reports.map(({ label, report }) => [
            label,
            {
              passed: report.valid,
              publicTestCount: report.publicCases,
              secretTestCount: report.privateCases,
            },
          ]),
        ),
      },
    },
  });
  return {
    valid,
    checkedBy: 'python-runner',
    courseId: data.courseId,
    draftFingerprint: codeDraftFingerprint(validatedDraft),
    referencePassed: reports.every(({ report }) => report.referencePassed),
    starterRejected: reports.every(({ report }) => report.starterRejected),
    incorrectRejected: reports.every(({ report }) => report.incorrectRejected),
    publicCases: reports.reduce((sum, { report }) => sum + report.publicCases, 0),
    privateCases: reports.reduce((sum, { report }) => sum + report.privateCases, 0),
    errors: reports.flatMap(({ label, report }) =>
      report.errors.map((error) => `${label}: ${error}`),
    ),
    parts: reports,
    validatedDraft,
    ...(valid
      ? { proof: signCodePreflight({ ...actor, courseId: data.courseId, draft: validatedDraft }) }
      : {}),
  };
}
