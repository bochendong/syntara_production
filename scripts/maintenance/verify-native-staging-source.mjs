/** Guard against packaging the retired client or mixing production/staging identities. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const app = read('apps/native/src/App.tsx');
assert.doesNotMatch(
  read('.railwayignore'),
  /^assets\s*$/m,
  'Native UI assets must remain in Railway uploads',
);
assert.ok(existsSync(path.join(root, 'apps/native/src/assets/marbles/r-blue-swirl.webp')));
assert.match(app, /from '\.\/components\/CourseWorkspace'/);
assert.match(app, /useState<AppSurface>\('launch'\)/);
assert.match(app, /<AppNavigationRail/);
assert.match(app, /onOpenCalendar=\{\(\) => setGlobalPage\('calendar'\)\}/);
assert.match(app, /GlobalCalendarApp/);
assert.doesNotMatch(app, /LearnHome|ProfileCenterApp|HaruLive2D/);
assert.match(read('apps/native/src/components/CourseWorkspace.tsx'), /streamNativeChat\(/);
assert.match(read('apps/native/src/ai/chat.ts'), /runNativeChatTurn\(/);
assert.match(read('apps/native/src/components/CourseWorkspace.tsx'), /capabilities\.chat === true/);
assert.match(read('apps/native/src/components/PhonePages.tsx'), /useBackDismiss\(editing/);
assert.match(read('apps/native/src/data/browser-repository.ts'), /Syntara-Native-Preview-Staging/);
assert.match(read('apps/native/src-tauri/src/auth_store.rs'), /app\.config\(\)\.identifier/);
const config = JSON.parse(read('apps/native/src-tauri/tauri.staging.conf.json'));
assert.equal(config.identifier, 'com.syntara.staging');
assert.equal(config.productName, 'Syntara Test');
for (const name of ['LearnHome.tsx', 'ProfileCenterApp.tsx', 'HaruLive2D.tsx'])
  assert.equal(existsSync(path.join(root, 'apps/native/src/components', name)), false);
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/maintenance/verify-retired-chat.mjs')],
  { cwd: root, stdio: 'inherit' },
);
assert.equal(result.status, 0, 'v2 server capability and retired entrypoint guard');
console.log(
  'Staging source guard: current chat-first UI, Back/profile/calendar, native-v2 and isolated staging identities passed.',
);
