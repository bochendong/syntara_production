import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const TOKEN_VERSION = 'openai-upload-v1';
const UPLOAD_TOKEN_TTL_MS = 65 * 60 * 1_000;
const FILE_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;

export const openAIUploadIntentSchema = z.enum([
  'course_source',
  'teacher_source',
  'problem_bank_source',
  'chat_attachment',
]);
export type OpenAIUploadIntent = z.infer<typeof openAIUploadIntentSchema>;

const commonSchema = z.object({
  version: z.literal(1),
  userId: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(160),
  bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  intent: openAIUploadIntentSchema,
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

const uploadPayloadSchema = commonSchema
  .extend({
    kind: z.literal('upload'),
    uploadId: z
      .string()
      .trim()
      .regex(/^upload_[A-Za-z0-9_-]+$/),
  })
  .strict();

const filePayloadSchema = commonSchema
  .extend({
    kind: z.literal('file'),
    fileId: z
      .string()
      .trim()
      .regex(/^file-[A-Za-z0-9_-]+$/),
  })
  .strict();

export type OpenAIUploadCapability = z.infer<typeof uploadPayloadSchema>;
export type OpenAIFileCapability = z.infer<typeof filePayloadSchema>;

function signingKey(): Buffer | null {
  const configured = process.env.NEXTAUTH_SECRET?.trim() || '';
  if (configured.length >= 32) {
    return createHash('sha256').update(`syntara-openai-upload\0${configured}`).digest();
  }
  if (process.env.NODE_ENV === 'production') return null;
  const localSeed =
    process.env.ADMIN_LOGIN_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    '';
  return localSeed
    ? createHash('sha256').update(`syntara-local-openai-upload\0${localSeed}`).digest()
    : null;
}

function sign(unsignedToken: string): Buffer | null {
  const key = signingKey();
  return key ? createHmac('sha256', key).update(unsignedToken).digest() : null;
}

function issueToken(payload: OpenAIUploadCapability | OpenAIFileCapability): string | null {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${TOKEN_VERSION}.${encoded}`;
  const signature = sign(unsignedToken);
  return signature ? `${unsignedToken}.${signature.toString('base64url')}` : null;
}

function verifyToken(token: string): unknown | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const unsignedToken = `${parts[0]}.${parts[1]}`;
  const expected = sign(unsignedToken);
  if (!expected) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function isCurrent(args: { userId: string; issuedAt: number; expiresAt: number }, ttl: number) {
  const now = Date.now();
  return (
    args.userId.trim().length > 0 &&
    args.issuedAt <= now + 30_000 &&
    args.expiresAt > now &&
    args.expiresAt - args.issuedAt === ttl
  );
}

export function issueOpenAIUploadCapability(
  args: Omit<OpenAIUploadCapability, 'version' | 'kind' | 'issuedAt' | 'expiresAt'>,
): string | null {
  const issuedAt = Date.now();
  const parsed = uploadPayloadSchema.safeParse({
    ...args,
    version: 1,
    kind: 'upload',
    issuedAt,
    expiresAt: issuedAt + UPLOAD_TOKEN_TTL_MS,
  });
  return parsed.success ? issueToken(parsed.data) : null;
}

export function verifyOpenAIUploadCapability(args: {
  token: string;
  userId: string;
  uploadId?: string;
}): OpenAIUploadCapability | null {
  const parsed = uploadPayloadSchema.safeParse(verifyToken(args.token));
  if (!parsed.success || !isCurrent(parsed.data, UPLOAD_TOKEN_TTL_MS)) return null;
  if (parsed.data.userId !== args.userId.trim()) return null;
  if (args.uploadId && parsed.data.uploadId !== args.uploadId) return null;
  return parsed.data;
}

export function issueOpenAIFileCapability(
  args: Omit<OpenAIFileCapability, 'version' | 'kind' | 'issuedAt' | 'expiresAt'>,
): string | null {
  const issuedAt = Date.now();
  const parsed = filePayloadSchema.safeParse({
    ...args,
    version: 1,
    kind: 'file',
    issuedAt,
    expiresAt: issuedAt + FILE_TOKEN_TTL_MS,
  });
  return parsed.success ? issueToken(parsed.data) : null;
}

export function verifyOpenAIFileCapability(args: {
  token: string;
  userId: string;
  intents?: OpenAIUploadIntent[];
}): OpenAIFileCapability | null {
  const parsed = filePayloadSchema.safeParse(verifyToken(args.token));
  if (!parsed.success || !isCurrent(parsed.data, FILE_TOKEN_TTL_MS)) return null;
  if (parsed.data.userId !== args.userId.trim()) return null;
  if (args.intents && !args.intents.includes(parsed.data.intent)) return null;
  return parsed.data;
}
