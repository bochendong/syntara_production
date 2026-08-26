import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseCourseForumImages } from '@/features/course-forum/server/course-forum-access';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const createCommunityPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(30_000),
});

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const formData = await request.formData();
    const payload = createCommunityPostSchema.safeParse({
      title: formData.get('title'),
      bodyMarkdown: formData.get('bodyMarkdown'),
    });
    if (!payload.success) {
      return NextResponse.json(
        { error: '标题需为 1-200 个字符，正文需为 1-30000 个字符' },
        { status: 400 },
      );
    }

    const community = await prisma.community.findUnique({
      where: { slug },
      select: {
        id: true,
        members: {
          where: { userId: auth.userId },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!community) {
      return NextResponse.json({ error: 'Community 不存在' }, { status: 404 });
    }
    if (!community.members.length) {
      return NextResponse.json({ error: '加入 community 后才能发帖' }, { status: 403 });
    }

    const images = await parseCourseForumImages(formData);
    const post = await prisma.courseForumPost.create({
      data: {
        communityId: community.id,
        authorId: auth.userId,
        title: payload.data.title,
        bodyMarkdown: payload.data.bodyMarkdown,
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
