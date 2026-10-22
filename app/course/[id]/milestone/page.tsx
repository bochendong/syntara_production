import { redirect } from 'next/navigation';

/** The retired reward page keeps old links usable by returning to the course. */
export default async function CourseMilestonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/course/${encodeURIComponent(id)}`);
}
