import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_STUDENT_PREVIEW_COOKIE = 'syntara-admin-student-preview';
const PREVIEW_TTL_MS = 4 * 60 * 60 * 1000;

function previewSecret(): string {
  return (
    process.env.ADMIN_LOGIN_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.ADMIN_LOGIN_PASSWORD?.trim() ||
    ''
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueAdminStudentPreviewToken(studentId: string): string | null {
  const secret = previewSecret();
  const normalizedStudentId = studentId.trim();
  if (!secret || !normalizedStudentId) return null;
  const payload = Buffer.from(
    JSON.stringify({ studentId: normalizedStudentId, exp: Date.now() + PREVIEW_TTL_MS }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export async function resolveAdminStudentPreviewId(): Promise<string | null> {
  const secret = previewSecret();
  if (!secret) return null;
  const token = (await cookies()).get(ADMIN_STUDENT_PREVIEW_COOKIE)?.value;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      studentId?: unknown;
      exp?: unknown;
    };
    return typeof parsed.studentId === 'string' &&
      parsed.studentId.trim() &&
      typeof parsed.exp === 'number' &&
      parsed.exp > Date.now()
      ? parsed.studentId.trim()
      : null;
  } catch {
    return null;
  }
}
