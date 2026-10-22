# Empty-account initialization correction

> 历史验收快照：下文的未提交状态、测试账号和部署号描述当时的验收。当前整合范围见 [测试分支整合清单](./native-staging-release.md)。

2026-10-22, America/Toronto. This follows the uncommitted navigation integration
and preserves its Back, calendar, profile, native animation fixes and v2 chat.
Files remain unstaged and uncommitted.

The automatic `TEST101` starter course was an agent-created QA fixture, not the
intended onboarding behavior. Native course listing is now read-only: an account
without owned/joined courses returns an empty list. Its earlier generated course
ID is excluded only in Google staging, preserving the saved database record and
messages. Actual courses are unaffected. Local bundled sample courses remain
restricted by the existing account-membership filter.

The Google staging auth adapter assigns a random marble catalog image in
`createUser` and persists it in the user record. Existing accounts and subsequent
logins keep their saved image. Production profile creation is unchanged. Native
profile/theme code resolves catalog URLs to the Vite-bundled image rather than
requesting a missing relative path from `tauri://localhost`.

Checks passed locally: nine onboarding/access tests, including executing the
actual course handler against adapters that reject database course writes;
scoped Prettier/ESLint with zero warnings; Next production build and root
TypeScript; native TypeScript/Vite and final Tauri staging build; exported app
`codesign --verify --deep --strict`. The prior bundled-snapshot baseline failure
is unchanged and was not rerun. Real creation of an additional Google identity
was not performed; random-avatar initialization is covered offline.

Staging deployment: `ba37fe5f-85fe-4658-b7a9-25669446b603` is successful and online;
the health endpoint returns HTTP 200. The exported macOS app was opened against
that deployment with the existing Google account. Its course screen shows
“账号下还没有课程”; “我的” shows zero courses and zero chats, and its Back button
returns to the empty course screen. Screenshots are included in the package's
`evidence/` directory. This verifies the existing account after removing the
automatic fixture from listing; an additional real Google signup was not tested.

Replacement package directory: `~/Downloads/Syntara-Empty-Start-Test-20261022/`.
The package is arm64/macOS 14+, ad-hoc signed, not Apple-notarized.

验收截图保留在本地工作区和安装包 evidence 目录，未随源码上传 GitHub。
