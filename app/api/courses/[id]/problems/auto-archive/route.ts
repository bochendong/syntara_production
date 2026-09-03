import { NextResponse } from 'next/server';

/** @deprecated Use /api/courses/:courseId/problem-tags/organize. */
export async function POST() {
  return NextResponse.json(
    {
      error: 'AI 自动归档已停用，请使用 AI 整理标签。',
      replacement: '../problem-tags/organize',
    },
    { status: 410 },
  );
}
