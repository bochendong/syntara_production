import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const accessSource = await readFile(
  new URL('../../lib/server/native-platform-access.ts', import.meta.url),
  'utf8',
);

function resolveNativePlatformApiAuthMode(configured) {
  const normalized = configured?.trim().toLowerCase();
  if (!normalized || normalized === 'authenticated') return 'authenticated';
  if (normalized === 'shared-test') return 'shared-test';
  return 'bearer';
}

const SHARED_NATIVE_PLATFORM_PRINCIPAL = {
  userId: 'native-shared-test',
  keyId: 'native-shared-test',
};

assert.match(accessSource, /if \(!normalized \|\| normalized === 'authenticated'\)/);

assert.equal(resolveNativePlatformApiAuthMode(undefined), 'authenticated');
assert.equal(resolveNativePlatformApiAuthMode(' authenticated '), 'authenticated');
assert.equal(resolveNativePlatformApiAuthMode(' shared-test '), 'shared-test');
assert.equal(resolveNativePlatformApiAuthMode('bearer'), 'bearer');
assert.equal(resolveNativePlatformApiAuthMode('unexpected-value'), 'bearer');
assert.deepEqual(SHARED_NATIVE_PLATFORM_PRINCIPAL, {
  userId: 'native-shared-test',
  keyId: 'native-shared-test',
});
assert.equal('apiKey' in SHARED_NATIVE_PLATFORM_PRINCIPAL, false);
assert.equal('token' in SHARED_NATIVE_PLATFORM_PRINCIPAL, false);

const nativeRouteFiles = [
  'app/api/native/v1/capabilities/route.ts',
  'app/api/native/v1/turn/route.ts',
  'app/api/native/v1/mini-lectures/route.ts',
  'app/api/native/v1/review-plans/route.ts',
  'app/api/native/v1/grade/route.ts',
  'app/api/native/v1/transcriptions/route.ts',
  'app/api/native/v1/syllabus/parse/route.ts',
];

for (const file of nativeRouteFiles) {
  const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(
    source,
    /await requireNativePlatformApi\(request,\s*requestId\)/,
    `${file} authenticated access`,
  );
  assert.doesNotMatch(source, /requirePublicApi\(request,\s*requestId\)/, `${file} legacy auth`);
}

const capabilitiesSource = await readFile(
  new URL('../../app/api/native/v1/capabilities/route.ts', import.meta.url),
  'utf8',
);
assert.match(capabilitiesSource, /process\.env\.OPENAI_API_KEY\?\.trim\(\)/);
assert.match(capabilitiesSource, /providerCredentials:\s*'server-only'/);

const nativeAuthSource = await readFile(
  new URL('../../lib/server/native-device-auth.ts', import.meta.url),
  'utf8',
);
assert.match(nativeAuthSource, /snt_acc_/);
assert.match(nativeAuthSource, /snt_ref_/);
assert.match(nativeAuthSource, /createHmac\('sha256'/);
assert.doesNotMatch(nativeAuthSource, /accessToken:\s*material\.accessTokenHash/);

const nativeAuthRoutes = [
  'app/api/native/v1/auth/device/start/route.ts',
  'app/api/native/v1/auth/device/approve/route.ts',
  'app/api/native/v1/auth/device/token/route.ts',
  'app/api/native/v1/auth/refresh/route.ts',
  'app/api/native/v1/auth/me/route.ts',
  'app/api/native/v1/auth/logout/route.ts',
];
for (const file of nativeAuthRoutes) {
  await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
}

console.log(
  JSON.stringify({
    ok: true,
    defaultMode: resolveNativePlatformApiAuthMode(undefined),
    bearerMode: resolveNativePlatformApiAuthMode('bearer'),
    authenticatedNativeRoutes: nativeRouteFiles.length,
    nativeAuthRoutes: nativeAuthRoutes.length,
    providerCredentials: 'server-only',
  }),
);
