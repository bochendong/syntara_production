import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { Prisma } from '@prisma/client';

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  const prisma = getOptionalPrisma();
  if (!prisma)
    return NextResponse.json({ error: '失败记录需要配置数据库以持久保存。' }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.get('page'))) || 1));
  const search = (params.get('search') || '').trim().slice(0, 200);
  const role = params.get('role') || '';
  const category = params.get('category') || '';
  const route = (params.get('route') || '').slice(0, 200);
  const id = params.get('id');
  const where = Prisma.sql`WHERE (${id || ''} = '' OR "id" = ${id || ''})
    AND (${category} = '' OR "data"->>'category' = ${category})
    AND (${role} = '' OR "data"->>'role' = ${role})
    AND (${route} = '' OR strpos("data"->>'route', ${route}) > 0)
    AND (${search} = '' OR strpos(lower(concat_ws(' ', "data"->>'userName', "data"->>'userEmail', "data"->>'userId', "data"->>'reason', "data"->>'requestId')), lower(${search})) > 0)`;
  try {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; data: Record<string, unknown>; createdAt: Date }>
    >(
      Prisma.sql`SELECT "id", CASE WHEN ${id || ''} = '' THEN "data" - 'input' - 'requestInput' - 'output' ELSE "data" END AS "data", "createdAt" FROM "AiFailureRecord" ${where} ORDER BY "createdAt" DESC, "id" DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
    );
    const counts = await prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM "AiFailureRecord" ${where}`,
    );
    return NextResponse.json(
      { records: rows, total: Number(counts[0]?.total || 0), page },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin failures]', error);
    return NextResponse.json(
      { error: '失败记录暂时无法读取，请确认数据库可用并已执行失败记录迁移。' },
      { status: 503 },
    );
  }
}
