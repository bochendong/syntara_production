import { NextResponse } from 'next/server';

/** @deprecated Use /api/courses/:courseId/problem-chapters/archive. */
export async function POST() {
  return NextResponse.json(
    {
      error: '旧版自动归档已停用，请使用章节 AI 归档。',
      replacement: '../problem-chapters/archive',
    },
    { status: 410 },
  );
}
