import { CourseForumPageClient } from '@/components/course-forum/course-forum-page-client';
import { buildCourseForumMockSnapshot } from '@/features/course-forum/mock/course-forum-mock';

export default async function CourseForumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string; asTeacher?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const mockMode = query.mock === '1';
  const asTeacher = query.asTeacher === '1';

  return (
    <CourseForumPageClient
      courseId={id}
      mockMode={mockMode}
      disableProfileSync={mockMode}
      initialSnapshot={
        mockMode
          ? buildCourseForumMockSnapshot({
              courseId: id,
              status: 'all',
              asTeacher,
            })
          : undefined
      }
    />
  );
}
