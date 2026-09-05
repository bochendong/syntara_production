import assert from 'node:assert/strict';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
const { resolveCourseSpaceRoute } = await jiti.import(
  '../../lib/course-space/course-space-route.ts',
);
const { CourseSpaceHeader, CourseSpaceHeaderContent } = await jiti.import(
  '../../components/course-space/course-space-header.tsx',
);
const { CourseSpaceShellContext } = await jiti.import(
  '../../components/course-space/course-space-shell-context.tsx',
);

const routeFor = (href) => {
  const url = new URL(href, 'https://example.test');
  return resolveCourseSpaceRoute(url.pathname, url.searchParams);
};
const render = (element) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: {} }, element));

for (const role of ['student', 'teacher']) {
  const sections =
    role === 'student'
      ? ['dashboard', 'resources', 'chat', 'problem-bank', 'forum']
      : ['resources', 'chat', 'problem-bank', 'forum', 'students'];
  for (const active of sections) {
    const markup = render(
      createElement(CourseSpaceHeaderContent, {
        courseId: 'course with space',
        courseTitle: 'CSC148',
        role,
        active,
        forumCount: 123,
        previewMode: true,
      }),
    );
    assert.equal((markup.match(/data-course-space-header/g) || []).length, 1);
    assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
    assert.doesNotMatch(markup, /99\+|>123<|bg-rose-500/);
    const nav = markup.match(/<nav[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav);
    const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((match) =>
      match[1].replaceAll('&amp;', '&'),
    );
    assert.equal(hrefs.length, sections.length);
    for (const [index, href] of hrefs.entries()) {
      assert.deepEqual(routeFor(href), {
        courseId: 'course with space',
        active: sections[index],
        role,
        previewMode: true,
      });
    }
  }
}

const pageHeader = createElement(CourseSpaceHeader, {
  courseId: 'example-course',
  courseTitle: 'CSC148',
  role: 'student',
  active: 'forum',
  actions: createElement('button', null, '发布问题'),
});
const contentMarkup = render(
  createElement(CourseSpaceShellContext.Provider, { value: true }, pageHeader),
);
assert.doesNotMatch(contentMarkup, /<header|<nav/);
assert.match(contentMarkup, /data-course-space-actions/);
assert.match(contentMarkup, /发布问题/);
assert.match(render(pageHeader), /data-course-space-header/);

for (const href of [
  '/learn',
  '/learn?session=example',
  '/teacher',
  '/profile',
  '/classroom/example',
  '/course/c/create-notebook',
  '/course/c/problem-bank/p',
  '/course/%E0%A4%A',
]) {
  assert.equal(routeFor(href), null, `${href} must keep its existing shell`);
}
assert.equal(routeFor('/learn?courseId=c&from=teacher&asStudent=1').role, 'student');
assert.equal(routeFor('/course/c/forum').role, null);
assert.equal(routeFor('/course/c/problem-bank').role, null);

console.log(
  `PASS: course navigation destinations, active tabs, badge removal, and shared header actions (${path.basename(process.cwd())})`,
);
