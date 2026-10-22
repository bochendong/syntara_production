import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSignInToGoogleTest,
  nativeAccessDecision,
  resolveNativeAccessPolicy,
} from '../../lib/server/native-access-policy.ts';
import {
  createNativeSpeedupState,
  readNativeSpeedupState,
} from '../../lib/server/native-speedup-login.ts';

const now = 1_800_000_000_000;
const user = {
  id: 'fixture',
  role: 'STUDENT',
  isActive: true,
  nativeAppActivatedAt: null,
  accounts: [],
};

test('Google test access is confined to staging and fails closed on typos', () => {
  assert.equal(
    resolveNativeAccessPolicy({
      SYNTARA_NATIVE_ACCESS_POLICY: 'google-test',
      SYNTARA_APP_ENV: 'staging',
    }),
    'google-test',
  );
  for (const environment of ['production', undefined]) {
    assert.equal(
      resolveNativeAccessPolicy({
        SYNTARA_NATIVE_ACCESS_POLICY: 'google-test',
        SYNTARA_APP_ENV: environment,
      }),
      'invalid',
    );
  }
  assert.equal(resolveNativeAccessPolicy({ SYNTARA_NATIVE_ACCESS_POLICY: 'typo' }), 'invalid');
  assert.equal(resolveNativeAccessPolicy({}), 'activation');
});

test('fresh verified Google users can sign in without a pre-existing role or activation', () => {
  const input = {
    provider: 'google',
    verifiedEmail: true,
    email: 'fixture@example.invalid',
    databaseConfigured: true,
  };
  assert.equal(canSignInToGoogleTest(input), true);
  for (const change of [
    { provider: 'github' },
    { verifiedEmail: false },
    { email: '' },
    { isActive: false },
    { databaseConfigured: false },
  ]) {
    assert.equal(canSignInToGoogleTest({ ...input, ...change }), false);
  }
  assert.equal(
    nativeAccessDecision(
      'google-test',
      { ...user, accounts: [{ provider: 'google', expires_at: null }] },
      now,
    ),
    'allowed',
  );
  assert.equal(nativeAccessDecision('google-test', user, now), 'google_required');
  assert.equal(nativeAccessDecision('google-test', { ...user, isActive: false }, now), 'inactive');
});

test('Speedup requires a current identity and eligible role even for activated administrators', () => {
  const speedup = { provider: 'speedup', expires_at: now / 1_000 + 60 };
  assert.equal(nativeAccessDecision('speedup', { ...user, accounts: [speedup] }, now), 'allowed');
  for (const change of [
    { accounts: [] },
    { accounts: [{ ...speedup, expires_at: null }] },
    { accounts: [{ ...speedup, expires_at: now / 1_000 }] },
    { role: 'ADMIN', nativeAppActivatedAt: new Date(now) },
  ]) {
    assert.equal(
      nativeAccessDecision('speedup', { ...user, accounts: [speedup], ...change }, now),
      'speedup_required',
    );
  }
  assert.equal(nativeAccessDecision('invalid', user, now), 'misconfigured');
  assert.equal(nativeAccessDecision('activation', user, now), 'activation_required');
  assert.equal(nativeAccessDecision('activation', { ...user, role: 'ADMIN' }, now), 'allowed');
});

test('Speedup return state rejects forgery, cross-environment secrets, future and expired states', () => {
  const secret = 'staging-fixture-secret-longer-than-32';
  const state = createNativeSpeedupState('ABCD-1234', secret, now);
  assert.equal(readNativeSpeedupState(state, secret, now + 1), 'ABCD-1234');
  assert.equal(readNativeSpeedupState(state, 'production-fixture-different-secret', now), null);
  assert.equal(readNativeSpeedupState(`${state}x`, secret, now), null);
  assert.equal(readNativeSpeedupState(state, secret, now - 1), null);
  assert.equal(readNativeSpeedupState(state, secret, now + 600_000), null);
  for (const malformed of ['', 'a.b.c', 'x'.repeat(1_025)])
    assert.equal(readNativeSpeedupState(malformed, secret, now), null);
  assert.throws(() => createNativeSpeedupState('invalid', secret, now));
});
