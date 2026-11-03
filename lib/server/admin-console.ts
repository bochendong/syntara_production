import { Prisma, type PrismaClient, type UserRole } from '@/lib/server/generated-prisma';
import { ADMIN_TEXT_MODEL_OPTIONS, type ChatTierModels } from '@/lib/ai/admin-model-options';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import { isAuthorizedAdminIdentity } from '@/lib/server/admin-identity';
import { normalizeCourseDisplay } from '@/lib/course-space/course-display-name';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { listAccessibleCoursesForUser } from '@/lib/server/repositories/course-repository';
import { visibleNativeCourses } from '@/lib/server/native-staging-course';
import type { DbClient } from '@/lib/server/repositories/types';
import {
  getCloudUsageGlobalLimit,
  getCloudUsageUserLimit,
  saveCloudUsageGlobalLimit,
  saveCloudUsageUserLimit,
  summarizeCloudUsage,
  type CloudUsageGlobalLimit,
  type CloudUsageSummary,
  type CloudUsageUserLimit,
} from '@/lib/server/cloud-usage-limits';
import { getAdminProviderEnvHints, getSiteProviderAdminView } from '@/lib/server/provider-config';
import { getSystemLLMConfigView, updateSystemLLMConfig } from '@/lib/server/system-llm-config';

/**
 * App 里的「管理」页（测试服管理员控制台）：全站模型、API Key、账号身份、用量额度。
 * 复用网页 /admin 管理中心的同一套服务端配置，只是换成 App 的登录方式。
 */

export const ADMIN_CONSOLE_ROLES = ['USER', 'STUDENT', 'TEACHER', 'ADMIN'] as const;
export type AdminConsoleRole = (typeof ADMIN_CONSOLE_ROLES)[number];

export class AdminConsoleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type AdminConsoleViewer = { userId: string; email: string | null };

async function readRole(db: DbClient, userId: string): Promise<string | null> {
  try {
    // 和 requireAdmin 一样单独查 role，老库没有这列时不报错。
    const rows = await db.$queryRaw<Array<{ role: string }>>(
      Prisma.sql`SELECT role::text AS "role" FROM "User" WHERE id = ${userId} LIMIT 1`,
    );
    return rows[0]?.role ?? null;
  } catch {
    return null;
  }
}

/** 用登录账号在库里的身份判断（role = ADMIN 或在 ADMIN_EMAILS / ADMIN_USER_IDS 里），不信请求体。 */
export async function resolveAdminConsoleViewer(
  db: DbClient,
  userId: string,
): Promise<AdminConsoleViewer | null> {
  const profile = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!profile) return null;
  const role = await readRole(db, userId);
  return isAuthorizedAdminIdentity({ userId, email: profile.email }, role)
    ? { userId, email: profile.email }
    : null;
}

function actorLabel(viewer: AdminConsoleViewer) {
  return viewer.email ?? viewer.userId;
}

type ProviderKind = 'image' | 'tts' | 'webSearch';

export type AdminConsoleProvider = {
  kind: ProviderKind;
  id: string;
  name: string;
  configured: boolean;
  keyLast4: string | null;
  envName: string | null;
};

const PROVIDER_NAMES: Record<ProviderKind, Record<string, { name: string }>> = {
  image: IMAGE_PROVIDERS,
  tts: TTS_PROVIDERS,
  webSearch: WEB_SEARCH_PROVIDERS,
};

async function providerStatus(): Promise<AdminConsoleProvider[]> {
  const view = await getSiteProviderAdminView();
  const hints = getAdminProviderEnvHints();
  // 网页管理中心也这样处理：根环境变量里的 TAVILY_API_KEY 同样算配置好了。
  const tavilyEnv = process.env.TAVILY_API_KEY?.trim() || '';
  const rows: AdminConsoleProvider[] = [];
  for (const kind of ['image', 'tts', 'webSearch'] as const) {
    const configuredRows = new Map(view[kind].map((row) => [row.id, row]));
    for (const [id, meta] of Object.entries(PROVIDER_NAMES[kind])) {
      const row = configuredRows.get(id);
      const tavily = kind === 'webSearch' && id === 'tavily' && tavilyEnv;
      const configured = Boolean(row?.hasApiKey || tavily);
      rows.push({
        kind,
        id,
        name: meta.name || id,
        configured,
        keyLast4: row?.apiKeyLast4 ?? (tavily ? tavilyEnv.slice(-4) : null),
        envName: hints[kind][id]?.apiKey ?? (id === 'tavily' ? 'TAVILY_API_KEY' : null),
      });
    }
  }
  return rows;
}

export type AdminConsoleOverview = {
  me: AdminConsoleViewer;
  llm: {
    modelId: string;
    tierModels: ChatTierModels;
    baseUrl: string;
    hasApiKey: boolean;
    maskedApiKey: string;
    source: 'database' | 'environment';
    updatedAt: string | null;
  };
  modelOptions: Array<{ id: string; label: string; description: string }>;
  providers: AdminConsoleProvider[];
  usage: { limit: CloudUsageGlobalLimit; usage: CloudUsageSummary };
  roleCounts: Record<AdminConsoleRole, number>;
};

async function llmView(): Promise<AdminConsoleOverview['llm']> {
  const config = await getSystemLLMConfigView();
  return {
    modelId: config.modelId,
    tierModels: config.tierModels,
    baseUrl: config.baseUrl || '',
    hasApiKey: config.hasApiKey,
    maskedApiKey: config.apiKeyMasked,
    source: config.source,
    updatedAt: config.updatedAt,
  };
}

async function usageView(db: PrismaClient) {
  const [limit, usage] = await Promise.all([getCloudUsageGlobalLimit(db), summarizeCloudUsage(db)]);
  return { limit, usage };
}

export async function getAdminConsoleOverview(
  db: PrismaClient,
  viewer: AdminConsoleViewer,
): Promise<AdminConsoleOverview> {
  const [llm, providers, usage, grouped] = await Promise.all([
    llmView(),
    providerStatus(),
    usageView(db),
    db.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
  ]);
  const roleCounts = Object.fromEntries(ADMIN_CONSOLE_ROLES.map((role) => [role, 0])) as Record<
    AdminConsoleRole,
    number
  >;
  for (const row of grouped) roleCounts[row.role as AdminConsoleRole] = row._count._all;
  return {
    me: viewer,
    llm,
    modelOptions: ADMIN_TEXT_MODEL_OPTIONS.map((option) => ({ ...option })),
    providers,
    usage,
    roleCounts,
  };
}

export type AdminConsoleUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: AdminConsoleRole;
  isActive: boolean;
  createdAt: number;
  limit: CloudUsageUserLimit | null;
  usage: CloudUsageSummary;
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

async function withUsage(
  db: PrismaClient,
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: UserRole;
    isActive: boolean;
    createdAt: Date;
  },
): Promise<AdminConsoleUser> {
  const [limit, usage] = await Promise.all([
    getCloudUsageUserLimit(db, user.id),
    summarizeCloudUsage(db, user.id),
  ]);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role as AdminConsoleRole,
    isActive: user.isActive,
    createdAt: user.createdAt.getTime(),
    limit,
    usage,
  };
}

/** 按邮箱或名字搜账号，每页最多 20 个；空搜索只列出活跃账号。 */
export async function searchAdminConsoleUsers(
  db: PrismaClient,
  input: { query?: string | null; role?: AdminConsoleRole | null; page?: number },
): Promise<{ users: AdminConsoleUser[]; total: number; page: number; pageSize: number }> {
  const query = input.query?.trim() || '';
  const pageSize = 20;
  const where: Prisma.UserWhereInput = {
    ...(input.role ? { role: input.role } : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { id: query },
          ],
        }
      : { isActive: true }),
  };
  const total = await db.user.count({ where });
  const requestedPage =
    typeof input.page === 'number' && Number.isSafeInteger(input.page) && input.page > 0
      ? input.page
      : 1;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const users = await db.user.findMany({
    where,
    select: USER_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return {
    users: await Promise.all(users.map((user) => withUsage(db, user))),
    total,
    page,
    pageSize,
  };
}

async function loadUser(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) throw new AdminConsoleError(404, '找不到这个账号。');
  return user;
}

/** 和学生 App 使用同一套课程访问规则，只在展开账号时读取。 */
export async function getAdminConsoleUserCourses(db: PrismaClient, userId: string) {
  const user = await loadUser(db, userId);
  const courses = visibleNativeCourses(
    process.env,
    user.id,
    await listAccessibleCoursesForUser(db, user.id, user.email),
  );
  return courses.map((course) => {
    const display = normalizeCourseDisplay(course);
    return {
      id: course.id,
      name: display.name,
      courseCode: display.courseCode,
      university: course.university,
      avatarUrl: course.avatarUrl?.trim() || pickStableCourseAvatarUrl(course.id),
      accessRole: course.accessRole,
    };
  });
}

export async function setAdminConsoleUserRole(
  db: PrismaClient,
  viewer: AdminConsoleViewer,
  userId: string,
  role: AdminConsoleRole,
): Promise<AdminConsoleUser> {
  // 不能把自己降级，免得把唯一的管理员锁在门外。
  if (userId === viewer.userId && role !== 'ADMIN') {
    throw new AdminConsoleError(400, '不能修改自己的管理员身份。');
  }
  await loadUser(db, userId);
  const user = await db.user.update({ where: { id: userId }, data: { role }, select: USER_SELECT });
  return withUsage(db, user);
}

export async function setAdminConsoleUserLimit(
  db: PrismaClient,
  viewer: AdminConsoleViewer,
  input: {
    userId: string;
    weeklyCostLimitUsd: number | null;
    weeklyRequestLimit: number | null;
    disabled: boolean;
  },
): Promise<AdminConsoleUser> {
  const user = await loadUser(db, input.userId);
  const existing = await getCloudUsageUserLimit(db, input.userId);
  await saveCloudUsageUserLimit(db, {
    ...input,
    note: existing?.note ?? null,
    updatedBy: actorLabel(viewer),
  });
  return withUsage(db, user);
}

export async function setAdminConsoleGlobalLimit(
  db: PrismaClient,
  viewer: AdminConsoleViewer,
  input: { enabled: boolean; weeklyCostLimitUsd: number | null; weeklyRequestLimit: number | null },
) {
  await saveCloudUsageGlobalLimit(db, { ...input, updatedBy: actorLabel(viewer) });
  return usageView(db);
}

/** 改模型或换 Key / 服务地址。没填的项沿用现在的配置，Key 留空就不换。 */
export async function saveAdminConsoleLlm(input: {
  modelId?: string;
  tierModels?: ChatTierModels;
  apiKey?: string;
  baseUrl?: string;
}) {
  const current = await getSystemLLMConfigView();
  try {
    await updateSystemLLMConfig({
      modelId: input.modelId ?? current.modelId,
      tierModels: input.tierModels ?? current.tierModels,
      baseUrl: input.baseUrl ?? current.baseUrl,
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
    });
  } catch (error) {
    throw new AdminConsoleError(400, error instanceof Error ? error.message : '保存失败');
  }
  return llmView();
}
