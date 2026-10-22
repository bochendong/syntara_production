import { createHmac, timingSafeEqual } from 'node:crypto';

export const NATIVE_SPEEDUP_COOKIE = '__Host-syntara-native-speedup';
export const NATIVE_SPEEDUP_STATE_SECONDS = 600;

function stateSecret(): string {
  const secret =
    process.env.SYNTARA_NATIVE_AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || '';
  if (secret.length < 32) throw new Error('Native authentication is not configured.');
  return secret;
}

export function createNativeSpeedupState(
  userCode: string,
  secret = stateSecret(),
  now = Date.now(),
) {
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) throw new Error('Invalid device code.');
  const payload = Buffer.from(JSON.stringify({ userCode, issuedAt: now })).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`native-speedup:${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function readNativeSpeedupState(
  value: string,
  secret = stateSecret(),
  now = Date.now(),
): string | null {
  if (value.length > 1_024) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac('sha256', secret).update(`native-speedup:${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.userCode === 'string' &&
      /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(decoded.userCode) &&
      typeof decoded.issuedAt === 'number' &&
      decoded.issuedAt <= now &&
      now - decoded.issuedAt < NATIVE_SPEEDUP_STATE_SECONDS * 1_000
      ? decoded.userCode
      : null;
  } catch {
    return null;
  }
}
