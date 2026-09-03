import { CourseResourceLibraryPageClient } from '@/components/courses/course-resource-library-page-client';

type CourseResourceLibraryPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<CourseResourceLibrarySearchParams>;
};

type CourseResourceLibrarySearchParams = {
  tab?: string | string[];
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
  const initialTab = Array.isArray(resolvedSearchParams.tab)
    ? resolvedSearchParams.tab[0]
    : resolvedSearchParams.tab;
  const initialNotebookId = Array.isArray(resolvedSearchParams.notebookId)
    ? resolvedSearchParams.notebookId[0]
    : resolvedSearchParams.notebookId;
  return (
    <CourseResourceLibraryPageClient
      courseId={id}
      initialTab={initialTab}
      initialNotebookId={initialNotebookId}
    />
  );
}
