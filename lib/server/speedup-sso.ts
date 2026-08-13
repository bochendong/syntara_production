import { encode } from 'next-auth/jwt';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const SPEEDUP_PROVIDER = 'speedup';
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_SESSION_AGE_SECONDS = 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;

export type SpeedupUserRole = 'STUDENT' | 'TEACHER';

export type SpeedupCourse = {
  id: string;
  /** Internal normalized campus key, sourced from Speedup UniversityAbbrs. */
  campusCode: string;
  name: string;
  code: string | null;
  termName: string | null;
  universityAbbrs: string | null;
};

export function normalizeSpeedupUniversityAbbrs(value: string | null | undefined): string {
  const normalized = (value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || 'UNKNOWN';
}

export type SpeedupVerifiedIdentity = {
  accessToken: string;
  expiresIn: number;
  externalUserId: string;
  name: string;
  role: SpeedupUserRole;
  studentId: string | null;
  teacherId: string | null;
  course: SpeedupCourse;
  courses: SpeedupCourse[];
};

export class SpeedupSsoError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'SpeedupSsoError';
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SpeedupSsoError(503, 'AI 课程登录服务尚未完成环境配置，请联系管理员。');
  }
  return value;
}

function speedupUrl(path: string): URL {
  const configuredBase = requiredEnvironment('SPEEDUP_API_BASE_URL');
  const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
  return new URL(path.replace(/^\/+/, ''), base);
}

function stringValue(record: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numberValue(record: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function exchangeTicket(code: string): Promise<JsonRecord> {
  const exchangeUrl = speedupUrl('SsoAuth/ExchangeToken');
  const clientId = requiredEnvironment('SPEEDUP_SSO_CLIENT_ID');
  const clientSecret = requiredEnvironment('SPEEDUP_SSO_CLIENT_SECRET');
  let response: Response;
  try {
    response = await fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Code: code,
        ClientId: clientId,
        ClientSecret: clientSecret,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SpeedupSsoError(502, '暂时无法连接 Speedup 登录服务，请稍后重试。');
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new SpeedupSsoError(400, '授权码无效或已过期，请返回 Speedup 重新进入 AI 课程。');
    }
    throw new SpeedupSsoError(502, 'Speedup 登录服务暂时不可用，请稍后重试。');
  }

  const record = asRecord(payload);
  if (!record) {
    throw new SpeedupSsoError(502, 'Speedup 登录服务返回了无法识别的数据。');
  }
  return record;
}

function resolveRole(exchange: JsonRecord): SpeedupUserRole {
  const teacherId = stringValue(exchange, 'TeacherId', 'teacherId');
  if (teacherId) return 'TEACHER';

  const studentId = stringValue(exchange, 'StudentId', 'studentId');
  if (studentId) return 'STUDENT';

  const role = stringValue(exchange, 'Role', 'role')?.toLowerCase() || '';
  if (role.includes('teacher') || role.includes('老师') || role.includes('教师')) return 'TEACHER';
  if (role.includes('student') || role.includes('学生')) return 'STUDENT';

  throw new SpeedupSsoError(403, '当前 Speedup 账号类型不支持进入 AI 课程。');
}

function speedupCourseFromRecord(course: JsonRecord): SpeedupCourse | null {
  const id = stringValue(course, 'CourseId', 'courseId');
  const universityAbbrs = stringValue(course, 'UniversityAbbrs', 'universityAbbrs');
  if (!id || !universityAbbrs) return null;
  return {
    id,
    campusCode: normalizeSpeedupUniversityAbbrs(universityAbbrs),
    name: stringValue(course, 'CourseName', 'courseName') || `课程 ${id}`,
    code: stringValue(course, 'CourseCode', 'courseCode'),
    termName: stringValue(course, 'TermName', 'termName'),
    universityAbbrs,
  };
}

async function fetchSpeedupCourses(
  accessToken: string,
  role: SpeedupUserRole,
): Promise<SpeedupCourse[]> {
  const endpoint =
    role === 'TEACHER' ? 'PartnerCourse/TeacherCourses' : 'PartnerCourse/StudentCourses';
  const courseAccessUrl = speedupUrl(endpoint);
  let response: Response;
  try {
    response = await fetch(courseAccessUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SpeedupSsoError(502, '暂时无法验证 Speedup 课程权限，请稍后重试。');
  }

  const payload = await readJsonResponse(response);
  if (!response.ok || !Array.isArray(payload)) {
    throw new SpeedupSsoError(502, 'Speedup 课程权限验证失败，请稍后重试。');
  }

  return payload
    .map(asRecord)
    .filter((course): course is JsonRecord => course !== null)
    .map(speedupCourseFromRecord)
    .filter((course): course is SpeedupCourse => course !== null);
}

async function verifyCourseAccess(
  accessToken: string,
  role: SpeedupUserRole,
  requestedCourseId: string,
): Promise<{ course: SpeedupCourse; courses: SpeedupCourse[] }> {
  const courses = await fetchSpeedupCourses(accessToken, role);
  const matchingIds = courses.filter((course) => course.id === requestedCourseId);
  if (matchingIds.length > 1) {
    throw new SpeedupSsoError(
      502,
      'Speedup 课程数据包含重复的 CourseId，请联系管理员检查课程配置。',
    );
  }
  const matchedCourse = matchingIds[0];
  if (!matchedCourse) {
    throw new SpeedupSsoError(403, '当前账号没有该课程的访问权限。');
  }
  return { course: matchedCourse, courses };
}

export async function listSpeedupCoursesForUser(
  userId: string,
  role: SpeedupUserRole,
): Promise<SpeedupCourse[]> {
  const prisma = getOptionalPrisma();
  if (!prisma) {
    throw new SpeedupSsoError(503, 'AI 课程数据库尚未配置，请联系管理员。');
  }
  const account = await prisma.account.findFirst({
    where: { userId, provider: SPEEDUP_PROVIDER },
    select: { access_token: true, expires_at: true },
  });
  if (!account?.access_token) {
    throw new SpeedupSsoError(403, '请先从 Speedup 进入 AI 课程，再管理本学期课程。');
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (account.expires_at && account.expires_at <= nowSeconds) {
    throw new SpeedupSsoError(401, 'Speedup 登录已过期，请返回 Speedup 后重新进入 AI 课程。');
  }
  return fetchSpeedupCourses(account.access_token, role);
}

export async function verifySpeedupCallback(
  code: string,
  requestedCourseId: string,
): Promise<SpeedupVerifiedIdentity> {
  const exchange = await exchangeTicket(code);
  const accessToken = stringValue(exchange, 'Token', 'token');
  const externalUserId = stringValue(exchange, 'UserId', 'userId');
  if (!accessToken || !externalUserId) {
    throw new SpeedupSsoError(502, 'Speedup 登录结果缺少必要的身份信息。');
  }

  const role = resolveRole(exchange);
  const { course, courses } = await verifyCourseAccess(accessToken, role, requestedCourseId);
  const expiresIn = Math.max(
    60,
    Math.min(
      Math.floor(numberValue(exchange, 'ExpiresIn', 'expiresIn') || DEFAULT_SESSION_AGE_SECONDS),
      DEFAULT_SESSION_AGE_SECONDS,
    ),
  );

  return {
    accessToken,
    expiresIn,
    externalUserId,
    name: stringValue(exchange, 'Name', 'name') || `Speedup 用户 ${externalUserId}`,
    role,
    studentId: stringValue(exchange, 'StudentId', 'studentId'),
    teacherId: stringValue(exchange, 'TeacherId', 'teacherId'),
    course,
    courses,
  };
}

export async function createSpeedupUserSession(identity: SpeedupVerifiedIdentity): Promise<{
  sessionToken: string;
  maxAge: number;
  userId: string;
}> {
  const prisma = getOptionalPrisma();
  const allowStatelessSession = process.env.SPEEDUP_SSO_ALLOW_STATELESS === 'true';
  if (!prisma && !allowStatelessSession) {
    throw new SpeedupSsoError(503, 'AI 课程登录数据库尚未配置，请联系管理员。');
  }

  let user: { id: string; name: string | null };
  if (!prisma) {
    user = {
      id: `speedup:${identity.externalUserId}`,
      name: identity.name,
    };
  } else {
    const providerAccountId = identity.externalUserId;
    const expiresAt = Math.floor(Date.now() / 1000) + identity.expiresIn;
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: SPEEDUP_PROVIDER,
          providerAccountId,
        },
      },
      select: { id: true, userId: true },
    });

    if (existingAccount) {
      const results = await prisma.$transaction([
        prisma.account.update({
          where: { id: existingAccount.id },
          data: {
            access_token: identity.accessToken,
            expires_at: expiresAt,
            token_type: 'Bearer',
          },
        }),
        prisma.user.update({
          where: { id: existingAccount.userId },
          data: {
            name: identity.name,
            role: identity.role,
            isActive: true,
          },
          select: { id: true, name: true },
        }),
      ]);
      user = results[1];
    } else {
      user = await prisma.user.create({
        data: {
          name: identity.name,
          role: identity.role,
          isActive: true,
          accounts: {
            create: {
              type: 'oauth',
              provider: SPEEDUP_PROVIDER,
              providerAccountId,
              access_token: identity.accessToken,
              expires_at: expiresAt,
              token_type: 'Bearer',
            },
          },
        },
        select: { id: true, name: true },
      });
    }
  }

  const authSecret = requiredEnvironment('NEXTAUTH_SECRET');
  const sessionToken = await encode({
    secret: authSecret,
    maxAge: identity.expiresIn,
    token: {
      sub: user.id,
      name: user.name,
      role: identity.role,
      isActive: true,
      authSource: 'speedup',
    },
  });

  return { sessionToken, maxAge: identity.expiresIn, userId: user.id };
}
