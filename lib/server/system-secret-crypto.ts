import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENVELOPE_PREFIX = 'enc:v1';

function encryptionSecret(): string {
  const configured = process.env.SYSTEM_CONFIG_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') {
    const fallback =
      process.env.ADMIN_LOGIN_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || '';
    if (fallback) return fallback;
  }
  throw new Error('SYSTEM_CONFIG_ENCRYPTION_KEY 未配置，无法安全保存全站 API Key。');
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(encryptionSecret(), 'utf8').digest();
}

export function isEncryptedSystemSecret(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}:`);
}

export function encryptSystemSecret(plaintext: string): string {
  const normalized = plaintext.trim();
  if (!normalized) throw new Error('API Key 不能为空。');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSystemSecret(value: string): string {
  if (!isEncryptedSystemSecret(value)) return value.trim();
  const [prefix, version, ivValue, tagValue, ciphertextValue] = value.split(':');
  if (`${prefix}:${version}` !== ENVELOPE_PREFIX || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('系统 API Key 加密数据格式无效。');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
