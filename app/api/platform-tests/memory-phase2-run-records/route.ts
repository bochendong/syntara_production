import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeRoute } from '@/lib/server/json-error-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scenarioSchema = z.enum([
  'memory-structured-facts-calendar',
  'memory-layered-query',
  'memory-ai-review-plan',
  'memory-problem-writeback',
  'memory-question-writeback',
]);

const postSchema = z.object({
  scenarioId: scenarioSchema,
  caseId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,160}$/i),
  result: z.unknown(),
});

type StoredPhaseTwoRun = {
  version: 1;
  scenarioId: z.infer<typeof scenarioSchema>;
  caseId: string;
  recordedAt: string;
  result: unknown;
};

function scenarioDirectory(scenarioId: z.infer<typeof scenarioSchema>) {
  return path.join(process.cwd(), 'tmp', 'platform-tests', 'memory-phase2', scenarioId);
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function GET(request: NextRequest) {
  return safeRoute(async () => {
    const parsedScenario = scenarioSchema.safeParse(request.nextUrl.searchParams.get('scenarioId'));
    if (!parsedScenario.success) {
      return NextResponse.json({ error: '未知的第二阶段测试。' }, { status: 400 });
    }

    const latestDirectory = path.join(scenarioDirectory(parsedScenario.data), 'latest');
    let fileNames: string[] = [];
    try {
      fileNames = (await readdir(latestDirectory)).filter((name) => name.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const records = (
      await Promise.all(
        fileNames.map(async (fileName) => {
          try {
            return JSON.parse(
              await readFile(path.join(latestDirectory, fileName), 'utf8'),
            ) as StoredPhaseTwoRun;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((record): record is StoredPhaseTwoRun => Boolean(record))
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));

    return NextResponse.json({ records, persistence: 'filesystem' });
  });
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '第二阶段测试记录无效。', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const recordedAt = new Date().toISOString();
    const record: StoredPhaseTwoRun = {
      version: 1,
      scenarioId: parsed.data.scenarioId,
      caseId: parsed.data.caseId,
      recordedAt,
      result: parsed.data.result,
    };
    const baseDirectory = scenarioDirectory(parsed.data.scenarioId);
    const latestDirectory = path.join(baseDirectory, 'latest');
    const runsDirectory = path.join(baseDirectory, 'runs');
    await Promise.all([
      mkdir(latestDirectory, { recursive: true }),
      mkdir(runsDirectory, { recursive: true }),
    ]);

    const runFileName = `${recordedAt.replaceAll(':', '-')}-${parsed.data.caseId}.json`;
    const latestPath = path.join(latestDirectory, `${parsed.data.caseId}.json`);
    const runPath = path.join(runsDirectory, runFileName);
    await Promise.all([writeJsonAtomic(latestPath, record), writeJsonAtomic(runPath, record)]);

    return NextResponse.json({
      record,
      persistence: 'filesystem',
      relativePath: path.relative(process.cwd(), runPath),
    });
  });
}
