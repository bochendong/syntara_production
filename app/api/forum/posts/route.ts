import { NextResponse } from 'next/server';
import { parseCourseForumImages } from '@/features/course-forum/server/course-forum-access';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const title = String(formData.get('title') || '').trim();
    const bodyMarkdown = String(formData.get('bodyMarkdown') || '').trim();

    if (!title || title.length > 200) {
      return NextResponse.json({ error: '标题需为 1–200 个字符' }, { status: 400 });
    }
    if (!bodyMarkdown || bodyMarkdown.length > 30_000) {
      return NextResponse.json({ error: '帖子正文需为 1–30000 个字符' }, { status: 400 });
    }

    const images = await parseCourseForumImages(formData);
    const post = await prisma.courseForumPost.create({
      data: {
        authorId: auth.userId,
        title,
        bodyMarkdown,
        attachments: images.length
          ? {
              create: images.map((image) => ({ ...image, uploaderId: auth.userId })),
            }
          : undefined,
      },
      select: { id: true },
    });

    return NextResponse.json({ postId: post.id }, { status: 201 });
  });
}
