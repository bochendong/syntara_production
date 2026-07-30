import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { LearnTurnDecision } from '@/features/learn-core/domain/types';
import type {
  CourseChatAnswererHandoff,
  CourseChatAnswererHandoffEvidence,
} from '@/lib/types/chat';

const TOKEN_VERSION = 'learn-handoff-v1';
const TOKEN_TTL_MS = 10 * 60 * 1_000;
const MAX_TOKEN_CHARS = 24_000;

const evidenceSchema = z
  .object({
    sourceType: z.string().trim().min(1).max(80),
    sourceId: z.string().trim().min(1).max(240).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    quoteOrSummary: z.string().trim().max(650),
    supports: z.string().trim().max(500),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const resourceStatesSchema = z
  .object({
    notebooks: z.enum(['loading', 'ready', 'empty', 'error', 'unknown']),
    problems: z.enum(['loading', 'ready', 'empty', 'error', 'unknown']),
    sources: z.enum(['loading', 'ready', 'empty', 'error', 'unknown']),
  })
  .strict();

const answererHandoffSchema = z
  .object({
    runId: z.string().trim().min(1).max(240),
    intent: z.string().trim().min(1).max(120),
    reasonSummary: z.string().trim().min(1).max(1_000),
    evidence: z.array(evidenceSchema).max(8),
    requiredBehavior: z.array(z.string().trim().min(1).max(500)).max(12),
    forbiddenBehavior: z.array(z.string().trim().min(1).max(500)).max(12),
    missingEvidence: z.array(z.string().trim().min(1).max(500)).max(12),
    resourceStates: resourceStatesSchema.optional(),
  })
  .strict();

const tokenPayloadSchema = z
  .object({
    version: z.literal(1),
    userId: z.string().trim().min(1).max(240),
    courseId: z.string().trim().min(1).max(240),
    questionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    handoff: answererHandoffSchema,
  })
  .strict();

function compactText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars).trimEnd();
}

function compactStrings(values: string[], maxItems: number): string[] {
  return Array.from(new Set(values.map((value) => compactText(value, 500)).filter(Boolean))).slice(
    0,
    maxItems,
  );
}

function normalizeQuestion(question: string): string {
  // Preserve indentation and internal whitespace so code submissions with the
  // same words but different structure cannot share a handoff capability.
  return question.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

function questionDigest(question: string): string {
  return createHash('sha256').update(normalizeQuestion(question)).digest('hex');
}

function signingKey(): Buffer | null {
  const configured = process.env.NEXTAUTH_SECRET?.trim() || '';
  if (configured.length >= 32) {
    return createHash('sha256').update(`syntara-learn-answerer-handoff\0${configured}`).digest();
  }

  if (process.env.NODE_ENV === 'production') return null;

  const localSeed =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GITHUB_CLIENT_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!localSeed) return null;
  return createHash('sha256').update(`syntara-local-learn-answerer-handoff\0${localSeed}`).digest();
}

function signature(unsignedToken: string): Buffer | null {
  const key = signingKey();
  return key ? createHmac('sha256', key).update(unsignedToken).digest() : null;
}

function safeEvidence(
  evidence: LearnTurnDecision['trace']['handoffs'][number]['evidence'][number],
): CourseChatAnswererHandoffEvidence | null {
  const quoteOrSummary = compactText(evidence.quoteOrSummary, 650);
  const supports = compactText(evidence.supports, 500);
  if (!quoteOrSummary && !supports) return null;
  return {
    sourceType: compactText(evidence.sourceType, 80) || 'system',
    sourceId: compactText(evidence.sourceId, 240) || undefined,
    title: compactText(evidence.title, 240) || undefined,
    quoteOrSummary,
    supports,
    confidence:
      typeof evidence.confidence === 'number'
        ? Math.max(0, Math.min(1, evidence.confidence))
        : undefined,
  };
}

function handoffFromDecision(decision: LearnTurnDecision): CourseChatAnswererHandoff | null {
  if (decision.answerMode !== 'course_answer') return null;
  const handoff = decision.trace.handoffs.find((candidate) => candidate.to === 'course_answerer');
  if (!handoff) return null;

  return {
    runId: compactText(decision.trace.runId, 240),
    intent: typeof handoff.intent === 'string' ? compactText(handoff.intent, 120) : 'course_answer',
    reasonSummary:
      compactText(handoff.reasonSummary, 1_000) ||
      'Learn-core routed this turn to the course answerer.',
    evidence: handoff.evidence
      .map(safeEvidence)
      .filter((item): item is CourseChatAnswererHandoffEvidence => Boolean(item))
      .slice(0, 8),
    requiredBehavior: compactStrings(handoff.requiredBehavior, 12),
    forbiddenBehavior: compactStrings(handoff.forbiddenBehavior, 12),
    missingEvidence: compactStrings(handoff.missingEvidence, 12),
    resourceStates: handoff.resourceStates
      ? {
          notebooks:
            handoff.resourceStates.notebooks === 'idle'
              ? 'unknown'
              : handoff.resourceStates.notebooks,
          problems:
            handoff.resourceStates.problems === 'idle'
              ? 'unknown'
              : handoff.resourceStates.problems,
          sources:
            handoff.resourceStates.sources === 'idle' ? 'unknown' : handoff.resourceStates.sources,
        }
      : undefined,
  };
}

export function issueTrustedLearnAnswererHandoff(args: {
  decision: LearnTurnDecision;
  userId: string;
  courseId: string | undefined;
  question: string;
  now?: number;
}): string | undefined {
  const handoff = handoffFromDecision(args.decision);
  const userId = args.userId.trim();
  const courseId = args.courseId?.trim() || '';
  const question = normalizeQuestion(args.question);
  if (!handoff || !userId || !courseId || !question) return undefined;

  const issuedAt = args.now ?? Date.now();
  const parsedPayload = tokenPayloadSchema.safeParse({
    version: 1,
    userId,
    courseId,
    questionDigest: questionDigest(question),
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_MS,
    handoff,
  });
  if (!parsedPayload.success) return undefined;
  const payload = parsedPayload.data;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${TOKEN_VERSION}.${encodedPayload}`;
  const signed = signature(unsignedToken);
  return signed ? `${unsignedToken}.${signed.toString('base64url')}` : undefined;
}

export function verifyTrustedLearnAnswererHandoff(args: {
  token: string | undefined;
  userId: string;
  courseId: string;
  question: string;
  now?: number;
}): CourseChatAnswererHandoff | undefined {
  const token = args.token?.trim() || '';
  if (!token || token.length > MAX_TOKEN_CHARS) return undefined;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return undefined;
  const unsignedToken = `${parts[0]}.${parts[1]}`;
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[2], 'base64url');
  } catch {
    return undefined;
  }
  const expectedSignature = signature(unsignedToken);
  if (
    !expectedSignature ||
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return undefined;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) return undefined;

  const now = args.now ?? Date.now();
  const payload = parsed.data;
  if (
    payload.userId !== args.userId.trim() ||
    payload.courseId !== args.courseId.trim() ||
    payload.questionDigest !== questionDigest(args.question) ||
    payload.issuedAt > now + 30_000 ||
    payload.expiresAt <= now ||
    payload.expiresAt - payload.issuedAt !== TOKEN_TTL_MS
  ) {
    return undefined;
  }
  return payload.handoff;
}
