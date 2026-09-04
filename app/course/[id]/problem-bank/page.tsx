import { CourseProblemBankView } from '@/components/problem-bank/course-problem-bank-view';
import { CourseSpacePageFrame } from '@/components/course-space/course-space-page-frame';
import type { CourseProblemBankInitialFilters } from '@/components/problem-bank/use-course-problem-bank-controller';
import { isLocalDemoProblemBankCourse } from '@/lib/teacher/local-demo-problem-bank';

type CourseProblemBankSearchParams = {
  mock?: string | string[];
  asTeacher?: string | string[];
  notebookId?: string | string[];
  chapter?: string | string[];
  q?: string | string[];
  practice?: string | string[];
  type?: string | string[];
  difficulty?: string | string[];
  status?: string | string[];
};

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function initialFiltersFromSearchParams(
  params: CourseProblemBankSearchParams,
): CourseProblemBankInitialFilters {
  return {
    searchQuery: firstSearchParam(params.q),
    practiceFilter: firstSearchParam(params.practice),
    typeFilter: firstSearchParam(params.type),
    difficultyFilter: firstSearchParam(params.difficulty),
    chapterFilter: firstSearchParam(params.chapter),
    statusFilter: firstSearchParam(params.status),
  };
}

export default async function CourseProblemBankPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<CourseProblemBankSearchParams>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const notebookId = resolvedSearchParams.notebookId;
  const initialNotebookId = typeof notebookId === 'string' ? notebookId : undefined;
  const initialFilters = initialFiltersFromSearchParams(resolvedSearchParams);
  const previewMode =
    firstSearchParam(resolvedSearchParams.mock) === '1' || isLocalDemoProblemBankCourse(id);
  const previewAsTeacher = firstSearchParam(resolvedSearchParams.asTeacher) === '1';

  return (
    <CourseSpacePageFrame>
      <CourseProblemBankView
        courseId={id}
        initialNotebookId={initialNotebookId}
        initialFilters={initialFilters}
        showCourseNavigation
        showChromeBackground={false}
        previewMode={previewMode}
        previewAsTeacher={previewAsTeacher}
      />
    </CourseSpacePageFrame>
  );
}
