import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const studio = read('components/teacher/teacher-course-studio-client.tsx');
const imageCard = read('components/course-space/course-space-image-card.tsx');
const onlineStudio = read('lib/teacher/online-course-studio.ts');
const studioRoute = read('app/api/teacher/courses/[courseId]/studio/route.ts');
const backgrounds = read('lib/constants/course-backgrounds.ts');

const checks = [
  {
    name: 'course overview uses a stable random built-in background',
    pass:
      studio.includes('resolveCourseBackgroundDisplayUrl(course.id)') &&
      studio.includes('<CourseSpaceImageCard') &&
      imageCard.includes('sizes="(min-width: 1536px) 1472px, 100vw"') &&
      backgrounds.includes('hashStringToUint32(seed) % COURSE_BACKGROUND_FILES.length'),
  },
  {
    name: 'studio payload carries an authoritative student count',
    pass:
      onlineStudio.includes('studentCount: number;') &&
      onlineStudio.includes('studentCount: payload.course.studentCount') &&
      studioRoute.includes('prisma.courseEnrollment.count') &&
      studioRoute.includes("role: 'STUDENT'") &&
      studioRoute.includes('active: true'),
  },
  {
    name: 'overview exposes a compact bento dashboard with student roster access',
    pass:
      studio.includes('课程仪表盘') &&
      studio.includes('内容资产') &&
      studio.includes('value={course.studentCount}') &&
      studio.includes('label="学生"') &&
      studio.includes('/students${') &&
      studio.includes('lg:grid-cols-12') &&
      studio.includes('lg:col-span-6') &&
      studio.includes('min-h-[7.75rem]') &&
      studio.includes('size-3.5'),
  },
  {
    name: 'hero and metric cards stay proportionate to compact course navigation',
    pass:
      imageCard.includes('min-h-[12.5rem]') &&
      imageCard.includes('sm:min-h-[14rem]') &&
      !imageCard.includes('min-h-[20rem]'),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
