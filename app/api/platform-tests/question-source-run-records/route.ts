import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { safeRoute } from '@/lib/server/json-error-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postSchema = z.object({
  caseId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,160}$/i),
  result: z.unknown(),
});

type StoredQuestionSourceRun = {
  version: 1;
  scenarioId: 'question-source-routing';
  caseId: string;
  recordedAt: string;
  result: unknown;
};

const baseDirectory = path.join(process.cwd(), 'tmp', 'platform-tests', 'question-source-routing');

async function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function GET() {
  return safeRoute(async () => {
    const latestDirectory = path.join(baseDirectory, 'latest');
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
            ) as StoredQuestionSourceRun;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((record): record is StoredQuestionSourceRun => Boolean(record))
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));

    return NextResponse.json({ records, persistence: 'filesystem' });
  });
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '题源路由测试记录无效。', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const recordedAt = new Date().toISOString();
    const record: StoredQuestionSourceRun = {
      version: 1,
      scenarioId: 'question-source-routing',
      caseId: parsed.data.caseId,
      recordedAt,
      result: parsed.data.result,
    };
    const latestDirectory = path.join(baseDirectory, 'latest');
    const runsDirectory = path.join(baseDirectory, 'runs');
    await Promise.all([
      mkdir(latestDirectory, { recursive: true }),
      mkdir(runsDirectory, { recursive: true }),
    ]);

    const runFileName = `${recordedAt.replaceAll(':', '-')}-${record.caseId}.json`;
    const latestPath = path.join(latestDirectory, `${record.caseId}.json`);
    const runPath = path.join(runsDirectory, runFileName);
    await Promise.all([writeJsonAtomic(latestPath, record), writeJsonAtomic(runPath, record)]);

    return NextResponse.json({
      record,
      persistence: 'filesystem',
      relativePath: path.relative(process.cwd(), runPath),
    });
  });
}
