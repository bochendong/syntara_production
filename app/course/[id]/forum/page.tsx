import { redirect } from 'next/navigation';

export default async function CourseForumRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/forum?returnTo=${encodeURIComponent(`/course/${id}`)}`);
}
