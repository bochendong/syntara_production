import { CourseResourceLibraryPageClient } from '@/components/courses/course-resource-library-page-client';

type CourseResourceLibraryPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<CourseResourceLibrarySearchParams>;
};

type CourseResourceLibrarySearchParams = {
  notebookId?: string | string[];
};

export default async function CourseResourceLibraryPage({
  params,
  searchParams,
}: CourseResourceLibraryPageProps) {
  const { id } = await params;
  const resolvedSearchParams: CourseResourceLibrarySearchParams = searchParams
    ? await searchParams
    : {};
  const initialNotebookId = Array.isArray(resolvedSearchParams.notebookId)
    ? resolvedSearchParams.notebookId[0]
    : resolvedSearchParams.notebookId;
  return <CourseResourceLibraryPageClient courseId={id} initialNotebookId={initialNotebookId} />;
}
