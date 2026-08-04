import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const TOKEN_VERSION = 'chat-file-v1';
const TOKEN_TTL_MS = 75 * 60 * 1_000;

const payloadSchema = z
  .object({
    version: z.literal(1),
    userId: z.string().trim().min(1).max(240),
    fileId: z
      .string()
      .trim()
      .regex(/^file-[A-Za-z0-9_-]+$/),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type EphemeralChatFileTokenPayload = z.infer<typeof payloadSchema>;

function signingKey(): Buffer | null {
  const configured = process.env.NEXTAUTH_SECRET?.trim() || '';
  if (configured.length >= 32) {
    return createHash('sha256').update(`syntara-chat-file\0${configured}`).digest();
  }
  if (process.env.NODE_ENV === 'production') return null;
  const localSeed =
    process.env.ADMIN_LOGIN_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    '';
  return localSeed
    ? createHash('sha256').update(`syntara-local-chat-file\0${localSeed}`).digest()
    : null;
}

function sign(unsignedToken: string): Buffer | null {
  const key = signingKey();
  return key ? createHmac('sha256', key).update(unsignedToken).digest() : null;
}

export function issueEphemeralChatFileToken(args: {
  userId: string;
  fileId: string;
  now?: number;
}): string | null {
  const issuedAt = args.now ?? Date.now();
  const parsed = payloadSchema.safeParse({
    version: 1,
    userId: args.userId,
    fileId: args.fileId,
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_MS,
  });
  if (!parsed.success) return null;
  const encoded = Buffer.from(JSON.stringify(parsed.data)).toString('base64url');
  const unsignedToken = `${TOKEN_VERSION}.${encoded}`;
  const signature = sign(unsignedToken);
  return signature ? `${unsignedToken}.${signature.toString('base64url')}` : null;
}

export function verifyEphemeralChatFileToken(args: {
  token: string;
  userId: string;
  now?: number;
}): EphemeralChatFileTokenPayload | null {
  const parts = args.token.trim().split('.');
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

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const now = args.now ?? Date.now();
  if (
    parsed.data.userId !== args.userId.trim() ||
    parsed.data.issuedAt > now + 30_000 ||
    parsed.data.expiresAt <= now ||
    parsed.data.expiresAt - parsed.data.issuedAt !== TOKEN_TTL_MS
  ) {
    return null;
  }
  return parsed.data;
}
