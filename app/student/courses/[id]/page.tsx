import { redirect } from 'next/navigation';

export default async function StudentCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/learn?courseId=${encodeURIComponent(id)}`);
}
