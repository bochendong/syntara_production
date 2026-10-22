# Current App browser staging

> 历史验收快照：下文的未提交状态、测试账号和部署号描述当时的验收。当前整合范围见 [测试分支整合清单](./native-staging-release.md)。

2026-10-22, America/Toronto. The browser release reuses `apps/native/src/App.tsx`,
`CourseWorkspace`, the total calendar, current profile and native v2 chat.
It preserves the uncommitted native/navigation and empty-account corrections.
No changes are staged or committed.

The public entry remains `/test`. Google login returns there and automatically
opens `/test/app`. A staging-only Vite build is generated under the ignored
`public/native-web/` directory during the Railway build, independently of the
native build channel. Outside Google staging this build step is skipped.

Browser requests use the existing HttpOnly NextAuth cookie and same-origin
`/api/native/` routes. No native access/refresh token or provider credential is
issued to browser JavaScript or persisted in browser storage. Browser mutations
require the configured Origin; access rechecks the active database user and
Google policy. Each request includes the expected user ID to reject stale tabs
after switching accounts. Native bearer authentication retains its existing path.
Production Speedup policy and the production deployment are unchanged.

Browser IndexedDB, learner profile, last/pinned chats, memory review times and
sync queues are account scoped. Browser bootstrap does not install demo courses,
conversations, notebooks, problems or memories. New accounts start empty. Course
creation is explicit through the empty screen or course drawer; the server assigns
the authenticated owner. Conversations use the existing platform synchronization;
local learning tools and preferences retain the current App's local-first behavior.

Checks: twelve offline browser/access/onboarding tests, including origin/identity
checks and one-byte Unicode SSE chunks; Back and empty-membership regression
checks; scoped lint/format; Next production build and root TypeScript; native
TypeScript/Vite build; staging current-source guard. Live verification passed on the published deployment. The old bundled snapshot baseline failure was not rerun.

Deployment: `81b6abb7-fcf7-4ceb-9c8d-1d42081009e8` (SUCCESS, online).

The first upload excluded nested native images through an unanchored `assets`
rule. The rule now excludes only root `/assets`; a case-sensitive preflight
verified 115 relative frontend modules/assets against the source snapshot and
upload exclusions. Local production HTTP routing also served `/test/app` and
its JS successfully, while unauthenticated account/course/AI requests returned
401 and old web learning routes returned 404.

## Live acceptance

The existing Google account automatically entered `/test/app` with zero courses.
An explicitly created disposable course opened the current chat workspace. A real
native-v2 AI request returned HTTP 200 and the reply appeared in the browser; two
messages were independently verified in PostgreSQL. Reload and Google signout /
signin restored the same chat. Total calendar, current profile and Back passed.
At 390×844 and 1280×900 the page had no horizontal overflow; phone menu → profile
→ Back returned to the drawer correctly. Normal usage had no browser console errors.

The exact disposable course and its cascading conversation/messages were removed;
PostgreSQL confirmed zero remaining fixture rows and the refreshed UI returned to
zero courses. The temporary maintenance SSH key was revoked and its generated
local key files removed. Other keys and all pre-existing data were preserved.
The browser viewport was reset and the signed-in App was left open.

No extra real Google identity was registered. Image/voice generation and uploads
were not exercised live; those paths use the shared interface and cookie API bridge.
Courses and conversations synchronize with the account; local study tools and
preferences keep the current App's local-first behavior. This release does not
rebuild desktop/mobile install packages.

验收截图保留在本地工作区和安装包 evidence 目录，未随源码上传 GitHub。
