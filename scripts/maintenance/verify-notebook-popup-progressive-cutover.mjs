import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const client = fs.readFileSync(path.join(root, 'components/learn/learn-page-client.tsx'), 'utf8');
const listRoute = fs.readFileSync(
  path.join(root, 'app/api/notebooks/[id]/markdown-sections/route.ts'),
  'utf8',
);
const detailRoute = fs.readFileSync(
  path.join(root, 'app/api/notebooks/[id]/markdown-sections/[sectionId]/route.ts'),
  'utf8',
);

const checks = [
  {
    name: 'overview no longer auto-hydrates the notebook list',
    pass: !/rightRailView !== 'overview'[\s\S]{0,240}ensureNotebooksLoaded\(\)/.test(client),
  },
  {
    name: 'course UI describes notebooks as an in-course popup, not a removed page',
    pass: /笔记本在课程内弹窗中按需查看/.test(client) && !/独立笔记本页/.test(client),
  },
  {
    name: 'popup client no longer calls legacy includeMarkdown detail',
    pass: !/includeMarkdown=1/.test(client) && !/loadNotebookMarkdownPreview/.test(client),
  },
  {
    name: 'popup fetches 20 section metadata rows then one section detail',
    pass:
      /new URLSearchParams\(\{ limit: '20' \}\)/.test(client) &&
      /\/markdown-sections\?\$\{params\.toString\(\)\}/.test(client) &&
      /\/markdown-sections\/\$\{encodeURIComponent\(\s*sectionId/.test(client),
  },
  {
    name: 'notebook and section responses have separate caches',
    pass:
      /notebookMarkdownPageCache/.test(client) &&
      /notebookMarkdownSectionCache/.test(client) &&
      /`\$\{notebookId\}:\$\{sectionId\}`/.test(client),
  },
  {
    name: 'chapter switching and load-more controls use progressive loaders',
    pass:
      /setSelectedNotebookSectionIds/.test(client) &&
      /加载更多章节/.test(client) &&
      /loadNotebookMarkdownPageForPopup\(\s*selectedNotebookLibraryId,\s*true/s.test(client),
  },
  {
    name: 'failed popup reads stop automatic retry storms and retry only on demand',
    pass:
      /async \(notebookId: string, loadMore = false, force = false\)/.test(client) &&
      /\(!force && current\?\.status === 'failed'\)/.test(client) &&
      /async \(notebookId: string, sectionId: string, force = false\)/.test(client) &&
      /loadNotebookMarkdownPageForPopup\(\s*selectedNotebookLibraryId,\s*false,\s*true/s.test(
        client,
      ) &&
      /loadNotebookMarkdownSectionForPopup\(\s*selectedNotebookLibraryId,\s*selectedNotebookSectionId,\s*true/s.test(
        client,
      ),
  },
  {
    name: 'legacy source fallback has explicit notebook and detail caps',
    pass:
      /slice\(0, 4\)/.test(client) &&
      /selectedCandidates[\s\S]{0,260}\.slice\(0, 6\)/.test(client) &&
      /loadBoundedNotebookMarkdownText/.test(client) &&
      !/textNotebookIds\.map\(\(notebookId\) => loadNotebookMarkdownPreview/.test(client),
  },
  {
    name: 'image notebooks fetch only a first-slide or cover preview after selection',
    pass:
      /getFirstSlideByStages\(\[notebookId\]\)/.test(client) &&
      /selectedNotebookLibraryTile\.coverImagePath/.test(client) &&
      /正在加载首张预览/.test(client) &&
      !/\/scenes/.test(
        client.slice(
          client.indexOf('const loadNotebookImagePreviewForPopup'),
          client.indexOf(
            'useEffect(() => {',
            client.indexOf('const loadNotebookImagePreviewForPopup'),
          ),
        ),
      ),
  },
  {
    name: 'image notebook exposes an explicit reader action',
    pass:
      /进入阅读器/.test(client) &&
      /router\.push\(\s*`\/classroom\/\$\{encodeURIComponent\(selectedNotebookLibraryId\)\}`/s.test(
        client,
      ),
  },
  {
    name: 'server list and detail routes remain hard-bounded',
    pass:
      /\.max\(MARKDOWN_SECTION_LIST_MAX_LIMIT\)/.test(listRoute) &&
      /findReadableMarkdownSectionDetail/.test(detailRoute),
  },
];

for (const check of checks) {
  if (!check.pass) {
    console.error(`FAIL: ${check.name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${check.name}`);
  }
}

if (!process.exitCode) {
  console.log('');
  console.log('Client budgets:');
  console.log('- Popup open: notebook metadata list only; no section body and no scenes.');
  console.log('- Markdown click: <=20 section metadata + exactly one selected body request.');
  console.log('- Load more: <=20 additional metadata rows per click.');
  console.log('- Legacy source fallback: <=4 notebooks and <=6 section bodies.');
  console.log(
    '- Image click: one cover/first-slide preview request, then explicit reader navigation.',
  );
}
