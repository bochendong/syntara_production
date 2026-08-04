import { redirect } from 'next/navigation';

export default async function CreatorCourseRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/teacher/courses/${encodeURIComponent(id)}`);
}
