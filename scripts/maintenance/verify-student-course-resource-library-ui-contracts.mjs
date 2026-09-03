import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [headerSource, learnSource, resourcePageSource, resourceClientSource, teacherStudioSource] =
  await Promise.all([
    readFile('components/course-space/course-space-header.tsx', 'utf8'),
    readFile('components/learn/learn-page-client.tsx', 'utf8'),
    readFile('app/course/[id]/resources/page.tsx', 'utf8'),
    readFile('components/courses/course-resource-library-page-client.tsx', 'utf8'),
    readFile('components/teacher/teacher-course-studio-client.tsx', 'utf8'),
  ]);

assert.match(
  headerSource,
  /role === 'teacher'[\s\S]*\/teacher\/courses\/[\s\S]*\/course\/\$\{encodedCourseId\}\/resources/,
  'course header must expose the role-aware resource-library destination',
);
assert.match(
  learnSource,
  /router\.push\(`\/course\/\$\{encodeURIComponent\(activeCourse\.id\)\}\/resources`\)/,
  'learn workspace resource action must navigate to the standalone page',
);
assert.match(
  learnSource,
  /resources\?notebookId=\$\{encodeURIComponent\(notebook\.id\)\}/,
  'learning-progress notebook action must preserve the selected notebook',
);
assert.doesNotMatch(
  learnSource,
  /<span>打开资料库<\/span>/,
  'the duplicate right-rail resource card must be removed',
);
assert.match(
  resourcePageSource,
  /initialNotebookId=\{initialNotebookId\}/,
  'the standalone route must forward a requested notebook selection',
);
assert.match(
  resourceClientSource,
  /<CourseSpaceHeader[\s\S]*active="resources"/,
  'the standalone student resource page must render the shared course header',
);
assert.match(
  resourceClientSource,
  /<CourseSpaceImageCard[\s\S]*imageUrl=\{courseBackgroundUrl\}/,
  'the student resource page must reuse the shared course artwork card',
);
assert.match(
  teacherStudioSource,
  /<CourseSpaceImageCard[\s\S]*resolveCourseBackgroundDisplayUrl\(course\.id\)/,
  'the teacher resource library must use the same shared course artwork card',
);
assert.match(
  resourceClientSource,
  /<TabsTrigger value="notebooks"[\s\S]*笔记本/,
  'the standalone resource page must provide the notebook-library view',
);
assert.match(
  resourceClientSource,
  /<NotebookLibraryCardFace notebook=\{notebook\} \/>/,
  'the standalone page must retain the notebook shelf card presentation',
);

console.log('Student course resource-library UI contracts verified.');
