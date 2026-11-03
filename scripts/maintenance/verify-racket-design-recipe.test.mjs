import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { runRacketDesignRecipe } = await jiti.import('../../lib/server/racket-runner.ts');
const starter = `(require spd/tags)
(@htdf twice)
(define (twice x) 0)
`;
const reference = `(require spd/tags)
(@htdf twice)
(@signature Number -> Number)
(check-expect (twice 0) 0)
(check-expect (twice 3) 6)
(@template-origin Number)
(@template (define (twice x) (... x)))
(define (twice x) (* 2 x))
`;
const check = (studentCode) =>
  runRacketDesignRecipe({
    studentCode,
    referenceCode: reference,
    starterCode: starter,
    level: 'beginner',
    recipe: { checkTemplate: true, weight: 30, thoroughness: [] },
    timeoutMs: 5000,
  });

test('reference passes the real design recipe driver and starter is rejected', async () => {
  const good = await check(reference);
  assert(good.length > 0);
  assert(
    good.every((item) => item.passed),
    JSON.stringify(good),
  );
  const empty = await check(starter);
  assert(
    empty.some((item) => !item.passed),
    JSON.stringify(empty),
  );
});

test('renamed function parameters preserve equivalent templates', async () => {
  const result = await check(
    reference
      .replaceAll('(twice x)', '(twice y)')
      .replaceAll('... x', '... y')
      .replaceAll('* 2 x', '* 2 y'),
  );
  assert(
    result.every((item) => item.passed),
    JSON.stringify(result),
  );
});

test('incorrect signatures are rejected', async () => {
  const result = await check(reference.replace('Number -> Number', 'Number -> String'));
  assert(
    result.some((item) => !item.passed && /signature/.test(item.id)),
    JSON.stringify(result),
  );
});

test('templates missing the parameter are rejected', async () => {
  const result = await check(reference.replace('(... x)', '(... 1)'));
  assert(
    result.some((item) => !item.passed && /template/.test(item.id)),
    JSON.stringify(result),
  );
});

test('student tests are checked against the reference implementation', async () => {
  const result = await check(reference.replace('(twice 3) 6', '(twice 3) 7'));
  assert(
    result.some((item) => !item.passed),
    JSON.stringify(result),
  );
});

// UBC CPSC 110 2020 W1 MT1 P2-3: the stub and purpose are comments, checked on the text.
const ddStarter = `(require spd/tags)
(@htdd DeliveryStatus)
;; DeliveryStatus is one of:
;; - "not shipped"
;; - Natural
;; - "delivered"
;; - "lost"
;;
;; design a function called delivered-before-tomorrow?
`;
const ddReference = `(require spd/tags)
(@htdd DeliveryStatus)
;; DeliveryStatus is one of:
;; - "not shipped"
;; - Natural
;; - "delivered"
;; - "lost"
(@dd-template-rules one-of atomic-distinct atomic-non-distinct atomic-distinct atomic-distinct)
(define (fn-for-delivery-status ds)
  (cond [(and (string? ds) (string=? ds "not shipped")) (...)]
        [(number? ds) (... ds)]
        [(and (string? ds) (string=? ds "delivered")) (...)]
        [else (...)]))

(@htdf delivered-before-tomorrow?)
(@signature DeliveryStatus -> Boolean)
;; produce true if the package is delivered or will be before eod tomorrow
(check-expect (delivered-before-tomorrow? "delivered") true)
(check-expect (delivered-before-tomorrow? 1) true)
(check-expect (delivered-before-tomorrow? 2) false)
(check-expect (delivered-before-tomorrow? "lost") false)

; (define (delivered-before-tomorrow? ds) false) ; stub

(@template-origin DeliveryStatus)
(@template
 (define (delivered-before-tomorrow? ds)
   (cond [(and (string? ds) (string=? ds "not shipped")) (...)]
         [(number? ds) (... ds)]
         [(and (string? ds) (string=? ds "delivered")) (...)]
         [else (...)])))

(define (delivered-before-tomorrow? ds)
  (cond [(and (string? ds) (string=? ds "not shipped")) false]
        [(number? ds) (<= ds 1)]
        [(and (string? ds) (string=? ds "delivered")) true]
        [else false]))
`;
const ddCheck = (studentCode, starterCode = ddStarter) =>
  runRacketDesignRecipe({
    studentCode,
    referenceCode: ddReference,
    starterCode,
    level: 'beginner',
    recipe: { checkTemplate: true, weight: 30, thoroughness: [] },
    timeoutMs: 5000,
  });
const failedIds = (items) =>
  items.filter((item) => !item.passed).map((item) => `${item.id}:${item.target}`);
const noStub = ddReference.replace('; (define (delivered-before-tomorrow? ds) false) ; stub\n', '');

test('the stub and purpose are required and checked on the source text', async () => {
  const good = await ddCheck(ddReference);
  assert.deepEqual(failedIds(good), []);
  assert(good.some((item) => item.id === 'stub') && good.some((item) => item.id === 'purpose'));
  assert.deepEqual(failedIds(await ddCheck(noStub)), ['stub:delivered-before-tomorrow?']);
  assert.deepEqual(failedIds(await ddCheck(ddReference.replace(/^;; produce true.*\n/m, ''))), [
    'purpose:delivered-before-tomorrow?',
  ]);
  // #; and block comments count; a stub with the wrong number of parameters does not.
  assert.deepEqual(
    failedIds(
      await ddCheck(
        noStub.replace(
          '(@template-origin',
          '#;(define (delivered-before-tomorrow? ds) false)\n(@template-origin',
        ),
      ),
    ),
    [],
  );
  assert.deepEqual(
    failedIds(
      await ddCheck(
        noStub.replace(
          '(@template-origin',
          '#|\n(define (delivered-before-tomorrow? ds) false) ;stub\n|#\n(@template-origin',
        ),
      ),
    ),
    [],
  );
  assert.deepEqual(
    failedIds(
      await ddCheck(
        ddReference.replace(
          '(delivered-before-tomorrow? ds) false) ; stub',
          '(delivered-before-tomorrow? ds x) false) ; stub',
        ),
      ),
    ),
    ['stub:delivered-before-tomorrow?'],
  );
});

test('a stub and purpose the starter already gives are not checked', async () => {
  const givenStarter = `${ddStarter}(@htdf delivered-before-tomorrow?)\n(@signature DeliveryStatus -> Boolean)\n;; produce true if the package is delivered or will be before eod tomorrow\n(define (delivered-before-tomorrow? ds) false) ; stub\n`;
  const items = await ddCheck(noStub.replace(/^;; produce true.*\n/m, ''), givenStarter);
  assert(!items.some((item) => item.id === 'stub' || item.id === 'purpose'), JSON.stringify(items));
});

test('a full answer without the stub no longer scores 100', async () => {
  const judge = await jiti.import('../../lib/server/notebook-problems/judge.ts');
  const now = Date.now();
  const tests = [
    ['"delivered"', 'true'],
    ['0', 'true'],
    ['1', 'true'],
    ['2', 'false'],
    ['"not shipped"', 'false'],
  ];
  const problem = {
    id: 'mt1-2020w1-p2-3',
    title: 'delivered-before-tomorrow?',
    type: 'code',
    status: 'draft',
    source: 'manual',
    order: 0,
    points: 100,
    tags: [],
    difficulty: 'medium',
    publicContent: {
      type: 'code',
      stem: 'Design delivered-before-tomorrow?.',
      language: 'racket',
      runnerAdapter: 'racket-check-expect',
      htdpLanguageLevel: 'beginner',
      starterCode: ddStarter,
      publicTests: tests.slice(0, 2).map(([arg, expected], i) => ({
        id: `public_case_${i}`,
        expression: `(delivered-before-tomorrow? ${arg})`,
        expected,
      })),
      sampleIO: [],
      secretConfigPresent: true,
    },
    grading: { type: 'code', solutionCode: ddReference, publishRequirementsMet: true },
    sourceMeta: {},
    createdAt: now,
    updatedAt: now,
  };
  const secretJudge = {
    language: 'racket',
    runnerAdapter: 'racket-check-expect',
    secretTestCode: tests
      .slice(2)
      .map(([arg, expected]) => `(check-expect (delivered-before-tomorrow? ${arg}) ${expected})`)
      .join('\n'),
    secretTests: [],
    timeoutMs: 5000,
    designRecipe: { checkTemplate: true, weight: 30, thoroughness: [] },
  };
  const submit = (code) =>
    judge.judgeNotebookCodeProblem({ problem, secretJudge, userAnswer: { code }, kind: 'submit' });
  const reference = await submit(ddReference);
  assert.equal(reference.score, 100, reference.result.feedback);
  const withoutStub = await submit(noStub);
  assert.equal(withoutStub.status, 'partial');
  assert(withoutStub.score < 100);
  assert.match(withoutStub.result.feedback, /Stub/);
});
