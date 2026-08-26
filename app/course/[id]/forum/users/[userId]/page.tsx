import { redirect } from 'next/navigation';

export default async function CourseForumUserRedirectPage({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}) {
  const { id } = await params;
  redirect(`/forum?returnTo=${encodeURIComponent(`/course/${id}`)}`);
}
