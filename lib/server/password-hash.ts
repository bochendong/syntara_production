import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_VERSION = 'scrypt-v1';
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const normalized = password.normalize('NFKC');
  if (normalized.length < 10) throw new Error('密码至少需要 10 个字符。');
  if (normalized.length > 200) throw new Error('密码不能超过 200 个字符。');
  const salt = randomBytes(16);
  const derived = (await scrypt(normalized, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return [PASSWORD_HASH_VERSION, salt.toString('base64url'), derived.toString('base64url')].join(
    '$',
  );
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [version, saltValue, hashValue] = encodedHash.split('$');
  if (version !== PASSWORD_HASH_VERSION || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = (await scrypt(
      password.normalize('NFKC'),
      Buffer.from(saltValue, 'base64url'),
      expected.length,
    )) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
