const PHONE_DIGIT_MIN = 7;
const PHONE_DIGIT_MAX = 15;

export type ParsedPhoneNumber = { ok: true; value: string | null } | { ok: false; error: string };

export function parsePhoneNumber(input: unknown): ParsedPhoneNumber {
  if (typeof input !== 'string') return { ok: false, error: '请输入有效的手机号。' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };

  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < PHONE_DIGIT_MIN || digits.length > PHONE_DIGIT_MAX) {
    return { ok: false, error: '手机号应包含 7–15 位数字。' };
  }
  return { ok: true, value: `${hasLeadingPlus ? '+' : ''}${digits}` };
}

export function phoneLastFour(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, '') || '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}
