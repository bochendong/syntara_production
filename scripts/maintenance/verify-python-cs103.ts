#!/usr/bin/env node
// Checks the in-memory `cs103` module (UBC CPSC 103) and a CPSC 103-style problem end to end.
//   pnpm test:python-cs103

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import path from 'node:path';

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

  const [{ CS103_PYTHON_SOURCE }, judge, cs103Tests, drafts, readiness] = await Promise.all([
    import('../../lib/problem-bank/cs103-python'),
    import('../../lib/server/notebook-problems/judge'),
    import('../../lib/problem-bank/cs103-tests'),
    import('../../lib/server/notebook-problems/import.core.drafts'),
    import('../../lib/problem-bank/code-readiness'),
  ]);

  // 1. typecheck forms, run in the local CPython (same module source the judge installs).
  const typeCases = String.raw`
import sys, types
m = types.ModuleType("cs103"); exec(SOURCE, m.__dict__); sys.modules["cs103"] = m
from cs103 import *
from cs103 import _same
from enum import Enum
from typing import NamedTuple, Optional, List

Velocity = NamedTuple('Velocity', [('speed', float), ('dir', int)])
Rock = Enum('Rock', ['IG', 'SE', 'ME'])

def ok(f, *args):
    try:
        f(*args); return True
    except TypeError as e:
        return False

@typecheck
def dbl(n: float) -> float:
    return n * 2
@typecheck
def bad_return(n: int) -> int:
    return "x"
@typecheck
def speed(v: Velocity) -> float:
    return v.speed
@typecheck
def first_or_none(lon: list[int]) -> Optional[int]:
    return lon[0] if lon else None
@typecheck
def count_rocks(lor: List[Rock]) -> int:
    return len(lor)
@typecheck
def nested(lol: list[list[str]]) -> int:
    return len(lol)
@typecheck
def forward(v: 'Velocity') -> bool:
    return True

checks = {
    "int accepted as float": ok(dbl, 3),
    "float accepted": ok(dbl, 2.5),
    "bool rejected as float": not ok(dbl, True),
    "str rejected": not ok(dbl, "3"),
    "wrong return rejected": not ok(bad_return, 1),
    "NamedTuple accepted": ok(speed, Velocity(9, 22)),
    "plain tuple rejected": not ok(speed, (9, 22)),
    "NamedTuple field type checked": not ok(speed, Velocity("fast", 22)),
    "list[int] accepted": ok(first_or_none, [1, 2]),
    "empty list accepted": ok(first_or_none, []),
    "list[int] element checked": not ok(first_or_none, [1, "2"]),
    "Enum list accepted": ok(count_rocks, [Rock.IG, Rock.SE]),
    "Enum element checked": not ok(count_rocks, ["IG"]),
    "nested list checked": ok(nested, [["a"], []]) and not ok(nested, [["a", 1]]),
    "forward reference": ok(forward, Velocity(1, 2)),
    "float equality approximate": _same(0.1 + 0.2, 0.3),
    "bool not equal to int": not _same(True, 1),
    "NamedTuple equality": _same(Velocity(1.0, 2), Velocity(1, 2)),
}
start_testing()
expect(dbl(2), 4)
expect(dbl(2), 5)
summary()
print("RESULTS", {k: v for k, v in checks.items() if not v})
`;
  const output = execFileSync(
    process.env.PYTHON_EXECUTABLE?.trim() || 'python3',
    ['-c', `SOURCE = ${JSON.stringify(CS103_PYTHON_SOURCE)}\n${typeCases}`],
    { encoding: 'utf8' },
  );
  console.log(output.trim());
  assert.match(output, /RESULTS \{\}/, 'every typecheck case behaves as expected');
  assert.match(output, /1 of 2 tests passed/);
  assert.match(output, /Test 2 \(line \d+\) failed: got 4 but expected 5/);

  // 2. A CPSC 103 HtDF problem through the real judge (bundled Pyodide).
  const starter = `from cs103 import *

@typecheck
def double(n: float) -> float:
    """
    returns n doubled
    """
    return 0  # stub

start_testing()
expect(double(0), 2 * 0)
summary()
`;
  const solution = `from cs103 import *

@typecheck
def double(n: float) -> float:
    """
    returns n doubled
    """
    # return 0  # stub
    # return ...(n)  # template based on atomic non-distinct
    return 2 * n

start_testing()
expect(double(0), 2 * 0)
expect(double(-2.1), 2 * -2.1)
expect(double(10.11), 2 * 10.11)
summary()
`;
  const hidden = (calls: string[]) =>
    [
      'import unittest',
      'from cs103 import _same',
      'from submission import *',
      '',
      'class Hidden(unittest.TestCase):',
      ...calls.map(
        (call, i) =>
          `    def test_${i + 1}(self):\n        self.assertTrue(_same(${call.split(' == ')[0]}, ${call.split(' == ')[1]}))`,
      ),
    ].join('\n');
  const now = Date.now();
  const problem = {
    id: 'cs103-double',
    title: 'double',
    type: 'code' as const,
    status: 'draft' as const,
    source: 'manual' as const,
    order: 0,
    points: 100,
    tags: [],
    difficulty: 'easy' as const,
    publicContent: {
      type: 'code' as const,
      stem: 'Design a function that doubles a number.',
      language: 'python',
      runnerAdapter: 'python-unittest',
      starterCode: starter,
      publicTestCode: hidden(['double(0) == 0', 'double(-2.1) == -4.2']),
      publicTests: [],
      sampleIO: [],
      constraints: [],
      secretConfigPresent: true,
    },
    grading: { type: 'code' as const, solutionCode: solution, publishRequirementsMet: true },
    sourceMeta: {},
    createdAt: now,
    updatedAt: now,
  };
  const secretJudge = {
    language: 'python',
    runnerAdapter: 'python-unittest',
    secretTestCode: hidden(['double(10.11) == 20.22', 'double(5) == 10', 'double(-1) == -2']),
    secretTests: [],
    timeoutMs: 20000,
  };
  const submit = (code: string) =>
    judge.judgeNotebookCodeProblem({ problem, secretJudge, userAnswer: { code }, kind: 'submit' });

  const reference = await submit(solution);
  console.log('reference', reference.status, reference.result.feedback);
  assert.equal(reference.status, 'passed');
  const stub = await submit(starter);
  console.log('stub', stub.status, stub.result.feedback);
  assert.notEqual(stub.status, 'passed');
  const wrongType = await submit(solution.replace('return 2 * n', 'return str(2 * n)'));
  console.log('wrong type', wrongType.status, wrongType.result.feedback);
  assert.equal(wrongType.status, 'failed');

  const ran = await judge.judgeNotebookCodeProblem({
    problem,
    secretJudge,
    userAnswer: { code: solution.replace('2 * 10.11)', '20)') },
    kind: 'run',
    runTarget: 'code',
  });
  console.log('script run', JSON.stringify(ran.result.stdout));
  assert.match(ran.result.stdout ?? '', /^2 of 3 tests passed/);
  assert.match(ran.result.stdout ?? '', /failed: got 20\.22 but expected 20/);

  // 3. expect() calls are read from the source: nested brackets, strings, comments, continuation.
  const parsed = cs103Tests.extractCs103Expects(`from cs103 import *
start_testing()
expect(f(1, "a,b"), 2)  # commas in strings
expect(g([1, 2], {'x': (3, 4)}),
       [1,  # trailing comment
        2])
expect(h("""x)
y"""), 'it\\'s')
    expect(indented(1), 1)
summary()
`);
  assert.deepEqual(
    parsed.map(({ actual, expected }) => [actual, expected.replace(/\s+/g, ' ')]),
    [
      ['f(1, "a,b")', '2'],
      ["g([1, 2], {'x': (3, 4)})", '[1, 2]'],
      ['h("""x)\ny""")', "'it\\'s'"],
    ],
  );

  // 4. A cs103 draft with no tests gets suites from its reference's expects and passes checks.
  const recipeStarter = `from cs103 import *
from typing import NamedTuple

Velocity = NamedTuple('Velocity', [('speed', float), ('dir', int)])
# interp. a velocity with a speed in m/s and a direction in degrees
V1 = Velocity(9, 22)

@typecheck
def turn(v: Velocity, d: int) -> Velocity:
    """
    returns v turned by d degrees (mod 360)
    """
    return V1  # stub

start_testing()
expect(turn(V1, 0), V1)
summary()
`;
  const recipeSolution = recipeStarter
    .replace(
      '    return V1  # stub',
      '    # return V1  # stub\n    return Velocity(v.speed, (v.dir + d) % 360)',
    )
    .replace(
      'expect(turn(V1, 0), V1)',
      [
        'expect(turn(V1, 0), V1)',
        'expect(turn(V1, 10).dir, 32)',
        'expect(turn(Velocity(1, 350), 20), Velocity(1, 10))',
        'expect(turn(Velocity(2.5, 0), 360), Velocity(2.5, 0))',
        'expect(turn(V1, 338).dir, 0)',
      ].join('\n'),
    );
  const draft = drafts.normalizeCandidateDraft(
    {
      title: 'turn',
      type: 'code',
      publicContent: {
        stem: 'Design a function that turns a velocity.',
        language: 'python',
        starterCode: recipeStarter,
      },
      grading: { solutionCode: recipeSolution },
    },
    'manual',
  );
  assert.equal(draft.type, 'code');
  assert(draft.publicContent.type === 'code' && draft.secretJudge);
  assert.match(draft.publicContent.publicTestCode ?? '', /def test_turn_1\(self\)/);
  assert.equal((draft.secretJudge.secretTestCode?.match(/def test_/g) ?? []).length, 3);
  assert.deepEqual(draft.publicContent.sampleIO, [
    { input: 'turn(V1, 10).dir', output: '32' },
    { input: 'turn(V1, 338).dir', output: '0' },
  ]);
  assert.deepEqual(readiness.codeDraftReadinessErrors(draft), []);
  const verification = await judge.verifyNotebookCodeDraftReferenceAnswer(draft);
  console.log('derived verification', verification);
  assert.equal(verification.passed, true);
  const now2 = Date.now();
  const derivedProblem = {
    ...problem,
    id: 'cs103-turn',
    publicContent: { ...draft.publicContent, secretConfigPresent: true },
    grading: { type: 'code' as const, solutionCode: recipeSolution, publishRequirementsMet: true },
    createdAt: now2,
    updatedAt: now2,
  };
  const submitTurn = (code: string) =>
    judge.judgeNotebookCodeProblem({
      problem: derivedProblem,
      secretJudge: draft.secretJudge,
      userAnswer: { code },
      kind: 'submit',
    });
  const turnReference = await submitTurn(recipeSolution);
  assert.equal(turnReference.status, 'passed');
  const noWrap = await submitTurn(recipeSolution.replace('(v.dir + d) % 360', 'v.dir + d'));
  console.log('no wrap', noWrap.status, noWrap.result.feedback);
  assert.equal(noWrap.status, 'partial');
  assert.match(JSON.stringify(noWrap.result), /got Velocity\(speed=1, dir=370\) but expected/);

  // 5. Design recipe: HtDD + HtDF compared with the reference, partial credit per check.
  const ddReference = `from cs103 import *
from typing import NamedTuple

Velocity = NamedTuple('Velocity', [('speed', float), ('dir', int)])
# interp. a velocity with a speed in m/s and a direction in degrees, in range [0, 359]
V1 = Velocity(9, 22)
V2 = Velocity(3.4, 180)

@typecheck
def fn_for_velocity(v: Velocity) -> ...:
    # template based on compound (2 fields)
    return ...(v.speed, v.dir)

VelocityList = list[Velocity]
# interp. velocities in the order they were measured
VL0 = []
VL1 = [V1, V2]

@typecheck
def fn_for_velocity_list(lov: VelocityList) -> ...:
    # template based on arbitrary-sized and reference rule
    # description of the accumulator
    acc = ...  # type: ...
    for v in lov:
        acc = ...(fn_for_velocity(v), acc)
    return ...(acc)

@typecheck
def is_fast(v: Velocity) -> bool:
    \"\"\"
    returns True if v's speed is above 5 m/s
    \"\"\"
    # return True  # stub
    # return ...(v.speed, v.dir)  # template from Velocity
    return v.speed > 5

start_testing()
expect(is_fast(Velocity(9, 22)), True)
expect(is_fast(Velocity(3.4, 180)), False)
expect(is_fast(Velocity(5, 0)), False)
summary()
`;
  const ddStarter = `from cs103 import *
from typing import NamedTuple

# Design a data definition for a velocity and a function is_fast.
`;
  const recipeDraft = drafts.normalizeCandidateDraft(
    {
      title: 'is_fast',
      type: 'code',
      publicContent: {
        stem: 'Design Velocity and is_fast.',
        language: 'python',
        starterCode: ddStarter,
      },
      grading: { solutionCode: ddReference },
      secretJudge: {
        designRecipe: {
          weight: 40,
          thoroughness: [
            { target: 'is_fast', description: 'a speed of exactly 5', predicate: 'v.speed == 5' },
            // Generator expressions must see the parameters too.
            {
              target: 'is_fast',
              description: 'a slow velocity',
              predicate: 'any(v.speed < limit for limit in [5])',
            },
          ],
        },
      },
    },
    'manual',
  );
  assert(recipeDraft.publicContent.type === 'code' && recipeDraft.secretJudge);
  const recipeVerification = await judge.verifyNotebookCodeDraftReferenceAnswer(recipeDraft);
  console.log('recipe verification', recipeVerification);
  assert.equal(recipeVerification.passed, true);
  const recipeProblem = {
    ...problem,
    id: 'cs103-is-fast',
    publicContent: { ...recipeDraft.publicContent, secretConfigPresent: true },
    grading: { type: 'code' as const, solutionCode: ddReference, publishRequirementsMet: true },
  };
  const submitRecipe = (code: string) =>
    judge.judgeNotebookCodeProblem({
      problem: recipeProblem,
      secretJudge: recipeDraft.secretJudge,
      userAnswer: { code },
      kind: 'submit',
    });
  const failedChecks = (result: Awaited<ReturnType<typeof submitRecipe>>) =>
    (result.result.designRecipe ?? [])
      .filter((check) => !check.passed)
      .map((check) => `${check.id}:${check.target}`)
      .sort();

  const fullRecipe = await submitRecipe(ddReference);
  assert.equal(fullRecipe.status, 'passed');
  assert.equal(fullRecipe.score, 100);
  assert.ok((fullRecipe.result.designRecipe ?? []).length >= 10);

  // Renamed examples, parameter and template function are fine; the shape is what counts.
  const renamed = ddReference
    .replaceAll('V1', 'FAST')
    .replace('def is_fast(v: Velocity)', 'def is_fast(vel: Velocity)')
    .replace('return v.speed > 5', 'return vel.speed > 5')
    .replace(
      'def fn_for_velocity(v: Velocity) -> ...:\n    # template based on compound (2 fields)\n    return ...(v.speed, v.dir)',
      'def fn_for_velocity(x: Velocity) -> ...:\n    # template based on compound\n    return ...(x.dir, x.speed)',
    )
    .replace(
      '    for v in lov:\n        acc = ...(fn_for_velocity(v), acc)',
      '    for one in lov:\n        acc = ...(fn_for_velocity(one), acc)',
    )
    .replace(
      '# template based on arbitrary-sized and reference rule',
      '# template based on arbitrary-sized (list), reference rule',
    )
    .replace('# template from Velocity', '# template based on Velocity; vel is the only input');
  const renamedResult = await submitRecipe(renamed);
  console.log('renamed', failedChecks(renamedResult));
  assert.deepEqual(failedChecks(renamedResult), []);

  const sloppy = ddReference
    .replace('@typecheck\ndef is_fast', 'def is_fast')
    .replace('    # return True  # stub\n', '')
    .replace('  # template from Velocity', '')
    .replace(
      '# interp. a velocity with a speed in m/s and a direction in degrees, in range [0, 359]\n',
      '',
    )
    .replace(
      'expect(is_fast(Velocity(3.4, 180)), False)',
      'expect(is_fast(Velocity(3.4, 180)), True)',
    )
    .replace('expect(is_fast(Velocity(5, 0)), False)\n', '');
  const sloppyResult = await submitRecipe(sloppy);
  console.log('sloppy', sloppyResult.status, sloppyResult.score, sloppyResult.result.feedback);
  assert.deepEqual(failedChecks(sloppyResult), [
    'data_definition:Velocity',
    'stub:is_fast',
    'template_origin:is_fast',
    'test_thoroughness:is_fast',
    'test_validity:is_fast',
    'typecheck:is_fast',
  ]);
  assert.equal(sloppyResult.status, 'partial');
  assert.ok(sloppyResult.score > 60 && sloppyResult.score < 100);
  assert.match(
    sloppyResult.result.feedback ?? '',
    /1 of 2 test\(s\) disagree with a correct is_fast/,
  );
  assert.match(sloppyResult.result.feedback ?? '', /no test covers: a speed of exactly 5/);

  const wrongData = ddReference
    .replace("('dir', int)", "('dir', str)")
    .replace('return ...(v.speed, v.dir)\n', 'return ...(v.speed)\n')
    .replace('def is_fast(v: Velocity) -> bool', 'def is_fast(v: Velocity) -> int')
    .replace('acc = ...(fn_for_velocity(v), acc)', 'acc = ...(v, acc)');
  const wrongDataResult = await submitRecipe(wrongData);
  console.log('wrong data', failedChecks(wrongDataResult));
  assert.deepEqual(failedChecks(wrongDataResult), [
    'data_definition:Velocity',
    'signature:is_fast',
    'template:fn_for_velocity',
    'template:fn_for_velocity_list',
  ]);

  const unparsable = await submitRecipe('def is_fast(v:\n');
  assert.deepEqual(failedChecks(unparsable), ['read:']);

  console.log('cs103 checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
