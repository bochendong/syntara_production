import { randomInt } from 'node:crypto';

import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 3;
const CODE_GROUP_LENGTH = 4;
export const MAX_ACTIVATION_CODES_PER_BATCH = 200;

export class NativeActivationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: 'unavailable' | 'invalid_code' | 'already_used' | 'already_activated',
    message: string,
  ) {
    super(message);
    this.name = 'NativeActivationError';
  }
}

function activationPrisma() {
  const prisma = getOptionalPrisma();
  if (!prisma) {
    throw new NativeActivationError(503, 'unavailable', '数据库不可用，暂时无法使用激活码。');
  }
  return prisma;
}

function randomActivationCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < CODE_GROUPS; group += 1) {
    let value = '';
    for (let index = 0; index < CODE_GROUP_LENGTH; index += 1) {
      value += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    groups.push(value);
  }
  return `SNT-${groups.join('-')}`;
}

/** 接受大小写、空格和缺失的分隔符，统一成 SNT-XXXX-XXXX-XXXX。 */
export function normalizeActivationCode(value: string): string | null {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('SNT') ? compact.slice(3) : compact;
  if (body.length !== CODE_GROUPS * CODE_GROUP_LENGTH) return null;
  if ([...body].some((char) => !CODE_ALPHABET.includes(char))) return null;
  const groups = body.match(new RegExp(`.{${CODE_GROUP_LENGTH}}`, 'g')) ?? [];
  return `SNT-${groups.join('-')}`;
}

/** 管理员和兑换过激活码的账号可以使用 App。 */
export function hasNativeAppAccess(user: {
  role: string;
  nativeAppActivatedAt: Date | null;
}): boolean {
  return user.role === 'ADMIN' || Boolean(user.nativeAppActivatedAt);
}

export async function getNativeActivationStatus(userId: string) {
  const prisma = activationPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, nativeAppActivatedAt: true },
  });
  return {
    activated: user ? hasNativeAppAccess(user) : false,
    activatedAt: user?.nativeAppActivatedAt?.toISOString() ?? null,
  };
}

export async function redeemNativeActivationCode(userId: string, rawCode: string) {
  const code = normalizeActivationCode(rawCode);
  if (!code) {
    throw new NativeActivationError(400, 'invalid_code', '激活码格式不对，请检查后重新输入。');
  }
  const prisma = activationPrisma();
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { nativeAppActivatedAt: true },
    });
    if (!user) {
      throw new NativeActivationError(401, 'invalid_code', '请先登录再输入激活码。');
    }
    if (user.nativeAppActivatedAt) {
      throw new NativeActivationError(
        409,
        'already_activated',
        '这个账号已经开通了 App，不需要再用激活码。',
      );
    }
    // 条件更新保证并发兑换时只有一个请求能拿到这枚激活码。
    const claimed = await transaction.nativeActivationCode.updateMany({
      where: { code, redeemedAt: null },
      data: { redeemedAt: now, redeemedById: userId },
    });
    if (claimed.count !== 1) {
      const exists = await transaction.nativeActivationCode.findUnique({
        where: { code },
        select: { id: true },
      });
      throw exists
        ? new NativeActivationError(409, 'already_used', '这个激活码已经被使用过了。')
        : new NativeActivationError(404, 'invalid_code', '激活码不存在，请检查后重新输入。');
    }
    await transaction.user.update({
      where: { id: userId },
      data: { nativeAppActivatedAt: now },
    });
    return { activated: true as const, activatedAt: now.toISOString() };
  });
}

export async function createNativeActivationCodes(input: {
  count: number;
  note?: string | null;
  createdBy?: string | null;
}) {
  const count = Math.trunc(input.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_ACTIVATION_CODES_PER_BATCH) {
    throw new NativeActivationError(
      400,
      'invalid_code',
      `一次可以生成 1 到 ${MAX_ACTIVATION_CODES_PER_BATCH} 个激活码。`,
    );
  }
  const prisma = activationPrisma();
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomActivationCode());
  const note = input.note?.trim().slice(0, 200) || null;
  const createdBy = input.createdBy?.trim().slice(0, 320) || null;
  await prisma.nativeActivationCode.createMany({
    data: [...codes].map((code) => ({ code, note, createdBy })),
    skipDuplicates: true,
  });
  return prisma.nativeActivationCode.findMany({
    where: { code: { in: [...codes] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, code: true, note: true, createdAt: true },
  });
}

export async function listNativeActivationCodes(filter: 'all' | 'unused' | 'used', take = 200) {
  const prisma = activationPrisma();
  const rows = await prisma.nativeActivationCode.findMany({
    where:
      filter === 'unused'
        ? { redeemedAt: null }
        : filter === 'used'
          ? { redeemedAt: { not: null } }
          : undefined,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      code: true,
      note: true,
      createdBy: true,
      createdAt: true,
      redeemedAt: true,
      redeemedBy: { select: { email: true, name: true } },
    },
  });
  const [total, unused] = await Promise.all([
    prisma.nativeActivationCode.count(),
    prisma.nativeActivationCode.count({ where: { redeemedAt: null } }),
  ]);
  return {
    total,
    unused,
    codes: rows.map((row) => ({
      id: row.id,
      code: row.code,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      redeemedAt: row.redeemedAt?.toISOString() ?? null,
      redeemedBy: row.redeemedBy?.email || row.redeemedBy?.name || null,
    })),
  };
}
