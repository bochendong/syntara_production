#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const previousTypeScriptLoader = require.extensions['.ts'];
const previousSigningSecret = process.env.NEXTAUTH_SECRET;
const previousNodeEnv = process.env.NODE_ENV;

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

process.env.NEXTAUTH_SECRET = 'contract-only-learn-handoff-secret-with-at-least-32-characters';

try {
  const handoffModulePath = path.join(
    repositoryRoot,
    'features',
    'learn-core',
    'server',
    'trusted-answerer-handoff.ts',
  );
  const { issueTrustedLearnAnswererHandoff, verifyTrustedLearnAnswererHandoff } = require(
    handoffModulePath,
  );

  const now = 1_000_000;
  const decision = {
    answerMode: 'course_answer',
    replyText: '',
    directCalls: [],
    proposals: [],
    artifacts: [],
    reason: 'proof route',
    confidence: 0.9,
    trace: {
      runId: 'learn-run-proof',
      startedAt: new Date(now).toISOString(),
      steps: [],
      toolCalls: [],
      handoffs: [
        {
          id: 'handoff-proof',
          from: 'learn_core',
          to: 'course_answerer',
          intent: 'course_answer',
          reasonSummary: 'Preserve proof-quality constraints.',
          evidence: [
            {
              id: 'question',
              sourceType: 'user_message',
              quoteOrSummary: 'Prove the theorem.',
              supports: 'The learner requested a proof.',
            },
          ],
          requiredBehavior: ['State the induction parameter and exact smaller object.'],
          forbiddenBehavior: ['Do not use the target theorem as a premise.'],
          missingEvidence: [],
          resourceStates: {
            notebooks: 'ready',
            problems: 'idle',
            sources: 'ready',
          },
          createdAt: new Date(now).toISOString(),
        },
      ],
    },
  };
  const issueArgs = {
    decision,
    userId: 'contract-user',
    courseId: 'contract-course',
    question: '  Prove the theorem. ',
    now,
  };
  const token = issueTrustedLearnAnswererHandoff(issueArgs);
  assert.equal(typeof token, 'string');

  const verifyArgs = {
    token,
    userId: 'contract-user',
    courseId: 'contract-course',
    question: 'Prove the theorem.',
    now: now + 1_000,
  };
  const verified = verifyTrustedLearnAnswererHandoff(verifyArgs);
  assert.ok(verified);
  assert.deepEqual(verified.requiredBehavior, [
    'State the induction parameter and exact smaller object.',
  ]);
  assert.deepEqual(verified.forbiddenBehavior, ['Do not use the target theorem as a premise.']);
  assert.equal(verified.resourceStates?.problems, 'unknown');

  assert.equal(
    verifyTrustedLearnAnswererHandoff({ ...verifyArgs, userId: 'other-user' }),
    undefined,
  );
  assert.equal(
    verifyTrustedLearnAnswererHandoff({ ...verifyArgs, courseId: 'other-course' }),
    undefined,
  );
  assert.equal(
    verifyTrustedLearnAnswererHandoff({ ...verifyArgs, question: 'Prove a different theorem.' }),
    undefined,
  );
  assert.equal(
    verifyTrustedLearnAnswererHandoff({ ...verifyArgs, question: 'Prove  the theorem.' }),
    undefined,
  );
  assert.equal(
    verifyTrustedLearnAnswererHandoff({ ...verifyArgs, now: now + 10 * 60 * 1_000 }),
    undefined,
  );

  const replacement = token.endsWith('A') ? 'B' : 'A';
  assert.equal(
    verifyTrustedLearnAnswererHandoff({
      ...verifyArgs,
      token: `${token.slice(0, -1)}${replacement}`,
    }),
    undefined,
  );

  delete process.env.NEXTAUTH_SECRET;
  process.env.NODE_ENV = 'production';
  assert.equal(
    issueTrustedLearnAnswererHandoff(issueArgs),
    undefined,
    'Missing production signing material must degrade to the generic handoff.',
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checked: [
          'valid signed handoff round-trip',
          'user/course/question binding',
          'expiry enforcement',
          'signature tamper rejection',
          'planner behavior preservation',
          'missing-secret safe degradation',
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  require.extensions['.ts'] = previousTypeScriptLoader;
  if (previousSigningSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = previousSigningSecret;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}
