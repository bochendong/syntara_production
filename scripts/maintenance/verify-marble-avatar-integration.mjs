import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const load = (file) => jiti.import(new URL('../../' + file, import.meta.url).href);
const shared = await load('lib/constants/marble-avatars.ts');
const courses = await load('lib/constants/course-avatars.ts');
const notebooks = await load('lib/constants/notebook-agent-avatars.ts');
const users = await load('lib/constants/user-avatars.ts');
const agents = await load('lib/constants/agent-defaults.ts');
const nextConfig = (await load('next.config.ts')).default;
const catalog = shared.MARBLE_AVATAR_CATALOG;
const manifest = JSON.parse(
  await readFile(
    new URL('../../public/avatars/marble-collection-v1/manifest.json', import.meta.url),
    'utf8',
  ),
);
assert.deepEqual(
  catalog,
  manifest.avatars.map((a) => ({
    id: a.id,
    name: a.name,
    rarity: a.rarity,
    species: a.species,
    filename: a.filename,
    url: a.image,
  })),
);
assert.equal(catalog.length, 45);
assert.equal(new Set(catalog.map((a) => a.id)).size, 45);
assert.equal(new Set(catalog.map((a) => a.url)).size, 45);
assert.deepEqual(
  catalog.reduce((counts, a) => ({ ...counts, [a.rarity]: (counts[a.rarity] || 0) + 1 }), {}),
  { R: 24, SR: 12, SSR: 4, EX: 5 },
);
assert.deepEqual(users.USER_AVATAR_PRESET_URLS, courses.COURSE_AVATAR_PRESET_URLS);
assert.deepEqual(users.USER_AVATAR_PRESET_URLS, notebooks.NOTEBOOK_AGENT_AVATAR_PRESET_URLS);
assert.deepEqual(users.USER_AVATAR_PRESET_URLS, agents.AGENT_DEFAULT_AVATARS);
assert.equal(users.DEFAULT_USER_PRESET_AVATAR, catalog[0].url);
assert.equal(nextConfig.rewrites, undefined);
await Promise.all(catalog.map((a) => access(new URL('../../public' + a.url, import.meta.url))));
for (const value of [
  'data:image/png;base64,test',
  'https://example.com/me.avif',
  '/uploads/my-photo.webp',
]) {
  assert.equal(courses.resolveCourseAvatarDisplayUrl('course-a', value), value);
  assert.equal(notebooks.resolveNotebookAgentAvatarDisplayUrl('book-a', value), value);
}
assert.equal(
  courses.pickStableCourseAvatarUrl('course-a'),
  courses.pickStableCourseAvatarUrl('course-a'),
);
assert.equal(
  notebooks.pickStableNotebookAgentAvatarUrl('book-a'),
  notebooks.pickStableNotebookAgentAvatarUrl('book-a'),
);
const baseUrl = process.env.AVATAR_VERIFY_BASE_URL;
if (baseUrl) {
  const queue = [...catalog];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const item = queue.shift();
        const response = await fetch(new URL(item.url, baseUrl));
        assert.equal(response.status, 200, item.url);
        assert.match(response.headers.get('content-type') || '', /image\/webp/u);
        const expected = await readFile(new URL('../../public' + item.url, import.meta.url));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
      }
    }),
  );
}
console.log(
  JSON.stringify({
    ok: true,
    directlySelectableAvatars: catalog.length,
    httpVerified: Boolean(baseUrl),
  }),
);
