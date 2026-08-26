import { redirect } from 'next/navigation';

export default async function CourseForumDirectMessageRedirectPage({
  params,
}: {
  params: Promise<{ id: string; threadId: string }>;
}) {
  const { id, threadId } = await params;
  const forumHref = `/forum?returnTo=${encodeURIComponent(`/course/${id}`)}`;
  redirect(
    `/forum/messages/${encodeURIComponent(threadId)}?returnTo=${encodeURIComponent(forumHref)}`,
  );
}
