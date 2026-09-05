import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPythonJson } from '@/lib/server/python-runner';
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
  codeReferenceSolution,
  isNotebookCodeProblemRecord,
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


def main():
    payload = json.loads(sys.argv[1])

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
            })
            return

        emit({
            "cases": [],
            "moduleStdout": script_stdout_capture.getvalue(),
        })
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

    for case in payload["testCases"]:
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
  id: string;
  description?: string;
  expression: string;
  expected: string;
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
};

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

  const publicCases = problem.publicContent.publicTests.map((testCase) => ({
    id: testCase.id,
    description: testCase.description,
    expression: testCase.expression,
    expected: testCase.expected,
  }));
  const secretCases =
    kind === 'submit' || runTarget === 'secret'
      ? (secretJudge?.secretTests ?? []).map((testCase) => ({
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
}): Promise<RawRunnerCaseResult[]> {
  const payload = await executePythonPayload(args);
  return payload.cases ?? [];
}

async function executePythonPayload(args: {
  code: string;
  starterCode?: string;
  testCases: CodeCase[];
  timeoutMs: number;
  mode?: 'tests' | 'script';
}): Promise<RawRunnerPayload> {
  const tempDir = path.join(os.tmpdir(), `problem_bank_${randomUUID()}`);
  const codePath = path.join(tempDir, 'submission.py');
  const runnerPath = path.join(tempDir, 'runner.py');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      codePath,
      [args.starterCode?.trim(), args.code.trim()].filter(Boolean).join('\n\n'),
      'utf8',
    );
    await writeFile(runnerPath, PYTHON_RUNNER, 'utf8');

    const payload = {
      codePath,
      testCases: args.testCases,
      mode: args.mode ?? 'tests',
    };
    return await runPythonJson<RawRunnerPayload>({
      runnerPath,
      payload,
      timeoutMs: args.timeoutMs,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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

  const publicTests = draft.publicContent.publicTests;
  const secretTests = draft.secretJudge?.secretTests ?? [];
  if (readinessErrors.length > 0) {
    return {
      passed: false,
      errors: readinessErrors,
      publicTestCount: publicTests.length,
      secretTestCount: secretTests.length,
    };
  }

  try {
    const allTests = [...publicTests, ...secretTests];
    const results = completeRunnerCaseResults(
      allTests,
      await executePythonCases({
        code: codeReferenceSolution(draft),
        starterCode: draft.publicContent.starterCode,
        testCases: allTests,
        timeoutMs: draft.secretJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    );
    const failed = results.filter((result) => !result.passed);
    const expectedById = new Map(allTests.map((testCase) => [testCase.id, testCase.expected]));
    return {
      passed: failed.length === 0,
      errors: failed.map(
        (result) =>
          `参考答案未通过 testcase ${result.id}${
            result.error
              ? `：${result.error}`
              : `：actual=${result.actual ?? 'unknown'}；expected=${expectedById.get(result.id) ?? 'unknown'}`
          }`,
      ),
      publicTestCount: publicTests.length,
      secretTestCount: secretTests.length,
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
    section.code ? `Visible provided code:\n\`\`\`python\n${section.code}\n\`\`\`` : '',
  ]);
  return [
    `Visible problem title: ${problem.title}`,
    `Visible problem statement: ${localized?.stem ?? content.stem}`,
    content.functionSignature ? `Visible function signature: ${content.functionSignature}` : '',
    ...content.constraints.map((constraint) => `Visible constraint: ${constraint}`),
    ...statementSections,
    content.starterCode
      ? `Visible starter code:\n\`\`\`python\n${content.starterCode}\n\`\`\``
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

  const payload = buildCodePayload(problem, args.secretJudge, args.kind, runTarget);

  if (args.kind === 'run' && runTarget === 'code') {
    try {
      const runnerPayload = await executePythonPayload({
        code,
        starterCode: problem.publicContent.starterCode,
        testCases: [],
        timeoutMs: payload.timeoutMs,
        mode: 'script',
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
        await executePythonCases({
          code,
          starterCode: problem.publicContent.starterCode,
          testCases: payload.secretCases,
          timeoutMs: payload.timeoutMs,
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
      await executePythonCases({
        code,
        starterCode: problem.publicContent.starterCode,
        testCases: payload.publicCases,
        timeoutMs: payload.timeoutMs,
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
      await executePythonCases({
        code,
        starterCode: problem.publicContent.starterCode,
        testCases: payload.secretCases,
        timeoutMs: payload.timeoutMs,
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
      evaluated,
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
