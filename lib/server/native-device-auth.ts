import { createHmac, randomBytes } from 'node:crypto';

import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEVICE_START_WINDOW_MS = 10 * 60 * 1_000;
const DEVICE_START_LIMIT = 20;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1_000;
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type NativeDeviceUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN';
};

export type NativeDevicePrincipal = {
  userId: string;
  keyId: string;
  sessionId: string;
  user: NativeDeviceUser;
};

export type NativeDeviceTokenPair = {
  status: 'authorized';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
  user: NativeDeviceUser;
};

export type NativeDevicePollResult =
  | NativeDeviceTokenPair
  | {
      status: 'pending';
      intervalSeconds: number;
    };

export class NativeAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      | 'auth_not_configured'
      | 'invalid_request'
      | 'rate_limited'
      | 'unauthorized'
      | 'expired_token'
      | 'invalid_grant',
    message: string,
  ) {
    super(message);
    this.name = 'NativeAuthError';
  }
}

function nativeAuthSecret(): string {
  const secret =
    process.env.SYNTARA_NATIVE_AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || '';
  if (secret.length < 32) {
    throw new NativeAuthError(
      503,
      'auth_not_configured',
      'Native login is not configured on this server.',
    );
  }
  return secret;
}

function nativeAuthPrisma() {
  const prisma = getOptionalPrisma();
  if (!prisma) {
    throw new NativeAuthError(
      503,
      'auth_not_configured',
      'Native login requires a configured PostgreSQL database.',
    );
  }
  return prisma;
}

function hashScoped(scope: string, value: string): string {
  return createHmac('sha256', nativeAuthSecret()).update(`${scope}\0${value}`).digest('hex');
}

function opaqueToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function userCode(): string {
  let value = '';
  for (let index = 0; index < 8; index += 1) {
    value += USER_CODE_ALPHABET[randomBytes(1)[0] % USER_CODE_ALPHABET.length];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export function normalizeNativeUserCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : '';
}

function normalizeDeviceId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(normalized)) {
    throw new NativeAuthError(400, 'invalid_request', 'Invalid Native device identifier.');
  }
  return normalized;
}

function normalizeDeviceName(value: string): string {
  const normalized = value.normalize('NFKC').trim().slice(0, 80);
  if (!normalized) {
    throw new NativeAuthError(400, 'invalid_request', 'Native device name is required.');
  }
  return normalized;
}

function normalizeToken(value: string, prefix: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith(prefix) || normalized.length < prefix.length + 40) {
    throw new NativeAuthError(401, 'invalid_grant', 'Invalid Native login token.');
  }
  return normalized;
}

function publicUser(user: NativeDeviceUser): NativeDeviceUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
  };
}

function createTokenMaterial(now: Date) {
  const accessToken = opaqueToken('snt_acc_');
  const refreshToken = opaqueToken('snt_ref_');
  return {
    accessToken,
    accessTokenHash: hashScoped('access-token', accessToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshToken,
    refreshTokenHash: hashScoped('refresh-token', refreshToken),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  };
}

function tokenPair(
  session: {
    id: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    user: NativeDeviceUser;
  },
  material: { accessToken: string; refreshToken: string },
): NativeDeviceTokenPair {
  return {
    status: 'authorized',
    accessToken: material.accessToken,
    accessTokenExpiresAt: session.accessExpiresAt.toISOString(),
    refreshToken: material.refreshToken,
    refreshTokenExpiresAt: session.refreshExpiresAt.toISOString(),
    sessionId: session.id,
    user: publicUser(session.user),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

export function nativeDeviceAuthConfigured(): boolean {
  try {
    nativeAuthSecret();
    return Boolean(getOptionalPrisma());
  } catch {
    return false;
  }
}

export async function startNativeDeviceAuthorization(input: {
  deviceId: string;
  deviceName: string;
  requestFingerprint: string;
}) {
  const prisma = nativeAuthPrisma();
  const now = new Date();
  const deviceId = normalizeDeviceId(input.deviceId);
  const deviceName = normalizeDeviceName(input.deviceName);
  const requestFingerprintHash = hashScoped(
    'request-fingerprint',
    input.requestFingerprint.trim() || deviceId,
  );

  const recentCount = await prisma.nativeDeviceAuthorization.count({
    where: {
      requestFingerprintHash,
      createdAt: { gte: new Date(now.getTime() - DEVICE_START_WINDOW_MS) },
    },
  });
  if (recentCount >= DEVICE_START_LIMIT) {
    throw new NativeAuthError(
      429,
      'rate_limited',
      'Too many Native login attempts. Please wait and try again.',
    );
  }

  const deviceCode = opaqueToken('snt_dev_');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const visibleUserCode = userCode();
    try {
      await prisma.nativeDeviceAuthorization.create({
        data: {
          deviceCodeHash: hashScoped('device-code', deviceCode),
          userCodeHash: hashScoped('user-code', visibleUserCode),
          requestFingerprintHash,
          deviceId,
          deviceName,
          expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_MS),
        },
      });
      return {
        deviceCode,
        userCode: visibleUserCode,
        expiresInSeconds: Math.floor(DEVICE_CODE_TTL_MS / 1_000),
        intervalSeconds: 3,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 4) throw error;
    }
  }
  throw new NativeAuthError(500, 'invalid_grant', 'Unable to create a Native login code.');
}

export async function approveNativeDeviceAuthorization(userCodeValue: string, userId: string) {
  const prisma = nativeAuthPrisma();
  const normalizedCode = normalizeNativeUserCode(userCodeValue);
  if (!normalizedCode) {
    throw new NativeAuthError(400, 'invalid_request', 'Invalid Native login code.');
  }
  const now = new Date();
  const authorization = await prisma.nativeDeviceAuthorization.findUnique({
    where: { userCodeHash: hashScoped('user-code', normalizedCode) },
  });
  if (!authorization || authorization.status !== 'pending') {
    throw new NativeAuthError(400, 'invalid_grant', 'This Native login code is no longer valid.');
  }
  if (authorization.expiresAt <= now) {
    throw new NativeAuthError(410, 'expired_token', 'This Native login code has expired.');
  }

  await prisma.nativeDeviceAuthorization.update({
    where: { id: authorization.id },
    data: {
      userId,
      status: 'approved',
      approvedAt: now,
    },
  });
  return {
    status: 'approved' as const,
    deviceName: authorization.deviceName,
    expiresAt: authorization.expiresAt.toISOString(),
  };
}

export async function pollNativeDeviceAuthorization(
  deviceCodeValue: string,
): Promise<NativeDevicePollResult> {
  const prisma = nativeAuthPrisma();
  const deviceCode = normalizeToken(deviceCodeValue, 'snt_dev_');
  const deviceCodeHash = hashScoped('device-code', deviceCode);
  const now = new Date();

  return prisma.$transaction(async (transaction) => {
    const authorization = await transaction.nativeDeviceAuthorization.findUnique({
      where: { deviceCodeHash },
    });
    if (!authorization) {
      throw new NativeAuthError(401, 'invalid_grant', 'Unknown Native login request.');
    }
    if (authorization.expiresAt <= now) {
      throw new NativeAuthError(410, 'expired_token', 'The Native login request has expired.');
    }
    if (authorization.status === 'pending') {
      return { status: 'pending', intervalSeconds: 3 };
    }
    if (authorization.status !== 'approved' || !authorization.userId) {
      throw new NativeAuthError(401, 'invalid_grant', 'The Native login request is unavailable.');
    }

    const claimed = await transaction.nativeDeviceAuthorization.updateMany({
      where: {
        id: authorization.id,
        status: 'approved',
        consumedAt: null,
      },
      data: {
        status: 'consumed',
        consumedAt: now,
      },
    });
    if (claimed.count !== 1) {
      throw new NativeAuthError(401, 'invalid_grant', 'The Native login request was already used.');
    }

    const material = createTokenMaterial(now);
    const session = await transaction.nativeDeviceSession.create({
      data: {
        userId: authorization.userId,
        deviceId: authorization.deviceId,
        deviceName: authorization.deviceName,
        accessTokenHash: material.accessTokenHash,
        refreshTokenHash: material.refreshTokenHash,
        accessExpiresAt: material.accessExpiresAt,
        refreshExpiresAt: material.refreshExpiresAt,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true, role: true },
        },
      },
    });
    return tokenPair(session, material);
  });
}

export async function refreshNativeDeviceSession(
  refreshTokenValue: string,
): Promise<NativeDeviceTokenPair> {
  const prisma = nativeAuthPrisma();
  const refreshToken = normalizeToken(refreshTokenValue, 'snt_ref_');
  const refreshTokenHash = hashScoped('refresh-token', refreshToken);
  const now = new Date();

  return prisma.$transaction(async (transaction) => {
    const current = await transaction.nativeDeviceSession.findUnique({
      where: { refreshTokenHash },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true, role: true },
        },
      },
    });
    if (!current || current.revokedAt) {
      throw new NativeAuthError(401, 'invalid_grant', 'Native session is no longer valid.');
    }
    if (current.refreshExpiresAt <= now) {
      throw new NativeAuthError(401, 'expired_token', 'Native session has expired.');
    }

    const material = createTokenMaterial(now);
    const session = await transaction.nativeDeviceSession.update({
      where: { id: current.id },
      data: {
        accessTokenHash: material.accessTokenHash,
        refreshTokenHash: material.refreshTokenHash,
        accessExpiresAt: material.accessExpiresAt,
        refreshExpiresAt: material.refreshExpiresAt,
        lastUsedAt: now,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true, role: true },
        },
      },
    });
    return tokenPair(session, material);
  });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization')?.trim() || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new NativeAuthError(401, 'unauthorized', 'Native login is required.');
  }
  return normalizeToken(match[1], 'snt_acc_');
}

export async function authenticateNativeDeviceRequest(
  request: Request,
): Promise<NativeDevicePrincipal> {
  const prisma = nativeAuthPrisma();
  const accessToken = bearerToken(request);
  const now = new Date();
  const session = await prisma.nativeDeviceSession.findUnique({
    where: { accessTokenHash: hashScoped('access-token', accessToken) },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true, role: true },
      },
    },
  });
  if (!session || session.revokedAt) {
    throw new NativeAuthError(401, 'unauthorized', 'Native login is required.');
  }
  if (session.accessExpiresAt <= now || session.refreshExpiresAt <= now) {
    throw new NativeAuthError(401, 'expired_token', 'Native access token has expired.');
  }

  if (now.getTime() - session.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.nativeDeviceSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }
  return {
    userId: session.userId,
    keyId: session.id,
    sessionId: session.id,
    user: publicUser(session.user),
  };
}

export async function revokeNativeDeviceSession(request: Request) {
  const prisma = nativeAuthPrisma();
  const accessToken = bearerToken(request);
  const session = await prisma.nativeDeviceSession.findUnique({
    where: { accessTokenHash: hashScoped('access-token', accessToken) },
    select: { id: true, revokedAt: true },
  });
  if (!session) return { revoked: true as const };
  if (!session.revokedAt) {
    await prisma.nativeDeviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
  return { revoked: true as const };
}
