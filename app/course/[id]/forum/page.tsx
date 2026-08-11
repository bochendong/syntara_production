import { CourseForumPageClient } from '@/components/course-forum/course-forum-page-client';

export default async function CourseForumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseForumPageClient courseId={id} />;
}
