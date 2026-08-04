import { PrismaClient } from '@/lib/server/generated-prisma';

declare global {
  var __synatraPrisma__: PrismaClient | undefined;
  var __synatraPrismaUrl__: string | undefined;
}

function requireDatabaseUrl(): string {
  const u = process.env.DATABASE_URL?.trim();
  if (!u) {
    throw new Error(
      'DATABASE_URL 未设置：请在 .env.local 中配置 PostgreSQL；若刚修改过，请停止所有 pnpm dev，删除 .next 后再启动。',
    );
  }

  // Railway's public TCP proxy requires TLS. Its development certificate is
  // not trusted by Prisma when the URL omits sslmode, which otherwise looks
  // like a generic P1001 "database server unreachable" error. Keep production
  // configuration explicit, but make local development match Railway's
  // connection contract.
  if (process.env.NODE_ENV !== 'production' && /\.proxy\.rlwy\.net(?::\d+)?(?:\/|$)/i.test(u)) {
    const railwayUrl = new URL(u);
    if (!railwayUrl.searchParams.has('sslmode')) {
      railwayUrl.searchParams.set('sslmode', 'require');
    }
    if (!railwayUrl.searchParams.has('connection_limit')) {
      // In Next.js development each route bundle can initialize its own pool.
      // A large per-client limit multiplies quickly during /learn's parallel
      // startup requests and overwhelms Railway's public TCP proxy. Three
      // connections still leave room for Prisma interactive transactions.
      railwayUrl.searchParams.set('connection_limit', '3');
    }
    if (!railwayUrl.searchParams.has('pool_timeout')) {
      // The UI now keeps cached course content visible and retries locally, so
      // holding every route open for a full minute only exhausts the tiny
      // development pool and turns one flaky connection into a page-wide
      // outage. Fail acquisition quickly enough for the visible retry state.
      railwayUrl.searchParams.set('pool_timeout', '30');
    }
    if (!railwayUrl.searchParams.has('connect_timeout')) {
      railwayUrl.searchParams.set('connect_timeout', '15');
    }
    return railwayUrl.toString();
  }

  return u;
}

function createClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });
}

/** 惰性创建全局 PrismaClient（需已配置 DATABASE_URL） */
export function getOrCreatePrisma(): PrismaClient {
  const url = requireDatabaseUrl();

  // 开发时 HMR 可能让模块重载，但 global 上仍挂着「旧连接串」下创建的 Client，导致
  // `User was denied access on the database (not available)` 等异常；URL 变化则重建。
  if (process.env.NODE_ENV !== 'production') {
    if (global.__synatraPrisma__ && global.__synatraPrismaUrl__ !== url) {
      void global.__synatraPrisma__.$disconnect().catch(() => {});
      global.__synatraPrisma__ = undefined;
    }
    global.__synatraPrismaUrl__ = url;
  }

  if (!global.__synatraPrisma__) {
    global.__synatraPrisma__ = createClient(url);
  }
  return global.__synatraPrisma__;
}
