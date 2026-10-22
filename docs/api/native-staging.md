# Native App staging

The test App uses ordinary verified Google accounts. There is no App activation
code or email allowlist. Google must allow external users on its consent screen.
The browser asks the user to confirm the device before issuing App tokens.
New Google testers without accessible courses receive a private `TEST101`
starter course on the first native course-list request. This provisioning is
restricted to `staging` + `google-test`; production does not create test courses.
Only `openid email profile` is requested. Google's
[basic identity exception](https://support.google.com/cloud/answer/15549945?hl=en)
allows ordinary accounts without a test-user allowlist while the OAuth project
remains in Testing. Adding Drive/Gmail or other scopes would invalidate that
exception and requires a separate review of the publishing configuration.

## Deployed resources

- Railway project: `syntara-app` (`8cddd1ea-24e1-49a9-8d27-dce86069dc8b`).
- Environment: `staging` (`6697de1f-eb0d-4a6f-8709-cfe477a29f11`).
- API: `native-api-staging` (`fd6afb05-6491-451a-b577-abf15fdc0047`).
- Origin: <https://native-api-staging-staging-95a1.up.railway.app>.
- Test entry: <https://native-api-staging-staging-95a1.up.railway.app/test>.
  Staging middleware rewrites this to a dedicated Google login page; the existing
  production browser QA route at `/test` is preserved.
- Independent DB: `staging-postgres` (`ce8c8ac4-adfe-4fa3-a6c4-34dafa2bd883`).
  It starts with migrated empty tables, not the private production dataset.
- The previously copied production database remains in the production environment.
- Google project: `Syntara Staging` (`engaged-iridium-512416-h8`).
- OAuth callback: `https://native-api-staging-staging-95a1.up.railway.app/api/auth/callback/google`.

Secrets are configured on the staging API service. `NEXTAUTH_SECRET`,
`SYNTARA_NATIVE_AUTH_SECRET`, `SYSTEM_CONFIG_ENCRYPTION_KEY`, database password,
and Google OAuth client are independent. OpenAI uses the existing key explicitly
approved by the user. No client package contains the OpenAI or Google secret.

## Server policy

Set `SYNTARA_APP_ENV=staging`, `SYNTARA_NATIVE_ACCESS_POLICY=google-test`,
`SYNTARA_NATIVE_API_AUTH_MODE=authenticated`, `SYNTARA_ALLOW_DEMO_AUTH=0`.
Unknown policies and google-test outside staging fail closed. Every device
approval, token exchange, refresh, and authenticated request checks current
database access; disabling a user takes effect on the next authenticated request.
The gateway exposes native API routes, NextAuth Google routes, and the login page.
Other web application routes are excluded by staging middleware.
The staging login layout does not start the web application's sidebars, profile
sync, provider discovery or notification polling.

Railway service settings (configured directly; legacy config-as-code is deprecated):

```text
builder: NIXPACKS
build: pnpm install --frozen-lockfile && pnpm run build
pre-deploy: node node_modules/prisma/build/index.js migrate deploy
start: node node_modules/next/dist/bin/next start --hostname 0.0.0.0
healthcheck: /api/health
port: 3000
region: us-east4-eqdc4a
```

The production AI background worker is not started. Prepare an upload snapshot
with `node scripts/deploy/prepare-native-staging.mjs /absolute/new/directory`.
This copies tracked and scoped untracked source from the isolated task checkout,
excludes legacy Railway deployment files, and records hashes outside the snapshot.
Upload from that directory with explicit project, staging environment and API
service IDs. Never upload the legacy shared WIP checkout. Imported backend scope
and source hashes are recorded in `native-staging-imports.json`.

## Test App build

```bash
pnpm --filter @syntara/native desktop:build:staging
```

This sets the HTTPS API origin at Rust compile time and the frontend channel to
staging. The app is named **Syntara Test**, bundle ID `com.syntara.staging`.
Its app-data directory, SQLite database and keychain entry are separate from
`com.syntara.local`; browser preview IndexedDB uses a separate staging name too.
Cargo output is under `apps/native/src-tauri/target/staging/`.
It builds macOS `.app` with the repository's existing ad-hoc signing setting.
The supported App is the current imported `apps/native/src/App.tsx` with
`CourseWorkspace` and `PhonePages`, recorded in `current-native-imports.json`.
The old desktop home, Haru resources, and standalone profile/calendar components
have been removed. The obsolete test bundle/ZIP created from main was deleted.
Public distribution requires the owner's Apple signing/notarization setup;
this build is not a notarized release or an iOS TestFlight package.

## Production Speedup handoff

The code supports `SYNTARA_NATIVE_ACCESS_POLICY=speedup`: Google login and App
activation do not grant access. It requires a current Speedup identity and at
least one course returned by the existing Speedup entitlement API. Results may
be cached for 20 seconds; expiry/inactive state is checked on every request.

Production needs its own deployment, `NEXTAUTH_URL`, secrets, and the existing
`SPEEDUP_API_BASE_URL`, `SPEEDUP_SSO_CLIENT_ID`, `SPEEDUP_SSO_CLIENT_SECRET`, plus
the real `SPEEDUP_NATIVE_LOGIN_URL` supplied by Speedup. That portal must return
`code` and `courseId` to `/sso/callback` on the same backend hostname. Signed,
short-lived state binds the returning browser to the App device request.
Existing production services have not been switched to this policy.

## Offline checks

```bash
node --experimental-strip-types --test scripts/maintenance/verify-native-access.test.mjs
pnpm native:verify:platform-access
pnpm --filter @syntara/native build
pnpm exec tsc --noEmit --incremental false
pnpm run build
```

OAuth login, device authorization, database migrations and actual AI responses
also require runtime verification; offline checks alone do not establish them.

Known baseline failure: `pnpm native:verify` stops at the committed bundled
problem snapshot hash mismatch. Both the snapshot and check are unchanged from
`b8f38fa8`. The actual SHA-256 of serialized `{courses, problems}` is
`bfbdfc3c1b22ca87273f7b31dd8d84498c952043c70f73bbefb67b4f04651829`;
the recorded value is
`c9515888fdbefc46aff8901ddd5ba3bd163f28277e21acc047ad5ea5b89a3647`.
The remaining assertions in that runner have therefore not run.
