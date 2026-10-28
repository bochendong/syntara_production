import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { '@': root } });
const { codePreflightSchema, validateCodeQuestion, verifyCodePreflight } = jiti(
  path.join(root, 'lib/server/course-code-preflight.ts'),
);
const { createStructuredCourseProblemImportService } = jiti(
  path.join(root, 'lib/server/course-problem-import.ts'),
);
function fixture() {
  return codePreflightSchema.parse({
    courseId: 'course',
    draft: {
      draftId: 'increment',
      title: 'Increment an integer',
      type: 'code',
      status: 'published',
      source: 'manual',
      points: 100,
      publicContent: {
        type: 'code',
        language: 'python',
        stem: 'Return the integer after x.',
        starterCode:
          'def increment(x: int) -> int:\n    """Return x plus one.\n    >>> increment(1)\n    2\n    >>> increment(0)\n    1\n    """\n    pass\n',
        statementSections: ['overview', 'requirements', 'interface', 'examples', 'constraints'].map(
          (kind) => ({ id: kind, kind, title: kind, body: 'Return x plus one.' }),
        ),
        publicTestCode:
          'import unittest\nfrom submission import increment\nclass Public(unittest.TestCase):\n    def test_positive(self): self.assertEqual(increment(1), 2)\n    def test_zero(self): self.assertEqual(increment(0), 1)\n',
        sampleIO: [
          { input: 'increment(1)', output: '2' },
          { input: 'increment(0)', output: '1' },
        ],
      },
      grading: {
        type: 'code',
        solutionCode:
          'def increment(x: int) -> int:\n    """Return x plus one."""\n    return x + 1\n',
      },
      secretJudge: {
        language: 'python',
        secretTests: [],
        secretTestCode:
          'import unittest\nfrom submission import increment\nclass Secret(unittest.TestCase):\n    def test_negative(self): self.assertEqual(increment(-2), -1)\n    def test_large(self): self.assertEqual(increment(1000), 1001)\n    def test_boundary(self): self.assertEqual(increment(-1), 0)\n',
        timeoutMs: 5000,
      },
    },
    counterexamples: [
      {
        id: 'identity',
        code: 'def increment(x: int) -> int:\n    return x\n',
        reason: 'Forgets to add one.',
      },
    ],
  });
}
const actor = { userId: 'owner', keyId: 'device' };
test('real isolated runner preflight rejects starter and incorrect code; signed proof binds complete draft and principal', async () => {
  const old = process.env.NEXTAUTH_SECRET;
  const oldStage = process.env.SYNTARA_APP_ENV;
  process.env.SYNTARA_APP_ENV = 'staging';
  process.env.NEXTAUTH_SECRET = 'test-preflight-secret-not-used-outside-fixture';
  try {
    const input = fixture();
    input.draft.grading.solutionCode = input.draft.publicContent.starterCode.replace(
      '    pass',
      '    return x + 1',
    );
    input.counterexamples[0].code = input.draft.publicContent.starterCode.replace(
      '    pass',
      '    return x',
    );
    const result = await validateCodeQuestion(input, actor);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.referencePassed, true);
    assert.equal(result.starterRejected, true);
    assert.equal(result.incorrectRejected, true);
    assert.equal(result.publicCases, 2);
    assert.equal(result.privateCases, 3);
    const args = { ...actor, courseId: input.courseId, draft: result.validatedDraft };
    assert.equal(verifyCodePreflight(result.proof, args), true);
    assert.equal(verifyCodePreflight(result.proof, { ...args, courseId: 'other' }), false);
    assert.equal(verifyCodePreflight(result.proof, { ...args, keyId: 'other' }), false);
    assert.equal(verifyCodePreflight(result.proof, { ...args, userId: 'other' }), false);
    assert.equal(
      verifyCodePreflight(result.proof, {
        ...args,
        draft: {
          ...args.draft,
          secretJudge: { ...args.draft.secretJudge, secretTestCode: 'changed' },
        },
      }),
      false,
    );
    assert.equal(
      verifyCodePreflight(result.proof, { ...args, draft: { ...args.draft, title: 'Changed' } }),
      false,
    );
    assert.equal(
      verifyCodePreflight(result.proof, { ...args, now: Date.now() + 25 * 60 * 60 * 1000 }),
      false,
    );
    const manifest = {
      version: 1,
      courseId: 'course',
      idempotencyKey: 'test-code-preflight',
      chapters: [{ ref: 'functions', name: 'Functions' }],
      items: [
        { chapterRef: 'functions', draft: result.validatedDraft, codePreflight: result.proof },
      ],
    };
    const db = {
      course: { findUnique: async () => ({ id: 'course', name: 'Fixture', ownerId: 'owner' }) },
      courseProblemChapter: { findFirst: async () => null },
      problemImportBatch: { findUnique: async () => null },
    };
    const service = createStructuredCourseProblemImportService({
      db,
      store: {},
      writeDrafts: async () => {
        throw Error('No write expected');
      },
    });
    assert.equal((await service.preview(manifest, actor)).typeCounts.code, 1);
    await assert.rejects(
      service.preview(
        { ...manifest, items: [{ ...manifest.items[0], codePreflight: 'forged' }] },
        actor,
      ),
      /preflight/,
    );
    await assert.rejects(
      service.preview(
        { ...manifest, items: [{ ...manifest.items[0], codePreflight: undefined }] },
        actor,
      ),
      /preflight/,
    );
  } finally {
    if (oldStage === undefined) delete process.env.SYNTARA_APP_ENV;
    else process.env.SYNTARA_APP_ENV = oldStage;
    if (old === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = old;
  }
});
test('a candidate equivalent to the reference cannot obtain a proof', async () => {
  const input = fixture();
  input.draft.grading.solutionCode = input.draft.publicContent.starterCode.replace(
    '    pass',
    '    return x + 1',
  );
  input.counterexamples[0].code = input.draft.grading.solutionCode;
  const result = await validateCodeQuestion(input, actor);
  assert.equal(result.valid, false);
  assert.equal(result.incorrectRejected, false);
  assert.equal(result.proof, undefined);
});

test('multipart preflight validates every code part and binds private helper and shared prompt', async () => {
  const old = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'fixture-multipart-preflight-secret';
  try {
    const input = fixture();
    const child = input.draft;
    child.publicContent.statementSections = [];
    child.grading.solutionCode = child.publicContent.starterCode.replace(
      '    pass',
      '    return helper(x)',
    );
    child.publicContent.assumedHelpers = ['helper'];
    const secret = { ...child.secretJudge, supportCode: 'def helper(x):\n    return x + 1\n' };
    const draft = {
      ...child,
      type: 'multipart',
      draftId: 'independent-parts',
      publicContent: {
        type: 'multipart',
        stem: 'Use the helper, assumed correct.',
        parts: ['a', 'b'].map((label) => ({ label, points: 1, content: child.publicContent })),
      },
      grading: {
        type: 'multipart',
        parts: ['a', 'b'].map((label) => ({ label, grading: child.grading })),
      },
      secretJudge: { language: 'python', secretTests: [], parts: { a: secret, b: secret } },
    };
    const code = child.publicContent.starterCode.replace('    pass', '    return x');
    const counterexamples = ['a', 'b'].map((part) => ({
      part,
      id: 'wrong-' + part,
      code,
      reason: 'Omits increment.',
    }));
    const request = { courseId: 'course', draft, counterexamples };
    await assert.rejects(
      validateCodeQuestion({ ...request, counterexamples: [counterexamples[0]] }, actor),
      /Each code part/,
    );
    await assert.rejects(
      validateCodeQuestion(
        { ...request, counterexamples: [{ ...counterexamples[0], part: 'missing' }] },
        actor,
      ),
      /existing code part/,
    );
    const result = await validateCodeQuestion(request, actor);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.parts.length, 2);
    assert.equal(result.starterRejected, true);
    assert.equal(result.incorrectRejected, true);
    const args = { ...actor, courseId: 'course', draft: result.validatedDraft };
    assert.equal(verifyCodePreflight(result.proof, args), true);
    assert.equal(verifyCodePreflight(result.proof, { ...args, keyId: 'different' }), false);
    const changed = structuredClone(result.validatedDraft);
    changed.publicContent.stem = 'Changed shared condition';
    assert.equal(verifyCodePreflight(result.proof, { ...args, draft: changed }), false);
    changed.publicContent.stem = result.validatedDraft.publicContent.stem;
    changed.secretJudge.parts.b.supportCode = 'def helper(x): return 0';
    assert.equal(verifyCodePreflight(result.proof, { ...args, draft: changed }), false);
    assert.equal(
      JSON.stringify(result.validatedDraft.publicContent).includes('return x + 1'),
      false,
    );
    const altered = structuredClone(request);
    altered.counterexamples[0].code = code.replace('def increment(', 'def changed(');
    const invalid = await validateCodeQuestion(altered, actor);
    assert.equal(invalid.valid, false);
    assert.equal(invalid.proof, undefined);
  } finally {
    if (old === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = old;
  }
});

test('preflight applies the authorized course contract used by student submissions', async () => {
  const input = fixture();
  const starter = 'def increment(x: int) -> int:\n    pass\n';
  input.draft.publicContent.starterCode = starter;
  input.draft.grading.solutionCode = starter.replace('    pass', '    return x + 1');
  input.counterexamples[0].code = starter.replace('    pass', '    return x');
  const result = await validateCodeQuestion(input, actor, {
    id: 'course',
    name: 'UTSG-CSC108Y',
    courseCode: 'CSC108',
  });
  assert.equal(result.valid, false);
  assert.equal(result.referencePassed, false);
  assert.match(result.referenceResult.result.feedback, /contract checks failed/);
  assert.equal(result.proof, undefined);
});
