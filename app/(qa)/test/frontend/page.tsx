import { FrontendPreviewDashboard } from '@/features/qa/frontend-preview/frontend-preview-dashboard';
import { LOCAL_DEMO_TEACHER_HOME_COURSES } from '@/lib/teacher/local-demo-fixtures';

export default function FrontendPreviewPage() {
  return (
    <FrontendPreviewDashboard
      courses={LOCAL_DEMO_TEACHER_HOME_COURSES.map((course) => ({
        id: course.id,
        code: course.courseCode || course.name,
        name: course.name,
        term: [course.academicYear, course.academicTerm].filter(Boolean).join(' '),
      }))}
    />
  );
}
