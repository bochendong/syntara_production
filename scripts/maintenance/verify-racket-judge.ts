#!/usr/bin/env node
// Runs a Racket (HtDP) code problem through the real judge: the reference answer
// must pass, the unedited starter and a wrong answer must fail.
//
//   RACKET_EXECUTABLE=/path/to/racket pnpm test:racket-judge <starter.rkt> <solution.rkt> [draft-out.json]
//
// Without arguments it uses a small built-in problem.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import Module from 'node:module';
import path from 'node:path';

const BUILTIN_STARTER = `(require spd/tags)

(@htdf superfact)
(@signature Natural -> Natural)
;; produce the super factorial of n

(define (superfact n) 0) ;stub
`;

const BUILTIN_SOLUTION = `(require spd/tags)

(@htdf superfact)
(@signature Natural -> Natural)
;; produce the super factorial of n
(check-expect (superfact 0) 1)
(check-expect (superfact 3) 12)

(@template-origin fn-composition use-abstract-fn)
(define (superfact n1)
  (foldr * 1
         (build-list n1
                     (lambda (n2)
                       (foldr * 1
                              (build-list (add1 n2) add1))))))
`;

/** Top-level (check-…) forms of a solution file, as source text. */
function checkForms(source: string): string[] {
  const forms: string[] = [];
  const start = /\(check-(?:expect|within|error|satisfied)\b/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(source))) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    forms.push(source.slice(match.index, end + 1));
    start.lastIndex = end + 1;
  }
  return forms;
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  type ResolveFilename = (
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
    options?: { paths?: string[] },
  ) => string;
  const commonJsModule = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = commonJsModule._resolveFilename;
  commonJsModule._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const resolvedRequest = request.startsWith('@/') ? path.join(root, request.slice(2)) : request;
    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  const [
    { notebookProblemImportDraftSchema, codeDraftReadinessErrors, matchTableCellLocally },
    judge,
    racket,
    editor,
  ] = await Promise.all([
    import('../../lib/problem-bank'),
    import('../../lib/server/notebook-problems/judge'),
    import('../../lib/server/racket-runner'),
    import('../../lib/problem-bank/racket-editor'),
  ]);

  // Editor: DrRacket-style newline indentation and token classes.
  const indentAfter = (text: string) =>
    editor.racketNewlineEdit(text, text.length).value.split('\n').at(-1)!.length;
  assert.equal(indentAfter('(define (f x)'), 2);
  assert.equal(indentAfter('(cond [(zero? n) 1]'), 2);
  assert.equal(indentAfter('(+ 1'), 3);
  assert.equal(indentAfter('(foo'), 1);
  assert.equal(indentAfter('(local [(define (g y)'), 10);
  assert.equal(indentAfter('(define x 1)'), 0);
  assert.equal(indentAfter('(f "(" ; ('), 3);
  const kinds = editor
    .racketLineTokens('(define (f x) "s" 12 ; c')
    .tokens.filter((token) => token.kind !== 'text' && token.kind !== 'operator')
    .map((token) => token.kind);
  assert.deepEqual(kinds, ['keyword', 'string', 'number', 'comment']);

  // Table matcher for stepping / lifting answers.
  const sexpCell = {
    rowId: 'r',
    colId: 'c',
    acceptedAnswers: ['(if (> 5 3)\n    (xyzzy 5 (+ 3 5 A))\n    #true)'],
    matcher: 'sexp' as const,
  };
  assert.equal(
    matchTableCellLocally(sexpCell, '( if (> 5 3) [xyzzy 5 (+ 3 5 A)] true ) ; ok'),
    true,
  );
  assert.equal(matchTableCellLocally(sexpCell, '(if (> 5 3) (xyzzy 5 (+ 3 5 B)) true)'), false);
  assert.equal(matchTableCellLocally({ ...sexpCell, acceptedAnswers: ['"a  b"'] }, '"a b"'), false);

  const [starterPath, solutionPath, draftOut] = process.argv.slice(2);
  const starterCode = starterPath ? await readFile(starterPath, 'utf8') : BUILTIN_STARTER;
  const solutionCode = solutionPath ? await readFile(solutionPath, 'utf8') : BUILTIN_SOLUTION;
  const solutionChecks = checkForms(solutionCode);
  assert.ok(solutionChecks.length >= 2, 'solution must contain check-expects');

  // Header normalization: every DrRacket header is replaced by the configured level.
  const normalized = racket.racketSubmissionSource(
    `;; The first three lines of this file were inserted by DrRacket. They record metadata\n;; about the language level of this file in a form that our tools can easily process.\n#reader(lib "htdp-beginner-reader.ss" "lang")((modname x))\n#lang racket\n(define x 1)`,
    'advanced',
  );
  assert.equal(normalized.split('\n')[0], racket.htdpReaderHeader('advanced'));
  assert.ok(!/#lang|htdp-beginner|inserted by DrRacket/.test(normalized));

  const draft = notebookProblemImportDraftSchema.parse({
    draftId: 'cpsc110-superfact',
    title: 'Super factorial (superfact)',
    type: 'code',
    status: 'draft',
    source: 'manual',
    points: 100,
    tags: ['CPSC 110', 'HtDF', 'Natural'],
    difficulty: 'medium',
    publicContent: {
      type: 'code',
      stem: 'Design a function that consumes a natural number n and produces the super factorial of n: the product of k! for every k in [1, n]. (superfact 0) is 1.',
      language: 'racket',
      runnerAdapter: 'racket-check-expect',
      htdpLanguageLevel: 'intermediate-lambda',
      functionSignature: '(@htdf superfact)',
      starterCode,
      publicTests: [
        { id: 'zero_is_one', expression: '(superfact 0)', expected: '1' },
        { id: 'four_is_288', expression: '(superfact 4)', expected: '288' },
      ],
      sampleIO: [
        { input: '(superfact 2)', output: '2' },
        { input: '(superfact 3)', output: '12' },
      ],
      secretConfigPresent: true,
    },
    grading: { type: 'code', solutionCode, publishRequirementsMet: false },
    secretJudge: {
      language: 'racket',
      runnerAdapter: 'racket-check-expect',
      // The solution's own check-expects plus extra cases beyond them.
      secretTestCode: [
        ...solutionChecks,
        '(check-expect (superfact 5) 34560)',
        '(check-expect (superfact 6) 24883200)',
        '(check-expect (superfact 10) 6658606584104736522240000000)',
      ].join('\n'),
      timeoutMs: 5000,
    },
    sourceMeta: {},
  });

  assert.deepEqual(codeDraftReadinessErrors(draft), []);
  const verification = await judge.verifyNotebookCodeDraftReferenceAnswer(draft);
  console.log('reference verification', verification);
  assert.equal(verification.passed, true, verification.errors.join('\n'));
  assert.equal(verification.secretTestCount, solutionChecks.length + 3);

  const now = Date.now();
  const problem = {
    id: 'pilot-superfact',
    title: draft.title,
    type: draft.type,
    status: draft.status,
    source: draft.source,
    order: 0,
    points: draft.points,
    tags: draft.tags,
    difficulty: draft.difficulty,
    publicContent: draft.publicContent,
    grading: draft.grading,
    sourceMeta: draft.sourceMeta,
    createdAt: now,
    updatedAt: now,
  };
  const submit = (code: string) =>
    judge.judgeNotebookCodeProblem({
      problem,
      secretJudge: draft.secretJudge,
      userAnswer: { code },
      kind: 'submit',
    });

  const reference = await submit(solutionCode);
  console.log('reference submit', reference.status, reference.result.feedback);
  assert.equal(reference.status, 'passed');
  assert.equal(reference.score, 100);

  const stub = await submit(starterCode);
  console.log('starter submit', stub.status, stub.result.feedback);
  assert.notEqual(stub.status, 'passed');
  assert.equal(stub.score, 0);

  // Plain factorial instead of super factorial: passes 0, 1, 2 but nothing larger.
  const wrong = await submit(
    `${starterCode.replace(/\(define \(superfact n\) 0\) ;stub/, '')}
(define (superfact n)
  (cond [(zero? n) 1]
        [else (* n (superfact (sub1 n)))]))`,
  );
  console.log('wrong submit', wrong.status, wrong.result.feedback);
  assert.equal(wrong.status, 'partial');
  assert.equal(wrong.score, 0);

  // Students cannot switch languages: #lang racket is dropped and ISL+ rejects set!.
  const escaped = await submit(
    '#lang racket\n(define counter 0)\n(define (superfact n) (set! counter 1) 1)',
  );
  assert.notEqual(escaped.status, 'passed');

  const looping = await judge.judgeNotebookCodeProblem({
    problem,
    secretJudge: { ...draft.secretJudge!, timeoutMs: 1000 },
    userAnswer: { code: '(define (superfact n) (superfact n))' },
    kind: 'run',
  });
  console.log('infinite loop run', looping.status, looping.result.caseResults?.[0]?.error);
  assert.match(looping.result.caseResults?.[0]?.error ?? '', /out of time/);

  // String-literal expected values must not be re-read as code ("ce" is not the identifier ce).
  const strings = await judge.judgeNotebookCodeProblem({
    problem: {
      ...problem,
      publicContent: {
        ...problem.publicContent,
        publicTests: [
          { id: 'two_chars', expression: '(abbrev "abcdef" 2 4)', expected: '"ce"' },
          { id: 'same_char', expression: '(abbrev "012345" 0 0)', expected: '"00"' },
        ],
      } as typeof problem.publicContent,
    },
    secretJudge: {
      ...draft.secretJudge!,
      secretTestCode:
        '(check-expect (abbrev "abcdef" 4 2) "ec")\n(check-expect "xx" (abbrev "x" 0 0))\n(check-satisfied "ab" string?)',
    },
    userAnswer: {
      code: '(define (abbrev str a b) (string-append (string-ith str a) (string-ith str b)))',
    },
    kind: 'submit',
  });
  console.log('string literals', strings.status, strings.result.feedback);
  assert.equal(strings.status, 'passed');

  // Run (script target): top-level values print and the student's own tests are summarised.
  const ran = await judge.judgeNotebookCodeProblem({
    problem,
    secretJudge: draft.secretJudge,
    userAnswer: {
      code: `${solutionCode}\n(check-expect (superfact 3) 13)\n(superfact 3)`,
    },
    kind: 'run',
    runTarget: 'code',
  });
  console.log('script run', JSON.stringify(ran.result.stdout));
  assert.match(ran.result.stdout ?? '', /^12\n/m);
  assert.match(ran.result.stdout ?? '', /1 of the \d+ tests failed/);

  if (draftOut) await writeFile(draftOut, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  console.log('racket judge checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
