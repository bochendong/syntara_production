import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPythonJson } from '@/lib/server/python-runner';
import { CS103_PYTHON_SOURCE, usesCs103 } from '@/lib/problem-bank/cs103-python';
import { PYTHON_RECIPE_DRIVER } from '@/lib/server/python-recipe-driver';
import { designedFunctionsEdited } from '@/lib/problem-bank/function-bodies';
import {
  DEFAULT_HTDP_LANGUAGE_LEVEL,
  RACKET_DRIVER,
  racketSubmissionSource,
  runRacketDesignRecipe,
  runRacketJson,
} from '@/lib/server/racket-runner';
import { codeTestSummaryFeedback } from '@/lib/problem-bank/attempt-feedback';
import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptResult,
  NotebookProblemImportDraft,
  NotebookProblemRecord,
  NotebookProblemSecretJudge,
} from '@/lib/problem-bank';
import {
  codeDraftReadinessErrors,
  assembleCodeFromSlots,
  codeReferenceSolution,
  codeSlotTemplateFor,
  extractSlotValues,
  isNotebookCodeProblemRecord,
} from '@/lib/problem-bank';
import type {
  HtdpLanguageLevel,
  NotebookCodeFile,
  NotebookDesignRecipeCheck,
  RacketDesignRecipe,
} from '@/lib/problem-bank';
import { validateCourseAnswerContract } from '@/features/memory/domain/course-answer-contract';
import type { NotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';

const DEFAULT_TIMEOUT_MS = 5000;

const PYTHON_RUNNER = `
import json
import sys
import traceback
import importlib.util
import io
import os
import ast
import contextlib
import runpy


def normalize(value):
    if isinstance(value, tuple):
        return [normalize(v) for v in value]
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {str(k): normalize(v) for k, v in value.items()}
    return value


def parse_expected(raw):
    try:
        return json.loads(raw)
    except Exception:
        try:
            return eval(raw, {"__builtins__": {}}, {})
        except Exception:
            return raw


def emit(payload):
    sys.__stdout__.write(json.dumps(payload, ensure_ascii=False))
    sys.__stdout__.write(chr(10))
    sys.__stdout__.flush()


def write_files(files):
    written = {}
    for item in files or []:
        rel = os.path.normpath(item["path"])
        if rel.startswith("..") or os.path.isabs(rel):
            continue
        folder = os.path.dirname(rel)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(rel, "w", encoding="utf-8") as handle:
            handle.write(item["content"])
        written[rel] = item["content"]
    return written


def collect_files(work_dir, written):
    changed = []
    for root, dirs, names in os.walk(work_dir):
        dirs[:] = [name for name in dirs if name != "__pycache__"]
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, work_dir)
            if rel in ("submission.py", "runner.py"):
                continue
            try:
                with open(full, encoding="utf-8") as handle:
                    content = handle.read()
            except Exception:
                continue
            if written.get(rel) == content:
                continue
            changed.append({"path": rel, "content": content[:200000]})
    return changed[:8]


def strict_equal(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, (list, tuple)):
        return len(left) == len(right) and all(strict_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(strict_equal(left[k], right[k]) for k in left)
    return left == right


def run_table_cells(payload):
    results = []
    for item in payload["items"]:
        correct = False
        try:
            if item["matcher"] == "python_value":
                value = ast.literal_eval(item["answer"].strip())
                for accepted in item["accepted"]:
                    try:
                        if strict_equal(value, ast.literal_eval(accepted.strip())):
                            correct = True
                            break
                    except Exception:
                        pass
            elif item["matcher"] == "run_check":
                namespace = {"__name__": "__main__"}
                with contextlib.redirect_stdout(io.StringIO()):
                    if payload.get("setup"):
                        exec(payload["setup"], namespace)
                    correct = bool(eval(item["check"].replace("{answer}", item["answer"]), namespace))
        except BaseException:
            correct = False
        results.append({"key": item["key"], "correct": correct})
    emit({"cells": results})


def run_table_rows(payload):
    rows = []
    for item in payload["rows"]:
        write_files(payload.get("files"))
        namespace = {"__name__": "__main__"}
        capture = io.StringIO()
        error_type = None
        value = None
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                if payload.get("setup"):
                    exec(payload["setup"], namespace)
            with contextlib.redirect_stdout(capture):
                try:
                    compiled = compile(item["code"], "<row>", "eval")
                except SyntaxError:
                    compiled = None
                if compiled is not None:
                    value = repr(eval(compiled, namespace))
                else:
                    exec(compile(item["code"], "<row>", "exec"), namespace)
        except BaseException as exc:
            error_type = type(exc).__name__
            value = None
        rows.append({"id": item["id"], "stdout": capture.getvalue()[:8000], "value": value, "errorType": error_type})
    emit({"rows": rows})


def install_cs103(source):
    # UBC CPSC 103's library: @typecheck, expect / summary, parse_int / parse_float
    import types
    module = types.ModuleType("cs103")
    exec(source, module.__dict__)
    sys.modules["cs103"] = module


def main():
    payload = json.loads(sys.argv[1])
    if payload.get("cs103Source"):
        install_cs103(payload["cs103Source"])
    work_dir = os.path.dirname(payload["codePath"])
    os.chdir(work_dir)
    written = write_files(payload.get("files"))
    if payload.get("stdin") is not None:
        sys.stdin = io.StringIO(payload["stdin"])

    if payload.get("mode") == "table_cells":
        run_table_cells(payload)
        return

    if payload.get("mode") == "table_rows":
        run_table_rows(payload)
        return

    if payload.get("mode") == "script":
        script_stdout_capture = io.StringIO()
        try:
            with contextlib.redirect_stdout(script_stdout_capture):
                runpy.run_path(payload["codePath"], run_name="__main__")
        except BaseException as exc:
            emit({
                "cases": [],
                "moduleStdout": script_stdout_capture.getvalue(),
                "moduleError": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
                "files": collect_files(work_dir, written),
            })
            return

        emit({
            "cases": [],
            "moduleStdout": script_stdout_capture.getvalue(),
            "files": collect_files(work_dir, written),
        })
        return

    if payload.get("testCode") is not None:
        import unittest
        import types
        capture = io.StringIO()
        results = []
        class Result(unittest.TestResult):
            def startTest(self, test):
                super().startTest(test)
                if payload.get("stdin") is not None:
                    sys.stdin = io.StringIO(payload["stdin"])
                self.current = {"id": test.id(), "passed": True}
                description = test.shortDescription()
                if description:
                    self.current["description"] = description
            def addSuccess(self, test):
                super().addSuccess(test)
            def addFailure(self, test, err):
                super().addFailure(test, err)
                self.current.update(passed=False, error=self._exc_info_to_string(err, test))
            def addError(self, test, err):
                super().addError(test, err)
                if hasattr(self, "current"):
                    self.current.update(passed=False, error=self._exc_info_to_string(err, test))
                else:
                    results.append({"id": str(test), "passed": False, "error": self._exc_info_to_string(err, test)})
            def addSkip(self, test, reason):
                super().addSkip(test, reason)
                if hasattr(self, "current"):
                    self.current.update(passed=False, error="Skipped: " + reason)
                else:
                    results.append({"id": str(test), "passed": False, "error": "Skipped: " + reason})
            def addExpectedFailure(self, test, err):
                super().addExpectedFailure(test, err)
                self.current.update(passed=False, error="Expected failure is not a passing test")
            def addUnexpectedSuccess(self, test):
                super().addUnexpectedSuccess(test)
                self.current.update(passed=False, error="Unexpected success")
            def addSubTest(self, test, subtest, err):
                super().addSubTest(test, subtest, err)
                if err is not None:
                    self.current.update(passed=False, error=self._exc_info_to_string(err, test))
            def stopTest(self, test):
                self.current["stdout"] = capture.getvalue()
                capture.seek(0)
                capture.truncate(0)
                results.append(self.current)
                del self.current
                super().stopTest(test)
        try:
            with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
                spec = importlib.util.spec_from_file_location("submission", payload["codePath"])
                module = importlib.util.module_from_spec(spec)
                sys.modules["submission"] = module
                spec.loader.exec_module(module)
                tests = types.ModuleType("tests")
                exec(compile(payload["testCode"], "tests.py", "exec"), tests.__dict__)
                suite = unittest.defaultTestLoader.loadTestsFromModule(tests)
                if suite.countTestCases() == 0:
                    raise ValueError("No unittest tests discovered")
                result = Result()
                suite.run(result)
                if not results:
                    raise ValueError("No test results produced")
            emit({"cases": results})
        except BaseException as exc:
            emit({"cases": [{"id": "test_suite_error", "passed": False,
                "error": "".join(traceback.format_exception_only(type(exc), exc)).strip()}]})
        return

    spec = importlib.util.spec_from_file_location("submission", payload["codePath"])
    module = importlib.util.module_from_spec(spec)
    module_stdout_capture = io.StringIO()
    try:
        with contextlib.redirect_stdout(module_stdout_capture):
            spec.loader.exec_module(module)
    except BaseException as exc:
        error = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        emit({
            "cases": [
                {
                    "id": case["id"],
                    "description": case.get("description"),
                    "passed": False,
                    "error": error,
                    "stdout": module_stdout_capture.getvalue(),
                }
                for case in payload["testCases"]
            ],
            "moduleStdout": module_stdout_capture.getvalue(),
            "moduleError": error,
        })
        return

    results = []
    globals_dict = {"__builtins__": __builtins__}
    globals_dict.update(module.__dict__)

    default_input = sys.stdin
    for case in payload["testCases"]:
        supplied = case.get("stdin", payload.get("stdin"))
        sys.stdin = io.StringIO(supplied) if supplied is not None else default_input
        expected = parse_expected(case["expected"])
        stdout_capture = io.StringIO()
        try:
            with contextlib.redirect_stdout(stdout_capture):
                actual = eval(case["expression"], globals_dict, {})
            normalized_actual = normalize(actual)
            normalized_expected = normalize(expected)
            results.append({
                "id": case["id"],
                "description": case.get("description"),
                "passed": normalized_actual == normalized_expected,
                "actual": json.dumps(normalized_actual, ensure_ascii=False),
                "stdout": stdout_capture.getvalue(),
            })
        except BaseException as exc:
            results.append({
                "id": case["id"],
                "description": case.get("description"),
                "passed": False,
                "error": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
                "stdout": stdout_capture.getvalue(),
            })

    emit({
        "cases": results,
        "moduleStdout": module_stdout_capture.getvalue(),
    })


if __name__ == "__main__":
    main()
`.trim();

type CodeCase = {
  stdin?: string;
  id: string;
  description?: string;
  expression: string;
  expected: string;
  testCode?: string;
};

type RawRunnerCaseResult = {
  id: string;
  description?: string;
  passed: boolean;
  actual?: string;
  error?: string;
  stdout?: string;
};

type RawRunnerPayload = {
  cases?: RawRunnerCaseResult[];
  moduleStdout?: string;
  moduleError?: string;
  files?: Array<{ path: string; content: string }>;
};

type RunnerFile = { path: string; content: string };

type JudgeKind = 'run' | 'submit';
type JudgeRunTarget = 'code' | 'public' | 'secret';
type JudgeLocale = 'zh-CN' | 'en-US';
type CodeJudgeEvaluation = {
  status: 'passed' | 'failed' | 'partial' | 'error';
  score: number;
  result: NotebookProblemAttemptResult;
};

function normalizeCode(userAnswer: NotebookProblemAttemptAnswer): string {
  return userAnswer.code?.trim() || '';
}

function buildCodePayload(
  problem: NotebookProblemRecord,
  secretJudge: NotebookProblemSecretJudge | undefined,
  kind: JudgeKind,
  runTarget: JudgeRunTarget = 'public',
): {
  timeoutMs: number;
  publicCases: CodeCase[];
  secretCases: CodeCase[];
} {
  if (!isNotebookCodeProblemRecord(problem)) {
    throw new Error('Only code problems can be judged');
  }

  const publicCases =
    problem.publicContent.publicTestCode !== undefined
      ? [
          {
            id: '__suite__',
            expression: '',
            expected: '',
            testCode: problem.publicContent.publicTestCode,
          },
        ]
      : problem.publicContent.publicTests.map((testCase) => ({
          id: testCase.id,
          description: testCase.description,
          expression: testCase.expression,
          expected: testCase.expected,
        }));
  const secretCases =
    kind === 'submit' || runTarget === 'secret'
      ? secretJudge?.secretTestCode !== undefined
        ? [{ id: '__suite__', expression: '', expected: '', testCode: secretJudge.secretTestCode }]
        : (secretJudge?.secretTests ?? []).map((testCase) => ({
            id: testCase.id,
            description: testCase.description,
            expression: testCase.expression,
            expected: testCase.expected,
          }))
      : [];

  return {
    timeoutMs: secretJudge?.timeoutMs || DEFAULT_TIMEOUT_MS,
    publicCases,
    secretCases,
  };
}

async function executePythonCases(args: {
  code: string;
  starterCode?: string;
  testCases: CodeCase[];
  timeoutMs: number;
  files?: RunnerFile[];
  stdin?: string;
}): Promise<RawRunnerCaseResult[]> {
  const payload = await executePythonPayload(args);
  return payload.cases ?? [];
}

async function executePythonPayload(args: {
  code: string;
  starterCode?: string;
  testCases: CodeCase[];
  timeoutMs: number;
  mode?: 'tests' | 'script' | 'table_cells' | 'table_rows';
  files?: RunnerFile[];
  stdin?: string;
  extra?: Record<string, unknown>;
}): Promise<RawRunnerPayload> {
  const tempDir = path.join(os.tmpdir(), `problem_bank_${randomUUID()}`);
  const codePath = path.join(tempDir, 'submission.py');
  const runnerPath = path.join(tempDir, 'runner.py');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(codePath, args.code, 'utf8');
    await writeFile(runnerPath, PYTHON_RUNNER, 'utf8');

    const payload = {
      codePath,
      cs103Source: CS103_PYTHON_SOURCE,
      testCases: args.testCases,
      mode: args.mode ?? 'tests',
      testCode: args.testCases[0]?.testCode,
      files: args.files,
      stdin: args.stdin,
      ...args.extra,
    };
    return await runPythonJson<RawRunnerPayload>({
      runnerPath,
      payload,
      timeoutMs: args.timeoutMs,
      isolated: true,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runnerFiles(files: NotebookCodeFile[] | undefined): RunnerFile[] {
  return (files ?? [])
    .filter((file) => file.role !== 'expected_output')
    .map((file) => ({ path: file.path, content: file.content }));
}

/** Which runner judges a code problem; Python is the default for older records. */
type CodeRuntime = { language: 'python' } | { language: 'racket'; level: HtdpLanguageLevel };

function codeRuntimeFor(content: {
  language?: string;
  htdpLanguageLevel?: HtdpLanguageLevel;
}): CodeRuntime {
  return content.language?.trim().toLowerCase() === 'racket'
    ? { language: 'racket', level: content.htdpLanguageLevel ?? DEFAULT_HTDP_LANGUAGE_LEVEL }
    : { language: 'python' };
}

/** Design-recipe checks apply to HtDP Racket and to Python written against cs103 (CPSC 103). */
function designRecipeApplies(runtime: CodeRuntime, referenceCode: string): boolean {
  return Boolean(referenceCode) && (runtime.language === 'racket' || usesCs103(referenceCode));
}

async function runPythonDesignRecipe(args: {
  studentCode: string;
  referenceCode: string;
  starterCode?: string;
  recipe: RacketDesignRecipe;
  timeoutMs: number;
}): Promise<NotebookDesignRecipeCheck[]> {
  const tempDir = path.join(os.tmpdir(), `python_recipe_${randomUUID()}`);
  const codePath = path.join(tempDir, 'submission.py');
  const runnerPath = path.join(tempDir, 'recipe.py');
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(codePath, args.studentCode, 'utf8');
    await writeFile(runnerPath, PYTHON_RECIPE_DRIVER, 'utf8');
    const payload = {
      codePath,
      referenceText: args.referenceCode,
      starterText: args.starterCode,
      cs103Source: CS103_PYTHON_SOURCE,
      checkTemplate: args.recipe.checkTemplate ?? null,
      thoroughness: args.recipe.thoroughness,
    };
    const result = await runPythonJson<{ items?: NotebookDesignRecipeCheck[] }>({
      runnerPath,
      payload,
      timeoutMs: args.timeoutMs,
      isolated: true,
    });
    return result.items ?? [];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runDesignRecipe(
  runtime: CodeRuntime,
  args: {
    studentCode: string;
    referenceCode: string;
    starterCode?: string;
    recipe: RacketDesignRecipe;
    timeoutMs: number;
  },
): Promise<NotebookDesignRecipeCheck[]> {
  return runtime.language === 'racket'
    ? runRacketDesignRecipe({ ...args, level: runtime.level })
    : runPythonDesignRecipe(args);
}

async function executeRacketPayload(args: {
  code: string;
  level: HtdpLanguageLevel;
  testCases: CodeCase[];
  timeoutMs: number;
  mode?: 'tests' | 'script';
}): Promise<RawRunnerPayload> {
  const tempDir = path.join(os.tmpdir(), `problem_bank_${randomUUID()}`);
  const codePath = path.join(tempDir, 'submission.rkt');
  const driverPath = path.join(tempDir, 'driver.rkt');
  const payloadPath = path.join(tempDir, 'payload.json');
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(codePath, racketSubmissionSource(args.code, args.level), 'utf8');
    await writeFile(driverPath, RACKET_DRIVER, 'utf8');
    await writeFile(
      payloadPath,
      JSON.stringify({
        codePath,
        mode: args.mode ?? 'tests',
        testCases: args.testCases,
        testCode: args.testCases[0]?.testCode,
        timeoutMs: args.timeoutMs,
      }),
      'utf8',
    );
    return await runRacketJson<RawRunnerPayload>({
      driverPath,
      payloadPath,
      timeoutMs: args.timeoutMs,
      caseCount: args.testCases[0]?.testCode
        ? (args.testCases[0].testCode.match(/\(check-/g)?.length ?? 1)
        : args.testCases.length,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Racket problems ignore files and stdin: HtDP design problems are pure functions. */
function executeCodePayload(
  runtime: CodeRuntime,
  args: Parameters<typeof executePythonPayload>[0] & { mode?: 'tests' | 'script' },
): Promise<RawRunnerPayload> {
  return runtime.language === 'racket'
    ? executeRacketPayload({ ...args, level: runtime.level })
    : executePythonPayload(args);
}

async function executeCodeCases(
  runtime: CodeRuntime,
  args: Parameters<typeof executePythonCases>[0],
): Promise<RawRunnerCaseResult[]> {
  return (await executeCodePayload(runtime, args)).cases ?? [];
}

/** 表格题里需要 Python 才能判的格子（python_value / run_check）。 */
export async function runTableCellChecks(args: {
  items: Array<{
    key: string;
    matcher: 'python_value' | 'run_check';
    answer: string;
    accepted: string[];
    check?: string;
  }>;
  setup?: string;
  files?: NotebookCodeFile[];
}): Promise<Map<string, boolean>> {
  if (args.items.length === 0) return new Map();
  const payload = (await executePythonPayload({
    code: '',
    testCases: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    mode: 'table_cells',
    files: runnerFiles(args.files),
    extra: { items: args.items, setup: args.setup ?? '' },
  })) as RawRunnerPayload & { cells?: Array<{ key: string; correct: boolean }> };
  return new Map((payload.cells ?? []).map((cell) => [cell.key, cell.correct]));
}

export type TableRowRun = {
  id: string;
  stdout: string;
  value: string | null;
  errorType: string | null;
};

/** 真跑表格里每一行的代码片段：导入核对答案、老师「用代码生成答案」都用它。 */
export async function runTableRows(args: {
  rows: Array<{ id: string; code: string }>;
  setup?: string;
  files?: NotebookCodeFile[];
}): Promise<TableRowRun[]> {
  if (args.rows.length === 0) return [];
  const payload = (await executePythonPayload({
    code: '',
    testCases: [],
    timeoutMs: Math.min(20_000, DEFAULT_TIMEOUT_MS + args.rows.length * 500),
    mode: 'table_rows',
    extra: { rows: args.rows, setup: args.setup ?? '', files: runnerFiles(args.files) },
  })) as RawRunnerPayload & { rows?: TableRowRun[] };
  return payload.rows ?? [];
}

/** Compile the completed Python blocks without executing student/source code. */
export async function verifyCodeBlankDraft(
  draft: NotebookProblemImportDraft,
): Promise<NotebookProblemImportDraft> {
  const content = draft.publicContent;
  const grading = draft.grading;
  if (content.type !== 'fill_blank' || grading.type !== 'fill_blank') return draft;
  const blocks = [
    ...content.stemTemplate.matchAll(
      /^[ \t]*(`{3,}|~{3,})[ \t]*(?:python|py)[ \t]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,
    ),
  ]
    .map((match) => match[2])
    .filter((block) => /\{\{[^{}]+\}\}/.test(block));
  if (!blocks.length) return draft;
  const answers = Object.fromEntries(
    grading.blanks.map((blank) => [blank.id, blank.acceptedAnswers[0] ?? '']),
  );
  const variants = [
    answers,
    ...grading.blanks.flatMap((blank) =>
      blank.acceptedAnswers.slice(1).map((answer) => ({ ...answers, [blank.id]: answer })),
    ),
  ];
  const cases = variants.flatMap((values, variant) =>
    blocks.map((block, index) => {
      const completed = block.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (_, id: string) => values[id.trim()] ?? '',
      );
      return {
        id: `blank_${variant}_${index}`,
        expression: `__import__('ast').parse(${JSON.stringify(completed)}) is not None`,
        expected: 'True',
      };
    }),
  );
  let errors: string[] = [];
  try {
    const results = completeRunnerCaseResults(
      cases,
      await executePythonCases({ code: '', testCases: cases, timeoutMs: DEFAULT_TIMEOUT_MS }),
    );
    errors = results
      .filter((result) => !result.passed)
      .map(
        (result) =>
          `代码填空校验：参考答案填回代码后语法或缩进不正确（${result.id}）：${result.error ?? '检查失败'}`,
      );
  } catch (error) {
    errors = [`代码填空校验：${error instanceof Error ? error.message : String(error)}`];
  }
  return {
    ...draft,
    status: errors.length ? 'draft' : draft.status,
    sourceMeta: {
      ...draft.sourceMeta,
      codeBlankVerification: {
        passed: errors.length === 0,
        checkedBy: 'python-ast',
        checkedVariants: cases.length,
      },
    },
    validationErrors: [
      ...draft.validationErrors.filter((error) => !error.startsWith('代码填空校验：')),
      ...errors,
    ],
  };
}

export type CodeReferenceVerification = {
  passed: boolean;
  errors: string[];
  publicTestCount: number;
  secretTestCount: number;
};

export async function verifyNotebookCodeDraftReferenceAnswer(
  draft: NotebookProblemImportDraft,
): Promise<CodeReferenceVerification> {
  const readinessErrors = codeDraftReadinessErrors(draft);
  if (
    draft.type !== 'code' ||
    draft.publicContent.type !== 'code' ||
    draft.grading.type !== 'code'
  ) {
    return {
      passed: true,
      errors: [],
      publicTestCount: 0,
      secretTestCount: 0,
    };
  }

  const publicTests: CodeCase[] =
    draft.publicContent.publicTestCode !== undefined
      ? [
          {
            id: '__suite__',
            expression: '',
            expected: '',
            testCode: draft.publicContent.publicTestCode,
          },
        ]
      : draft.publicContent.publicTests;
  const secretTests: CodeCase[] =
    draft.secretJudge?.secretTestCode !== undefined
      ? [
          {
            id: '__suite__',
            expression: '',
            expected: '',
            testCode: draft.secretJudge.secretTestCode,
          },
        ]
      : (draft.secretJudge?.secretTests ?? []);
  if (readinessErrors.length > 0) {
    return {
      passed: false,
      errors: readinessErrors,
      publicTestCount: publicTests.length,
      secretTestCount: secretTests.length,
    };
  }

  const draftFiles = [
    ...runnerFiles(draft.publicContent.files),
    ...runnerFiles(draft.secretJudge?.files),
  ];
  const draftStdin = draft.publicContent.stdin;
  const draftRuntime = codeRuntimeFor(draft.publicContent);
  const draftSlots = codeSlotTemplateFor(draft.publicContent);
  // 有空位时「初始空实现」= 空位全空拼出来的代码
  const draftStarterCode = draftSlots
    ? assembleCodeFromSlots(draftSlots.template, draftSlots.slots, {})
    : (draft.publicContent.starterCode ?? '');
  try {
    const run = async (tests: CodeCase[]) =>
      completeRunnerCaseResults(
        tests,
        await executeCodeCases(draftRuntime, {
          code: [draft.secretJudge?.supportCode, codeReferenceSolution(draft)]
            .filter(Boolean)
            .join('\n\n'),
          testCases: tests,
          timeoutMs: draft.secretJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          files: draftFiles,
          stdin: draftStdin,
        }),
      );
    const publicResults = await run(publicTests);
    const secretResults = await run(secretTests);
    const exampleTests: CodeCase[] = draft.publicContent.sampleIO.map((sample, index) => ({
      id: `example_${index + 1}`,
      stdin: sample.stdin,
      expression: sample.input,
      expected: sample.output,
    }));
    const exampleResults = await run(exampleTests);
    const allTests = [...publicTests, ...secretTests, ...exampleTests];
    const results = [...publicResults, ...secretResults, ...exampleResults];
    const failed = results.filter((result) => !result.passed);
    const expectedById = new Map(allTests.map((testCase) => [testCase.id, testCase.expected]));
    const errors = failed.map(
      (result) =>
        `参考答案未通过 testcase ${result.id}${
          result.error
            ? `：${result.error}`
            : `：actual=${result.actual ?? 'unknown'}；expected=${expectedById.get(result.id) ?? 'unknown'}`
        }`,
    );
    if (
      draft.publicContent.publicTestCode !== undefined ||
      draft.secretJudge?.secretTestCode !== undefined
    ) {
      if (publicResults.length < 2) errors.push('代码题至少需要 2 个公开测试');
      if (secretResults.length < 3) errors.push('代码题至少需要 3 个隐藏测试');
      if (errors.length === 0) {
        const starterResults = await executeCodeCases(draftRuntime, {
          code: draftStarterCode,
          testCases: publicTests,
          timeoutMs: draft.secretJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          files: draftFiles,
          stdin: draftStdin,
        });
        if (starterResults.length > 0 && starterResults.every((result) => result.passed)) {
          errors.push('代码题公开测试未能拒绝初始空实现，请检查测试是否实际验证题目要求');
        }
      }
    }
    const recipe = draft.secretJudge?.designRecipe;
    if (
      recipe &&
      designRecipeApplies(draftRuntime, codeReferenceSolution(draft)) &&
      errors.length === 0
    ) {
      const recipeFor = (studentCode: string) =>
        runDesignRecipe(draftRuntime, {
          studentCode,
          referenceCode: codeReferenceSolution(draft),
          starterCode: draftStarterCode,
          recipe,
          timeoutMs: draft.secretJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
      const referenceItems = await recipeFor(codeReferenceSolution(draft));
      for (const item of referenceItems.filter((entry) => !entry.passed)) {
        errors.push(`参考答案未通过设计配方检查 ${item.target} ${item.id}：${item.detail ?? ''}`);
      }
      if (referenceItems.length === 0) {
        errors.push(
          draftRuntime.language === 'racket'
            ? '设计配方没有可检查的项：参考答案里没有 @htdf / @htdd 标签，或 starter 已经全部给出'
            : '设计配方没有可检查的项：参考答案里的函数和数据定义 starter 已经全部给出',
        );
      } else if ((await recipeFor(draftStarterCode)).every((item) => item.passed)) {
        errors.push('设计配方检查未能拒绝初始 starter');
      }
    }
    return {
      passed: errors.length === 0,
      errors,
      publicTestCount: publicResults.length,
      secretTestCount: secretResults.length,
    };
  } catch (error) {
    return {
      passed: false,
      errors: [`参考答案未通过运行校验：${error instanceof Error ? error.message : String(error)}`],
      publicTestCount: publicTests.length,
      secretTestCount: secretTests.length,
    };
  }
}

function completeRunnerCaseResults(
  expectedCases: CodeCase[],
  rawCases: RawRunnerCaseResult[],
): RawRunnerCaseResult[] {
  if (expectedCases[0]?.testCode !== undefined) return rawCases;
  const rawCasesById = new Map(rawCases.map((caseResult) => [caseResult.id, caseResult]));
  return expectedCases.map(
    (testCase) =>
      rawCasesById.get(testCase.id) ?? {
        id: testCase.id,
        description: testCase.description,
        passed: false,
        error: 'Test did not produce a result.',
      },
  );
}

function codeCaseSummary(args: {
  total: number;
  passed: number;
  label: 'public' | 'secret';
  locale: JudgeLocale;
}) {
  const failed = Math.max(0, args.total - args.passed);
  return {
    total: args.total,
    passed: args.passed,
    failed,
    failureSummary: codeTestSummaryFeedback({ total: args.total, failed }, args.label, args.locale),
  };
}

function codeSubmitFeedback(args: {
  allPassed: boolean;
  publicSummary: ReturnType<typeof codeCaseSummary>;
  secretSummary: ReturnType<typeof codeCaseSummary>;
  locale: JudgeLocale;
}) {
  if (args.allPassed) {
    return args.locale === 'zh-CN'
      ? '公开测试和隐藏测试全部通过。'
      : 'All public and secret tests passed.';
  }

  return args.locale === 'zh-CN'
    ? `公开测试：${args.publicSummary.failed} 个未通过（通过 ${args.publicSummary.passed}/${args.publicSummary.total}）；隐藏测试：${args.secretSummary.failed} 个未通过（通过 ${args.secretSummary.passed}/${args.secretSummary.total}）。`
    : `Public tests: ${args.publicSummary.failed} failed (${args.publicSummary.passed}/${args.publicSummary.total} passed); secret tests: ${args.secretSummary.failed} failed (${args.secretSummary.passed}/${args.secretSummary.total} passed).`;
}

function visibleCodeProblemContractText(
  problem: NotebookProblemRecord,
  locale: JudgeLocale,
): string {
  if (!isNotebookCodeProblemRecord(problem)) return problem.title;
  const content = problem.publicContent;
  const localized = content.translations?.[locale];
  const statementSections = (content.statementSections ?? []).flatMap((section) => [
    `Visible section: ${section.title}`,
    section.body ?? '',
    ...(section.items ?? []),
    section.code
      ? `Visible provided code:\n\`\`\`${content.language}\n${section.code}\n\`\`\``
      : '',
  ]);
  return [
    `Visible problem title: ${problem.title}`,
    `Visible problem statement: ${localized?.stem ?? content.stem}`,
    content.functionSignature ? `Visible function signature: ${content.functionSignature}` : '',
    ...content.constraints.map((constraint) => `Visible constraint: ${constraint}`),
    ...statementSections,
    content.starterCode
      ? `Visible starter code:\n\`\`\`${content.language}\n${content.starterCode}\n\`\`\``
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function enforceCodeSubmissionCourseContract(args: {
  problem: NotebookProblemRecord;
  userAnswer: NotebookProblemAttemptAnswer;
  courseIdentity?: NotebookProblemCourseIdentity;
  locale: JudgeLocale;
  evaluated: CodeJudgeEvaluation;
}): CodeJudgeEvaluation {
  if (!args.courseIdentity) return args.evaluated;
  const submittedCode = normalizeCode(args.userAnswer);
  const validation = validateCourseAnswerContract({
    courseId: args.courseIdentity.id,
    courseCode: args.courseIdentity.courseCode,
    courseName: args.courseIdentity.name,
    notebookId: args.problem.notebookId,
    notebookName: args.problem.notebookName,
    message: visibleCodeProblemContractText(args.problem, args.locale),
    answerText: [args.userAnswer.text?.trim(), submittedCode].filter(Boolean).join('\n\n'),
    answerCode: submittedCode,
    taskHint: 'grading',
  });
  if (validation.failures.length === 0) return args.evaluated;

  const heading =
    args.locale === 'zh-CN'
      ? `${validation.courseCode ?? '课程'} 课程规范未通过：`
      : `${validation.courseCode ?? 'Course'} contract checks failed:`;
  const contractFeedback = [
    heading,
    ...validation.failures.map((failure) => `- [${failure.checkId}] ${failure.message}`),
  ].join('\n');
  return {
    status: 'failed',
    score: 0,
    result: {
      ...args.evaluated.result,
      correct: false,
      earnedPoints: 0,
      feedback: [args.evaluated.result.feedback, contractFeedback].filter(Boolean).join('\n\n'),
    },
  };
}

const DESIGN_RECIPE_LABELS: Record<NotebookDesignRecipeCheck['id'], [string, string]> = {
  read: ['读取代码', 'Reading the file'],
  signature: ['签名（@signature）', 'Signature'],
  typecheck: ['@typecheck', '@typecheck'],
  purpose: ['目的说明（docstring）', 'Purpose'],
  stub: ['存根（stub）', 'Stub'],
  data_definition: ['数据定义', 'Data definition'],
  template_origin: ['模板来源（template based on）', 'Template origin'],
  dd_template_rules: ['@dd-template-rules', '@dd-template-rules'],
  template: ['模板', 'Template'],
  test_validity: ['测试是否正确', 'Tests are correct'],
  test_thoroughness: ['测试是否覆盖全面', 'Tests are thorough'],
};

function designRecipeFeedback(items: NotebookDesignRecipeCheck[], locale: JudgeLocale): string {
  const failed = items.filter((item) => !item.passed);
  const heading =
    locale === 'zh-CN'
      ? `设计配方：通过 ${items.length - failed.length}/${items.length}。`
      : `Design recipe: ${items.length - failed.length}/${items.length} checks passed.`;
  return [
    heading,
    ...failed.map((item) => {
      const label = DESIGN_RECIPE_LABELS[item.id][locale === 'zh-CN' ? 0 : 1];
      return `- ${item.target ? `${item.target} ` : ''}${label}${item.detail ? `：${item.detail}` : ''}`;
    }),
  ].join('\n');
}

/** The reference solution the design recipe is compared with (hidden from students). */
function designRecipeReference(problem: NotebookProblemRecord): string {
  return problem.grading.type === 'code'
    ? problem.grading.solutionCode?.trim() || problem.grading.referenceAnswer?.trim() || ''
    : '';
}

/**
 * Problems with a design recipe (Racket or cs103 Python) score partially: the recipe share is split evenly
 * over its checks and the rest follows the fraction of tests passed. Full marks need every
 * test and every check. Tests only count once a designed function's body differs from the
 * starter's stub, so a stub that happens to pass some tests earns no test credit.
 */
async function applyDesignRecipe(args: {
  problem: NotebookProblemRecord;
  recipe: RacketDesignRecipe;
  runtime: CodeRuntime;
  code: string;
  timeoutMs: number;
  testsPassed: number;
  testsTotal: number;
  evaluated: CodeJudgeEvaluation;
  locale: JudgeLocale;
}): Promise<CodeJudgeEvaluation> {
  const referenceCode = designRecipeReference(args.problem);
  if (!referenceCode || !isNotebookCodeProblemRecord(args.problem)) return args.evaluated;
  const items = (
    await runDesignRecipe(args.runtime, {
      studentCode: args.code,
      referenceCode,
      starterCode: args.problem.publicContent.starterCode,
      recipe: args.recipe,
      timeoutMs: args.timeoutMs,
    })
  ).map((item) => ({
    ...item,
    target: item.target.slice(0, 120),
    detail: item.detail?.slice(0, 2000),
  }));
  const points = args.problem.points;
  const recipeShare = items.length === 0 ? 0 : args.testsTotal === 0 ? 1 : args.recipe.weight / 100;
  const edited = designedFunctionsEdited({
    language: args.runtime.language,
    code: args.code,
    starterCode: args.problem.publicContent.starterCode,
    referenceCode,
  });
  const testFraction = args.testsTotal === 0 ? 1 : edited ? args.testsPassed / args.testsTotal : 0;
  const recipeFraction =
    items.length === 0 ? 1 : items.filter((item) => item.passed).length / items.length;
  const allPassed = testFraction === 1 && recipeFraction === 1;
  const earned = allPassed
    ? points
    : Math.round(points * ((1 - recipeShare) * testFraction + recipeShare * recipeFraction));
  return {
    status: allPassed ? 'passed' : earned > 0 ? 'partial' : 'failed',
    score: earned,
    result: {
      ...args.evaluated.result,
      correct: allPassed,
      earnedPoints: earned,
      feedback: [
        args.testsTotal > 0 ? args.evaluated.result.feedback : undefined,
        args.testsTotal > 0 && !edited
          ? args.locale === 'zh-CN'
            ? '函数体还是初始的 stub，改写函数体之后测试才计分。'
            : 'The function body is still the starter stub; tests count once you edit it.'
          : undefined,
        items.length > 0 ? designRecipeFeedback(items, args.locale) : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
      designRecipe: items,
    },
  };
}

export async function judgeNotebookCodeProblem(args: {
  problem: NotebookProblemRecord;
  secretJudge?: NotebookProblemSecretJudge;
  userAnswer: NotebookProblemAttemptAnswer;
  kind: JudgeKind;
  runTarget?: JudgeRunTarget;
  language?: JudgeLocale;
  courseIdentity?: NotebookProblemCourseIdentity;
}): Promise<CodeJudgeEvaluation> {
  const locale = args.language ?? 'en-US';
  const runTarget = args.kind === 'run' ? (args.runTarget ?? 'public') : 'public';
  const code = normalizeCode(args.userAnswer);
  if (!code) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback: locale === 'zh-CN' ? '请先填写代码。' : 'Code is required.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  if (!isNotebookCodeProblemRecord(args.problem)) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          locale === 'zh-CN' ? '这里只能评测代码题。' : 'Only code problems can be judged here.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }

  const problem = args.problem;
  const content = problem.publicContent;
  // 老师定了空位的题，锁住的代码不能改（防止绕过界面直接改函数头或测试）
  const slotTemplate = codeSlotTemplateFor(content);
  const slotValues = slotTemplate
    ? extractSlotValues(slotTemplate.template, slotTemplate.slots, code)
    : null;
  if (
    slotTemplate &&
    (!slotValues ||
      assembleCodeFromSlots(slotTemplate.template, slotTemplate.slots, slotValues).trim() !==
        code.trim())
  ) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          locale === 'zh-CN'
            ? '只能修改空位里的代码，题目给出的部分被改动了。'
            : 'Only the blanks can be edited; the provided code was changed.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }
  const runtime = codeRuntimeFor(content);
  // Racket starters define the stub the student replaces; prepending it would redefine names.
  // cs103 answers are whole design-recipe files that replace the starter.
  const starterPrelude =
    runtime.language === 'python' &&
    !usesCs103(content.starterCode) &&
    !slotTemplate &&
    content.starterCode &&
    !code.trim().startsWith(content.starterCode.trim())
      ? content.starterCode
      : undefined;
  const executionCode = [args.secretJudge?.supportCode, starterPrelude, code]
    .filter(Boolean)
    .join('\n\n');
  const publicFiles = runnerFiles(content.files);
  const secretFiles = [...publicFiles, ...runnerFiles(args.secretJudge?.files)];

  const payload = buildCodePayload(problem, args.secretJudge, args.kind, runTarget);
  const designRecipe = designRecipeApplies(runtime, designRecipeReference(problem))
    ? args.secretJudge?.designRecipe
    : undefined;

  // A design-recipe-only problem (e.g. write an HtDD template) has no tests to run.
  if (
    args.kind === 'submit' &&
    designRecipe &&
    payload.publicCases.length === 0 &&
    payload.secretCases.length === 0
  ) {
    try {
      return await applyDesignRecipe({
        problem,
        recipe: designRecipe,
        runtime,
        code,
        timeoutMs: payload.timeoutMs,
        testsPassed: 0,
        testsTotal: 0,
        evaluated: {
          status: 'failed',
          score: 0,
          result: { correct: false, earnedPoints: 0, publicCases: [] },
        },
        locale,
      });
    } catch (error) {
      return {
        status: 'error',
        score: 0,
        result: {
          correct: false,
          feedback: error instanceof Error ? error.message : String(error),
          earnedPoints: 0,
          publicCases: [],
        },
      };
    }
  }

  if (args.kind === 'run' && runTarget === 'code') {
    try {
      const runnerPayload = await executeCodePayload(runtime, {
        code: executionCode,
        starterCode: problem.publicContent.starterCode,
        testCases: [],
        timeoutMs: payload.timeoutMs,
        mode: 'script',
        files: publicFiles,
        stdin: content.stdin,
      });
      const hasError = Boolean(runnerPayload.moduleError);
      return {
        status: hasError ? 'error' : 'passed',
        score: 0,
        result: {
          correct: hasError ? false : null,
          feedback: hasError
            ? locale === 'zh-CN'
              ? '代码运行出错。'
              : 'Code raised an error.'
            : locale === 'zh-CN'
              ? '代码运行完成。'
              : 'Code ran successfully.',
          earnedPoints: 0,
          runTarget: 'code',
          stdout: runnerPayload.moduleStdout || undefined,
          error: runnerPayload.moduleError || undefined,
          files: runnerPayload.files?.length ? runnerPayload.files : undefined,
          publicCases: [],
        },
      };
    } catch (error) {
      return {
        status: 'error',
        score: 0,
        result: {
          correct: false,
          feedback:
            error instanceof Error
              ? error.message
              : locale === 'zh-CN'
                ? '代码运行器暂时不可用，请稍后再试。'
                : 'Code runner unavailable. Please try again later.',
          earnedPoints: 0,
          runTarget: 'code',
          publicCases: [],
        },
      };
    }
  }

  if ((args.kind === 'submit' || runTarget === 'public') && payload.publicCases.length === 0) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          locale === 'zh-CN'
            ? '这道代码题缺少公开测试，无法提交。'
            : 'This code problem is missing public tests.',
        earnedPoints: 0,
        runTarget,
        publicCases: [],
      },
    };
  }

  if ((args.kind === 'submit' || runTarget === 'secret') && payload.secretCases.length === 0) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          locale === 'zh-CN'
            ? args.kind === 'submit'
              ? '这道代码题缺少隐藏测试。提交必须同时通过公开测试和隐藏测试。'
              : '这道代码题缺少隐藏测试，无法运行。'
            : args.kind === 'submit'
              ? 'This code problem is missing secret tests. Submissions must pass both public and secret tests.'
              : 'This code problem is missing secret tests.',
        earnedPoints: 0,
        runTarget,
        publicCases: [],
        secretSummary: codeCaseSummary({
          total: 0,
          passed: 0,
          label: 'secret',
          locale,
        }),
      },
    };
  }

  try {
    if (args.kind === 'run' && runTarget === 'secret') {
      const secretCases = completeRunnerCaseResults(
        payload.secretCases,
        await executeCodeCases(runtime, {
          code: executionCode,
          starterCode: problem.publicContent.starterCode,
          testCases: payload.secretCases,
          timeoutMs: payload.timeoutMs,
          files: secretFiles,
          stdin: content.stdin,
        }),
      );
      const secretCaseResults = secretCases.map((caseResult) => ({
        id: caseResult.id,
        description: caseResult.description,
        passed: caseResult.passed,
        actual: caseResult.actual,
        error: caseResult.error,
        stdout: caseResult.stdout,
      }));
      const secretPassed = secretCaseResults.filter((caseResult) => caseResult.passed).length;
      const secretFailed = secretCaseResults.length - secretPassed;
      const secretSummary = codeCaseSummary({
        total: secretCaseResults.length,
        passed: secretPassed,
        label: 'secret',
        locale,
      });
      const allPassed = secretFailed === 0;
      return {
        status: allPassed ? 'passed' : secretPassed > 0 ? 'partial' : 'failed',
        score: 0,
        result: {
          correct: allPassed,
          feedback:
            locale === 'zh-CN'
              ? `隐藏测试：通过 ${secretPassed}/${secretCaseResults.length}，${secretFailed} 个未通过。`
              : `Secret tests: ${secretPassed}/${secretCaseResults.length} passed; ${secretFailed} failed.`,
          earnedPoints: 0,
          runTarget: 'secret',
          caseResults: secretCaseResults,
          publicCases: [],
          secretSummary,
        },
      };
    }

    const publicCases = completeRunnerCaseResults(
      payload.publicCases,
      await executeCodeCases(runtime, {
        code: executionCode,
        starterCode: problem.publicContent.starterCode,
        testCases: payload.publicCases,
        timeoutMs: payload.timeoutMs,
        files: publicFiles,
        stdin: content.stdin,
      }),
    );
    const publicCaseResults = publicCases.map((caseResult) => ({
      id: caseResult.id,
      description: caseResult.description,
      passed: caseResult.passed,
      actual: caseResult.actual,
      error: caseResult.error,
      stdout: caseResult.stdout,
    }));

    const publicPassed = publicCaseResults.filter((caseResult) => caseResult.passed).length;
    const publicFailed = publicCaseResults.length - publicPassed;
    const publicSummary = codeCaseSummary({
      total: publicCaseResults.length,
      passed: publicPassed,
      label: 'public',
      locale,
    });

    if (args.kind === 'run') {
      const allPassed = publicFailed === 0;
      return {
        status: allPassed ? 'passed' : publicPassed > 0 ? 'partial' : 'failed',
        score: allPassed ? problem.points : 0,
        result: {
          correct: allPassed,
          feedback:
            locale === 'zh-CN'
              ? `公开测试：通过 ${publicPassed}/${publicCaseResults.length}，${publicFailed} 个未通过。`
              : `Public tests: ${publicPassed}/${publicCaseResults.length} passed; ${publicFailed} failed.`,
          earnedPoints: allPassed ? problem.points : 0,
          runTarget: 'public',
          caseResults: publicCaseResults,
          publicCases: publicCaseResults,
          publicSummary,
        },
      };
    }

    const secretCases = completeRunnerCaseResults(
      payload.secretCases,
      await executeCodeCases(runtime, {
        code: executionCode,
        starterCode: problem.publicContent.starterCode,
        testCases: payload.secretCases,
        timeoutMs: payload.timeoutMs,
        files: secretFiles,
        stdin: content.stdin,
      }),
    );
    const secretPassed = secretCases.filter((caseResult) => caseResult.passed).length;
    const secretSummary = codeCaseSummary({
      total: secretCases.length,
      passed: secretPassed,
      label: 'secret',
      locale,
    });
    const secretFailed = secretSummary.failed;
    const allPassed = publicFailed === 0 && secretFailed === 0;
    const evaluated: CodeJudgeEvaluation = {
      status: allPassed ? 'passed' : publicPassed > 0 || secretPassed > 0 ? 'partial' : 'failed',
      score: allPassed ? problem.points : 0,
      result: {
        correct: allPassed,
        feedback: codeSubmitFeedback({
          allPassed,
          publicSummary,
          secretSummary,
          locale,
        }),
        earnedPoints: allPassed ? problem.points : 0,
        publicCases: publicCaseResults,
        publicSummary,
        secretSummary,
      },
    };
    return enforceCodeSubmissionCourseContract({
      problem,
      userAnswer: args.userAnswer,
      courseIdentity: args.courseIdentity,
      locale,
      evaluated: designRecipe
        ? await applyDesignRecipe({
            problem,
            recipe: designRecipe,
            runtime,
            code,
            timeoutMs: payload.timeoutMs,
            testsPassed: publicPassed + secretPassed,
            testsTotal: publicCaseResults.length + secretCases.length,
            evaluated,
            locale,
          })
        : evaluated,
    });
  } catch (error) {
    return {
      status: 'error',
      score: 0,
      result: {
        correct: false,
        feedback:
          error instanceof Error
            ? error.message
            : locale === 'zh-CN'
              ? '代码运行器暂时不可用，请稍后再试。'
              : 'Code runner unavailable. Please try again later.',
        earnedPoints: 0,
        publicCases: [],
      },
    };
  }
}
