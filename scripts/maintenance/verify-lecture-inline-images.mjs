import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Streamdown } from 'streamdown';
import { createJiti } from 'jiti';

const { lectureRehypePlugins, lectureUrlTransform, MAX_LECTURE_IMAGE_URL_LENGTH } =
  await createJiti(import.meta.url)('../../lib/markdown/lecture-images.ts');
const { parseSyntaraArchive } = await createJiti(import.meta.url)(
  '../../apps/native/src/data/archive.ts',
);
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function render(markdown, native = false) {
  return renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        mode: 'static',
        rehypePlugins: lectureRehypePlugins,
        urlTransform: lectureUrlTransform,
        ...(native
          ? { components: { img: ({ src, alt }) => React.createElement('img', { src, alt }) } }
          : {}),
      },
      markdown,
    ),
  );
}

for (const native of [false, true]) {
  assert.match(render(`![diagram](${png})`, native), /<img[^>]*src="data:image\/png;base64,/);
  assert.match(
    render('![diagram](/generated-notebooks/a.png)', native),
    /<img[^>]*src="\/generated-notebooks\/a.png"/,
  );
  assert.doesNotMatch(
    render('![x](data:image/svg+xml;base64,PHN2Zz4=)', native),
    /<img[^>]*src="data:/,
  );
  assert.doesNotMatch(
    render('![x](data:text/html;base64,PHNjcmlwdD4=)', native),
    /<img[^>]*src="data:/,
  );
  assert.doesNotMatch(render('[x](data:image/png;base64,aGVsbG8=)', native), /href="data:/);
  const tooLong = `data:image/png;base64,${'A'.repeat(MAX_LECTURE_IMAGE_URL_LENGTH)}`;
  assert.doesNotMatch(render(`![x](${tooLong})`, native), /<img[^>]*src="data:/);
}
const longMarkdown = `![large](data:image/png;base64,${'A'.repeat(190_000)})`;
const fixture = {
  format: 'syntara-native-archive',
  version: 1,
  courses: [{ id: 'course' }],
  notebooks: [{ id: 'notebook', courseId: 'course', kind: 'markdown' }],
  markdownSections: [{ id: 'section', notebookId: 'notebook', markdown: longMarkdown }],
};
assert.equal(
  parseSyntaraArchive(JSON.stringify(fixture)).markdownSections[0].markdown,
  longMarkdown,
);
console.log('Lecture inline image rendering and protocol checks passed.');
