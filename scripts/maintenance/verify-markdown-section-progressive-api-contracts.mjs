import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const repository = fs.readFileSync(
  path.join(root, 'lib/server/repositories/notebook-repository.ts'),
  'utf8',
);
const listRoute = fs.readFileSync(
  path.join(root, 'app/api/notebooks/[id]/markdown-sections/route.ts'),
  'utf8',
);
const detailRoute = fs.readFileSync(
  path.join(root, 'app/api/notebooks/[id]/markdown-sections/[sectionId]/route.ts'),
  'utf8',
);
const compatibilityRoute = fs.readFileSync(
  path.join(root, 'app/api/notebooks/[id]/route.ts'),
  'utf8',
);

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

const listRead = functionBody(
  repository,
  'export async function listReadableMarkdownSectionPage',
  'export async function findReadableMarkdownSectionDetail',
);
const detailRead = functionBody(
  repository,
  'export async function findReadableMarkdownSectionDetail',
  'export async function replaceOwnedNotebookScenes',
);

const checks = [
  {
    name: 'list HTTP route defaults to 20 and rejects limits above 50',
    pass:
      /MARKDOWN_SECTION_LIST_DEFAULT_LIMIT = 20/.test(repository) &&
      /MARKDOWN_SECTION_LIST_MAX_LIMIT = 50/.test(repository) &&
      /\.max\(MARKDOWN_SECTION_LIST_MAX_LIMIT\)/.test(listRoute) &&
      /\.default\(MARKDOWN_SECTION_LIST_DEFAULT_LIMIT\)/.test(listRoute),
  },
  {
    name: 'list HTTP route validates opaque cursors',
    pass:
      /decodeMarkdownSectionPageCursor/.test(listRoute) &&
      /Invalid markdown section cursor/.test(listRoute) &&
      /toString\('base64url'\)/.test(repository),
  },
  {
    name: 'list query fetches limit plus one with stable order and cursor boundary',
    pass:
      /LIMIT \$\{limit \+ 1\}/.test(listRead) &&
      /ORDER BY section\."order" ASC, section\."id" ASC/.test(listRead) &&
      /section\."order" > \$\{args\.cursor\.order\}/.test(listRead) &&
      /nextCursor/.test(listRead),
  },
  {
    name: 'list payload excludes markdown, sourceMeta, and scenes',
    pass:
      !/section\."markdown"/.test(listRead) &&
      !/sourceMeta/.test(listRead) &&
      !/Scene|scenes/.test(listRead) &&
      /LEFT\(section\."title", \$\{MARKDOWN_SECTION_TITLE_MAX_CHARS\}::integer\)/.test(listRead) &&
      /LEFT\(section\."summary", \$\{MARKDOWN_SECTION_SUMMARY_MAX_CHARS\}::integer\)/.test(
        listRead,
      ) &&
      /LEFT\(section\."title", \$\{MARKDOWN_SECTION_TITLE_MAX_CHARS\}::integer\)/.test(
        detailRead,
      ) &&
      /LEFT\(section\."summary", \$\{MARKDOWN_SECTION_SUMMARY_MAX_CHARS\}::integer\)/.test(
        detailRead,
      ) &&
      /MARKDOWN_SECTION_TITLE_MAX_CHARS = 200/.test(repository) &&
      /MARKDOWN_SECTION_SUMMARY_MAX_CHARS = 400/.test(repository),
  },
  {
    name: 'detail query returns markdown for exactly one notebook-scoped section',
    pass:
      /section\."markdown"/.test(detailRead) &&
      /section\."notebookId" = \$\{args\.notebookId\}/.test(detailRead) &&
      /section\."id" = \$\{args\.sectionId\}/.test(detailRead) &&
      /LIMIT 1/.test(detailRead),
  },
  {
    name: 'both reads reuse the real owner enrollment access check',
    pass:
      /findReadableNotebookId\(args\.db, args\.userId, args\.notebookId\)/.test(listRead) &&
      /findReadableNotebookId\(args\.db, args\.userId, args\.notebookId\)/.test(detailRead),
  },
  {
    name: 'progressive read functions contain no runtime DDL or scene reads',
    pass:
      !/CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|\$executeRaw/i.test(`${listRead}\n${detailRead}`) &&
      !/db\.scene|FROM "Scene"/.test(`${listRead}\n${detailRead}`),
  },
  {
    name: 'legacy includeMarkdown route remains available during client cutover',
    pass:
      /includeMarkdown = url\.searchParams\.get\('includeMarkdown'\) === '1'/.test(
        compatibilityRoute,
      ) && /findReadableNotebookWithMarkdownSections/.test(compatibilityRoute),
  },
  {
    name: 'HTTP routes are GET-only read surfaces',
    pass:
      /export async function GET/.test(listRoute) &&
      /export async function GET/.test(detailRoute) &&
      !/export async function (?:POST|PUT|PATCH|DELETE)/.test(`${listRoute}\n${detailRoute}`),
  },
  {
    name: 'section reads do not initialize fallback users or credit ledgers',
    pass:
      /requireUserId\(\{ ensureFallbackUser: false \}\)/.test(listRoute) &&
      /requireUserId\(\{ ensureFallbackUser: false \}\)/.test(detailRoute),
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
  console.log('Budgets:');
  console.log(
    '- List: one access check plus one section SQL query, 20 rows by default, 50 maximum, <=200 title and <=400 summary characters per row, no markdown/scenes.',
  );
  console.log(
    '- Detail: one access check plus one section SQL query, exactly one notebook-scoped section, markdown loaded only here.',
  );
  console.log('- Cursor: (order,id), query reads limit+1 rows to derive hasMore without COUNT(*).');
}
