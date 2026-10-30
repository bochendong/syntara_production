import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptSystemSecret, encryptSystemSecret } from '../../lib/server/system-secret-crypto.ts';

function withEnvironment(values, run) {
  const keys = [
    'NODE_ENV',
    'SYSTEM_CONFIG_ENCRYPTION_KEY',
    'ADMIN_LOGIN_SECRET',
    'NEXTAUTH_SECRET',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return run();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

const fixtureKey = 'fixture-dedicated-config-key';
const fixtureSecret = 'fixture-api-credential';
const ciphertext = withEnvironment({ SYSTEM_CONFIG_ENCRYPTION_KEY: fixtureKey }, () =>
  encryptSystemSecret(fixtureSecret),
);

test('every environment requires a dedicated key even when login secrets exist', () => {
  for (const NODE_ENV of ['development', 'test', 'production']) {
    for (const configured of [undefined, '   ']) {
      withEnvironment(
        {
          NODE_ENV,
          SYSTEM_CONFIG_ENCRYPTION_KEY: configured,
          ADMIN_LOGIN_SECRET: 'fixture-admin-secret',
          NEXTAUTH_SECRET: 'fixture-session-secret',
        },
        () => {
          assert.throws(() => encryptSystemSecret(fixtureSecret), /SYSTEM_CONFIG_ENCRYPTION_KEY/);
          assert.throws(() => decryptSystemSecret(ciphertext), /SYSTEM_CONFIG_ENCRYPTION_KEY/);
        },
      );
    }
  }
});

test('development ciphertext is readable in production using the same dedicated key', () => {
  const encrypted = withEnvironment(
    {
      NODE_ENV: 'development',
      SYSTEM_CONFIG_ENCRYPTION_KEY: ` ${fixtureKey} `,
      ADMIN_LOGIN_SECRET: 'fixture-development-login',
    },
    () => encryptSystemSecret(fixtureSecret),
  );
  withEnvironment(
    {
      NODE_ENV: 'production',
      SYSTEM_CONFIG_ENCRYPTION_KEY: fixtureKey,
      ADMIN_LOGIN_SECRET: 'fixture-production-login',
    },
    () => {
      assert.equal(decryptSystemSecret(encrypted), fixtureSecret);
      assert.notEqual(encrypted, encryptSystemSecret(fixtureSecret));
      assert.equal(encrypted.includes(fixtureSecret), false);
    },
  );
});

test('a mismatched dedicated key never falls back to a matching login secret', () => {
  withEnvironment(
    {
      SYSTEM_CONFIG_ENCRYPTION_KEY: 'fixture-different-key',
      ADMIN_LOGIN_SECRET: fixtureKey,
      NEXTAUTH_SECRET: fixtureKey,
    },
    () => assert.throws(() => decryptSystemSecret(ciphertext)),
  );
});

test('legacy plaintext remains readable without encrypting a replacement', () => {
  withEnvironment({}, () => assert.equal(decryptSystemSecret(` ${fixtureSecret} `), fixtureSecret));
});
