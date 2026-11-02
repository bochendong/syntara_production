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

  const [{ CS103_PYTHON_SOURCE }, judge] = await Promise.all([
    import('../../lib/problem-bank/cs103-python'),
    import('../../lib/server/notebook-problems/judge'),
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
  console.log('cs103 checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
