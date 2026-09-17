#!/usr/bin/env node

import fs from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import ts from 'typescript';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const RUNNER_VERSION = 'phase2-07-08-memory-writeback-cli-v1';
const PROBLEM_SCENARIO = 'memory-problem-writeback';
const QUESTION_SCENARIO = 'memory-question-writeback';
const PROBLEM_CASES_PATH = path.join(
  REPOSITORY_ROOT,
  'features/qa/test-center/memory/local-memory-test-store.ts',
);
const QUESTION_CASES_PATH = path.join(
  REPOSITORY_ROOT,
  'features/qa/test-center/memory/csc148-question-writeback-cases.ts',
);
const NORMALIZER_PATH = path.join(
  REPOSITORY_ROOT,
  'features/memory/domain/learner-memory-update.ts',
);

const HELP = `
真实运行第二阶段 07/08 的记忆写回案例，并把 CLI 记录与浏览器记录分开保存。

用法:
  node scripts/maintenance/run-phase2-07-08-memory-writeback.mjs [选项]

选项:
  --scenario <all|07|08|memory-problem-writeback|memory-question-writeback>
      选择阶段；默认 all。
  --limit <正整数>
      只运行筛选结果的前 N 条；默认运行所选阶段全部案例。
  --case <case-id>
      只运行指定 case，可与 --scenario 同用。
  --help, -h
      显示帮助，不读取 API key，也不调用模型。

环境:
  OPENAI_API_KEY       必需；优先使用当前进程环境，其次读取 .env.local / .env。
  DEFAULT_MODEL        可选；默认 gpt-5.6-sol，可写 openai:gpt-5.6-sol。
  OPENAI_BASE_URL      可选；默认 https://api.openai.com/v1。
  HTTPS_PROXY/HTTP_PROXY（以及小写形式）
      可选；通过 undici ProxyAgent 发送请求。runner 不输出 key 或代理地址。

输出:
  tmp/platform-tests/memory-phase2/<scenario>/cli-latest/<case-id>.json
  tmp/platform-tests/memory-phase2/<scenario>/cli-runs/<timestamp>-<case-id>.json
  同一结果也以现有 GET envelope 同步到 <scenario>/latest 与 <scenario>/runs。

示例:
  node scripts/maintenance/run-phase2-07-08-memory-writeback.mjs --scenario 07 --limit 2
  node scripts/maintenance/run-phase2-07-08-memory-writeback.mjs --scenario 08 --case zhou-ambiguous-no-context
`.trim();

function parseArguments(argv) {
  const options = {
    scenario: 'all',
    limit: null,
    caseId: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag === '--scenario' || flag === '--limit' || flag === '--case') {
      const value = inlineValue ?? argv[++index];
      if (!value || value.startsWith('--')) {
        throw new Error(`${flag} 需要一个值。`);
      }
      if (flag === '--scenario') options.scenario = value;
      if (flag === '--case') options.caseId = value;
      if (flag === '--limit') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('--limit 必须是正整数。');
        }
        options.limit = parsed;
      }
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  const aliases = new Map([
    ['all', 'all'],
    ['07', PROBLEM_SCENARIO],
    ['7', PROBLEM_SCENARIO],
    ['problem', PROBLEM_SCENARIO],
    [PROBLEM_SCENARIO, PROBLEM_SCENARIO],
    ['08', QUESTION_SCENARIO],
    ['8', QUESTION_SCENARIO],
    ['question', QUESTION_SCENARIO],
    [QUESTION_SCENARIO, QUESTION_SCENARIO],
  ]);
  const scenario = aliases.get(options.scenario);
  if (!scenario) {
    throw new Error(`未知 scenario：${options.scenario}`);
  }
  return { ...options, scenario };
}

function loadLocalEnvironment() {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(REPOSITORY_ROOT, filename);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      process.env[match[1]] = value;
    }
  }
}

function findVariableInitializer(sourceFile, exportName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) === exportName && declaration.initializer) {
        return declaration.initializer;
      }
    }
  }
  throw new Error(`在 ${sourceFile.fileName} 中找不到 ${exportName}。`);
}

function extractLiteralExport(filePath, exportName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const initializer = findVariableInitializer(sourceFile, exportName);
  const evaluationSource = `module.exports = (${initializer.getText(sourceFile)});`;
  const transpiled = ts.transpileModule(evaluationSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: `${filePath}#${exportName}`,
  }).outputText;
  const compiled = { exports: {} };
  new Function('module', 'exports', transpiled)(compiled, compiled.exports);
  return compiled.exports;
}

function loadSharedNormalizers() {
  const source = fs.readFileSync(NORMALIZER_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: NORMALIZER_PATH,
  }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', transpiled)(require, compiled, compiled.exports);
  const { normalizeQuestionMemoryDiagnosis, normalizeAttemptMemoryDiagnosis } = compiled.exports;
  if (
    typeof normalizeQuestionMemoryDiagnosis !== 'function' ||
    typeof normalizeAttemptMemoryDiagnosis !== 'function'
  ) {
    throw new Error('共享 learner-memory-update.ts 没有导出预期的归一化函数。');
  }
  return { normalizeQuestionMemoryDiagnosis, normalizeAttemptMemoryDiagnosis };
}

function normalizeModelId(value) {
  const configured = value?.trim() || 'gpt-5.6-sol';
  return configured.replace(/^(?:openai[:/])+/i, '');
}

function buildOpenAIClient(apiKey) {
  const proxyUrl =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    null;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  const proxyFetch = (input, init = {}) =>
    undiciFetch(input, dispatcher ? { ...init, dispatcher } : init);
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    fetch: proxyFetch,
  });
  return { openai, dispatcher, proxyEnabled: Boolean(proxyUrl) };
}

function compact(value, maxChars = 1_000) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}…`;
}

function stableProblemId(caseId) {
  return `cli_problem_${caseId}`;
}

function stableAttemptId(caseId, index) {
  return `cli_attempt_${caseId}_${index + 1}`;
}

function answerText(submission) {
  return submission.answer?.trim() || (submission.selectedOptionIds || []).join('、').trim();
}

function isObjectiveCase(testCase) {
  return testCase.questionType === 'single' || testCase.questionType === 'multiple';
}

function objectiveAttempt(testCase, submission, index) {
  const selected = [...(submission.selectedOptionIds || [])].sort();
  const expected = Array.isArray(testCase.referenceAnswer)
    ? [...testCase.referenceAnswer].sort()
    : [testCase.referenceAnswer];
  const submitted = selected.length > 0 || Boolean(submission.answer?.trim());
  if (!submitted) {
    return {
      id: stableAttemptId(testCase.id, index),
      status: 'ungraded',
      score: 0,
      maxScore: testCase.points,
      answer: answerText(submission),
      feedback: '没有收到可判定的答案，平台未执行正误判断。',
      gradingSource: 'not_graded',
      gradingReliable: false,
    };
  }
  const correct = isDeepStrictEqual(selected, expected);
  return {
    id: stableAttemptId(testCase.id, index),
    status: correct ? 'passed' : 'failed',
    score: correct ? testCase.points : 0,
    maxScore: testCase.points,
    answer: answerText(submission),
    feedback: correct
      ? `平台按保存的正确选项判定：回答正确。学生选择 ${selected.join('、')}。`
      : `平台按保存的正确选项判定：回答不正确。学生选择 ${selected.join(
          '、',
        )}；正确选项为 ${expected.join('、')}。`,
    gradingSource: 'platform_objective',
    gradingReliable: true,
  };
}

function statusFromScore(score, maxScore) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.8) return 'passed';
  if (score > 0) return 'partial';
  return 'failed';
}

function sourceQuestionTokens(question) {
  const tokens = Array.from(
    new Set(
      (question.toLowerCase().match(/[a-z_][a-z0-9_]{1,}|[\p{Script=Han}]{2,}/giu) || [])
        .filter((token) => token.length >= 2)
        .slice(0, 80),
    ),
  );
  if (/\bri\b|representation invariant/i.test(question)) {
    tokens.push('representation', 'invariant', 'invariants');
  }
  if (/\bqueue\b|\badt\b/i.test(question)) {
    tokens.push('queue', 'fifo', 'stack', 'abstract data type');
  }
  if (/\bbst\b|binary search tree/i.test(question)) {
    tokens.push('binary search tree', 'bst', 'ordering invariant');
  }
  if (/traceback|except|exception|\btry\b/i.test(question)) {
    tokens.push('exception', 'exceptions', 'except', 'handler');
  }
  if (/class|python_ta/i.test(question)) {
    tokens.push('class design recipe', 'representation invariants', 'python_ta');
  }
  return Array.from(new Set(tokens));
}

function selectSourceSections(source, question) {
  const tokens = sourceQuestionTokens(question);
  const chunks = source.split(/(?=^#{1,3}\s+)/gm).filter((chunk) => chunk.trim());
  const ranked = chunks.map((chunk, index) => {
    const title =
      chunk
        .split('\n', 1)[0]
        ?.replace(/^#{1,3}\s+/, '')
        .trim() || `资料片段 ${index + 1}`;
    const normalized = chunk.toLowerCase();
    const score = tokens.reduce(
      (total, token) => total + Math.min(normalized.split(token).length - 1, 4),
      0,
    );
    return { title, content: chunk.trim(), score };
  });
  const matches = ranked.filter((section) => section.score > 0).sort((a, b) => b.score - a.score);
  const selected = (matches.length ? matches : ranked).slice(0, 5);
  let remaining = 48_000;
  return selected
    .map((section) => {
      const content = section.content.slice(0, remaining);
      remaining -= content.length;
      return { ...section, content };
    })
    .filter((section) => section.content.length > 0);
}

async function questionSourceContext(testCase) {
  if (!testCase.sourceFilename) {
    return { sections: [], prompt: '本轮没有可确认的 CSC148 资料上下文。' };
  }
  const sourcePath = path.join(REPOSITORY_ROOT, 'queue', 'CSC148', testCase.sourceFilename);
  const content = await readFile(sourcePath, 'utf8');
  const sections = selectSourceSections(content, testCase.userMessage);
  return {
    sections,
    prompt: sections
      .map((section, index) => `### ${index + 1}. ${section.title}\n${section.content}`)
      .join('\n\n'),
  };
}

const rawQuestionDiagnosisSchema = z.object({
  category: z.enum([
    'definition',
    'clarification',
    'pasted_problem',
    'code_review',
    'error_debug',
    'outside_course',
  ]),
  courseRelevant: z.boolean(),
  knowledgePoint: z.string().trim().min(1).max(300),
  masteredSignal: z.string().trim().min(1).max(1_000).nullable(),
  stuckPoint: z.string().trim().min(1).max(1_000).nullable(),
  cause: z.string().trim().min(1).max(1_000).nullable(),
  nextTeachingMove: z.string().trim().min(1).max(1_000),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceFromMessage: z.array(z.string().trim().min(1).max(500)).max(8),
  workingMemoryAction: z.enum(['update', 'skip']),
  durableMemoryAction: z.enum(['create', 'revise', 'skip']),
  durableMemoryReason: z.string().trim().min(1).max(1_200),
});

const rawAttemptDiagnosisSchema = z.object({
  knowledgePoint: z.string().trim().min(1).max(300),
  masteredSignal: z.string().trim().min(1).max(1_000).nullable(),
  stuckPoint: z.string().trim().min(1).max(1_000).nullable(),
  cause: z.string().trim().min(1).max(1_000).nullable(),
  nextTeachingMove: z.string().trim().min(1).max(1_000),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceFromAttempt: z.array(z.string().trim().min(1).max(320)).max(8),
  durableMemoryReason: z.string().trim().min(1).max(1_200),
});

function fixtureBaseline(fixture) {
  if (!fixture) throw new Error('case 引用了不存在的模拟用户。');
  return {
    userId: fixture.userId,
    name: fixture.name,
    level: fixture.learnerProfile.levelLabel,
    summary: fixture.learnerProfile.summary,
    mastered: fixture.learnerProfile.mastered,
    weaknesses: fixture.learnerProfile.weaknesses,
  };
}

function deriveSeededDurableMemory(testCase, fixture, historyConcepts) {
  const count = fixture.usageProfile.durablePrivateMemoryCount;
  const needle = testCase.concept.toLowerCase();
  for (let index = 0; index < count; index += 1) {
    const concept = historyConcepts[index % historyConcepts.length];
    const phase = Math.floor(index / historyConcepts.length) + 1;
    const title = `稳定薄弱点：${concept.label} · 阶段 ${phase}`;
    const text = `多次作答与追问共同显示：${concept.gap}。下一教学动作：${concept.next}。`;
    if (`${title}\n${text}`.toLowerCase().includes(needle)) {
      return { title, text, seedIndex: index };
    }
  }
  return null;
}

async function gradeSubjectiveAttempts({ openai, modelId, testCase }) {
  const submitted = testCase.attempts.filter((attempt) => answerText(attempt).length > 0);
  if (submitted.length === 0) return { generated: null, attempts: [] };
  const gradingSchema = z.object({
    gradings: z
      .array(
        z.object({
          submissionIndex: z.number().int().min(0),
          score: z.number().min(0).max(testCase.points),
          feedback: z.string().trim().min(1).max(4_000),
        }),
      )
      .length(testCase.attempts.length),
  });
  const generated = await generateText({
    model: openai.chat(modelId),
    system: [
      '你是 CSC148 平台的严格判题器，只根据题目、参考答案和 rubric 给学生答案评分。',
      '不要读取或猜测测试预期，也不要生成学习记忆。',
      'score 必须在 0 与满分之间；feedback 要指出答案中真实出现的正确点与缺口。',
      '不要把 baseline、学生身份或总体能力带入评分。',
      '所有自然语言使用简体中文，代码标识符和课程术语可保留英文。',
    ].join('\n'),
    prompt: [
      '## 题目',
      JSON.stringify(
        {
          title: testCase.problemTitle,
          prompt: testCase.questionPrompt,
          questionType: testCase.questionType,
          points: testCase.points,
          referenceAnswer: testCase.referenceAnswer,
          rubric: testCase.rubric,
          analysis: testCase.analysis,
        },
        null,
        2,
      ),
      '## 待评分提交',
      JSON.stringify(
        testCase.attempts.map((attempt, index) => ({
          submissionIndex: index,
          answer: answerText(attempt),
          submissionContext: attempt.submissionContext || null,
        })),
        null,
        2,
      ),
    ].join('\n\n'),
    output: Output.object({ schema: gradingSchema }),
    maxOutputTokens: 5_000,
    maxRetries: 2,
  });
  if (!generated.output) throw new Error('主观题判题模型没有返回结构化结果。');
  const attempts = testCase.attempts.map((submission, index) => {
    const answer = answerText(submission);
    if (!answer) {
      return {
        id: stableAttemptId(testCase.id, index),
        status: 'ungraded',
        score: 0,
        maxScore: testCase.points,
        answer,
        feedback: '没有收到可判定的答案，平台未执行正误判断。',
        gradingSource: 'not_graded',
        gradingReliable: false,
      };
    }
    const rawGrading =
      generated.output.gradings.find((grading) => grading.submissionIndex === index) ||
      generated.output.gradings[index];
    const score = Math.max(0, Math.min(testCase.points, rawGrading?.score ?? 0));
    return {
      id: stableAttemptId(testCase.id, index),
      status: statusFromScore(score, testCase.points),
      score,
      maxScore: testCase.points,
      answer,
      feedback: rawGrading?.feedback || '评分模型未提供反馈。',
      gradingSource: 'platform_ai',
      gradingReliable: Boolean(rawGrading?.feedback),
    };
  });
  return {
    generated: {
      output: generated.output,
      usage: generated.usage,
    },
    attempts,
  };
}

async function diagnoseAttempt({
  openai,
  modelId,
  testCase,
  attempts,
  baseline,
  existingDurableMemory,
}) {
  const generated = await generateText({
    model: openai.chat(modelId),
    system: [
      '你是 CSC148 教学平台中负责把真实判题结果提炼成教学诊断的助手。',
      'Attempt 与评分结果是业务事实；你只解释证据支持的掌握、薄弱、原因与下一教学动作。',
      '禁止读取测试预期后反推诊断；禁止仅凭 baseline 虚构本轮掌握。',
      'masteredSignal 只写学生答案中确有证据的部分；没有就返回 null。',
      'stuckPoint 必须与学生答案、正确答案、rubric 或可信评分反馈的差异对应。',
      'cause 是对错误心智模型的谨慎解释；证据不足就返回 null，不能默认归因为粗心。',
      '一次通过只表示本轮通过，下一步应安排独立迁移复测。',
      'evidenceFromAttempt 必须逐字摘录学生答案或评分反馈中的短片段。',
      '如果没有提交答案或评分不可信，也必须返回结构化结果，但不得虚构掌握与薄弱。',
      '所有自然语言字段使用简体中文，课程术语和代码标识符可保留英文。',
    ].join('\n'),
    prompt: [
      '## 题目与评分合同',
      JSON.stringify(
        {
          id: stableProblemId(testCase.id),
          title: testCase.problemTitle,
          prompt: testCase.questionPrompt,
          questionType: testCase.questionType,
          concept: testCase.concept,
          points: testCase.points,
          referenceAnswer: testCase.referenceAnswer,
          rubric: testCase.rubric,
          analysis: testCase.analysis,
        },
        null,
        2,
      ),
      '## 已判定作答证据',
      JSON.stringify(attempts, null, 2),
      '## 既有学习状态（只能判断是否修订旧记忆，不能证明本轮能力）',
      JSON.stringify(
        {
          level: baseline.level,
          summary: baseline.summary,
          mastered: baseline.mastered,
          weaknesses: baseline.weaknesses,
          hasExistingDurableMemory: Boolean(existingDurableMemory),
          existingDurableMemory: existingDurableMemory
            ? `${existingDurableMemory.title}\n${existingDurableMemory.text}`
            : null,
        },
        null,
        2,
      ),
    ].join('\n\n'),
    output: Output.object({ schema: rawAttemptDiagnosisSchema }),
    maxOutputTokens: 5_000,
    maxRetries: 2,
  });
  if (!generated.output) throw new Error('做题诊断模型没有返回结构化结果。');
  return {
    output: generated.output,
    usage: generated.usage,
  };
}

async function answerAndDiagnoseQuestion({ openai, modelId, testCase, baseline, sourceContext }) {
  const schema = z.object({
    assistantReply: z.string().trim().min(1).max(8_000),
    diagnosis: rawQuestionDiagnosisSchema,
  });
  const generated = await generateText({
    model: openai.chat(modelId),
    system: [
      '你是 CSC148 教学平台中负责回答学生提问并提取学习诊断的助手。',
      '学生会说口语、粘贴题目、代码或 traceback；先真正回答，再给一个最小下一步。',
      '课程资料来自本地 queue 文件，不能编造资料中没有的老师要求。',
      '回答与诊断的自然语言使用简体中文，代码标识符和课程术语可保留英文。',
      '诊断不是保存聊天，而是提炼有证据的掌握、卡点、可能原因和下一教学动作。',
      '一次定义提问或只粘贴题目只能更新 working memory，不能证明长期薄弱。',
      '只有学生自己的代码、推理或错误信息提供明确、高置信能力证据时，才考虑长期记忆。',
      '“这块没懂”等消息若没有指代对象，先追问，两层 action 都设为 skip。',
      '课程外问题可给通用帮助，但不得写入 CSC148 学习记忆。',
      'masteredSignal 只能来自学生本轮消息；没有证据返回 null，baseline 不能证明本轮掌握。',
      'evidenceFromMessage 只逐字摘录学生消息中的短片段，不能改写或复制整段代码/题面。',
      '不要读取或猜测测试预期、expected 字段或 manual criteria。',
    ].join('\n'),
    prompt: [
      '## 模拟用户 baseline（仅作教学语气背景）',
      JSON.stringify(baseline, null, 2),
      '## 学生本轮原话',
      testCase.userMessage,
      '## 当前可用课程资料',
      testCase.sourceFilename
        ? `${testCase.sourceTitle} · ${testCase.sourceFilename}`
        : '无可确认的 CSC148 资料',
      sourceContext.prompt,
    ].join('\n\n'),
    output: Output.object({ schema }),
    maxOutputTokens: 8_000,
    maxRetries: 2,
  });
  if (!generated.output) throw new Error('提问回答模型没有返回结构化结果。');
  return {
    output: generated.output,
    usage: generated.usage,
  };
}

function machineCheck(id, label, expected, actual) {
  return {
    id,
    label,
    expected,
    actual,
    passed: isDeepStrictEqual(actual, expected),
  };
}

function expectedAttemptActions(testCase) {
  const mapping = {
    create_long_term: { workingMemoryAction: 'update', durableMemoryAction: 'create' },
    revise_long_term: { workingMemoryAction: 'update', durableMemoryAction: 'revise' },
    strengthen_long_term: {
      workingMemoryAction: 'update',
      durableMemoryAction: 'strengthen',
    },
    working_only: { workingMemoryAction: 'update', durableMemoryAction: 'skip' },
    no_memory: { workingMemoryAction: 'skip', durableMemoryAction: 'skip' },
  };
  return mapping[testCase.writeMode];
}

function attemptMachineChecks(testCase, diagnosis, attempts) {
  const expected = expectedAttemptActions(testCase);
  const corpus = attempts.map((attempt) => `${attempt.answer}\n${attempt.feedback}`).join('\n');
  const grounded = diagnosis.evidenceFromAttempt.every((excerpt) =>
    corpus
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .includes(excerpt.replace(/\s+/g, ' ').trim().toLowerCase()),
  );
  const hasReliableSubmission = attempts.some(
    (attempt) => attempt.gradingReliable && attempt.answer.trim().length > 0,
  );
  return [
    machineCheck(
      'expected-working-action',
      '短期动作符合 case 断言',
      expected.workingMemoryAction,
      diagnosis.workingMemoryAction,
    ),
    machineCheck(
      'expected-durable-action',
      '长期动作符合 case 断言',
      expected.durableMemoryAction,
      diagnosis.durableMemoryAction,
    ),
    machineCheck(
      'source-of-truth',
      '原始事实层保持 problem_attempt',
      'problem_attempt',
      diagnosis.layerRouting.sourceOfTruth,
    ),
    machineCheck(
      'short-term-routing',
      '短期路由与动作一致',
      diagnosis.workingMemoryAction === 'update' ? 'overwrite' : 'skip',
      diagnosis.layerRouting.shortTerm,
    ),
    machineCheck(
      'long-term-routing',
      '长期路由与动作一致',
      diagnosis.durableMemoryAction,
      diagnosis.layerRouting.longTerm,
    ),
    machineCheck(
      'knowledge-layers-read-only',
      '知识库和缓存保持只读',
      true,
      diagnosis.layerRouting.controlFacts === 'read_only' &&
        diagnosis.layerRouting.knowledgeBase === 'read_only' &&
        diagnosis.layerRouting.knowledgeCache === 'read_only',
    ),
    machineCheck('grounded-evidence', '证据摘录来自答案或评分反馈', true, grounded),
    machineCheck(
      'no-evidence-no-diagnosis',
      '无可靠提交时不生成掌握、卡点或原因',
      true,
      hasReliableSubmission ||
        (diagnosis.masteredSignal === null &&
          diagnosis.stuckPoint === null &&
          diagnosis.cause === null),
    ),
  ];
}

function questionMachineChecks(testCase, diagnosis, assistantReply) {
  const normalizedMessage = testCase.userMessage.replace(/\s+/g, ' ').trim().toLowerCase();
  const grounded = diagnosis.evidenceFromMessage.every((excerpt) =>
    normalizedMessage.includes(excerpt.replace(/\s+/g, ' ').trim().toLowerCase()),
  );
  const fullMessageCopied =
    diagnosis.evidenceFromMessage.some(
      (excerpt) =>
        excerpt.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedMessage &&
        normalizedMessage.length > 80,
    ) ||
    [
      diagnosis.masteredSignal,
      diagnosis.stuckPoint,
      diagnosis.cause,
      diagnosis.nextTeachingMove,
    ].some(
      (value) =>
        typeof value === 'string' &&
        value.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedMessage &&
        normalizedMessage.length > 80,
    );
  return [
    machineCheck(
      'expected-working-action',
      '短期动作符合 case 断言',
      testCase.expectedWorkingMemory,
      diagnosis.workingMemoryAction,
    ),
    machineCheck(
      'expected-durable-action',
      '长期动作符合 case 断言',
      testCase.expectedDurableMemory,
      diagnosis.durableMemoryAction,
    ),
    machineCheck(
      'source-of-truth',
      '原始事实层保持 conversation_message',
      'conversation_message',
      diagnosis.layerRouting.sourceOfTruth,
    ),
    machineCheck(
      'short-term-routing',
      '短期路由与动作一致',
      diagnosis.workingMemoryAction === 'update' ? 'overwrite' : 'skip',
      diagnosis.layerRouting.shortTerm,
    ),
    machineCheck(
      'long-term-routing',
      '长期路由与动作一致',
      diagnosis.durableMemoryAction,
      diagnosis.layerRouting.longTerm,
    ),
    machineCheck(
      'knowledge-layers-read-only',
      '知识库和缓存保持只读',
      true,
      diagnosis.layerRouting.controlFacts === 'read_only' &&
        diagnosis.layerRouting.knowledgeBase === 'read_only' &&
        diagnosis.layerRouting.knowledgeCache === 'read_only',
    ),
    machineCheck('grounded-evidence', '证据摘录逐字来自学生消息', true, grounded),
    machineCheck(
      'no-evidence-no-mastery',
      '没有学生证据时不生成掌握结论或原因',
      true,
      diagnosis.evidenceFromMessage.length > 0 ||
        (diagnosis.masteredSignal === null && diagnosis.cause === null),
    ),
    machineCheck('no-full-transcript-copy', '诊断没有整段转存长消息', false, fullMessageCopied),
    machineCheck(
      'assistant-reply-present',
      '先向学生提供可读回答',
      true,
      Boolean(compact(assistantReply)),
    ),
  ];
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function scenarioOutputDirectories(scenarioId) {
  const base = path.join(REPOSITORY_ROOT, 'tmp', 'platform-tests', 'memory-phase2', scenarioId);
  return {
    cliLatest: path.join(base, 'cli-latest'),
    cliRuns: path.join(base, 'cli-runs'),
    uiLatest: path.join(base, 'latest'),
    uiRuns: path.join(base, 'runs'),
  };
}

async function saveRecord(record, runTimestamp) {
  const directories = scenarioOutputDirectories(record.scenarioId);
  const timestamp = runTimestamp.replaceAll(':', '-');
  const uiRecord = {
    version: 1,
    scenarioId: record.scenarioId,
    caseId: record.caseId,
    recordedAt: record.recordedAt,
    result: {
      key: `${record.scenarioId}:${record.caseId}`,
      version: 1,
      scenarioId: record.scenarioId,
      caseId: record.caseId,
      fixtureUserId: record.result.case.fixtureUserId,
      updatedAt: Date.parse(record.recordedAt),
      mutation: null,
      cliRun: record.result,
    },
  };
  await Promise.all([
    writeJsonAtomic(path.join(directories.cliLatest, `${record.caseId}.json`), record),
    writeJsonAtomic(path.join(directories.cliRuns, `${timestamp}-${record.caseId}.json`), record),
    writeJsonAtomic(path.join(directories.uiLatest, `${record.caseId}.json`), uiRecord),
    writeJsonAtomic(path.join(directories.uiRuns, `${timestamp}-${record.caseId}.json`), uiRecord),
  ]);
}

function publicError(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error);
  const withoutKnownKey = apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message;
  return withoutKnownKey.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}

async function runProblemCase(context, testCase) {
  const fixture = context.fixtureById.get(testCase.fixtureUserId);
  const baseline = fixtureBaseline(fixture);
  const existingDurableMemory = deriveSeededDurableMemory(
    testCase,
    fixture,
    context.historyConcepts,
  );
  let grading;
  if (isObjectiveCase(testCase)) {
    grading = {
      generated: null,
      attempts: testCase.attempts.map((submission, index) =>
        objectiveAttempt(testCase, submission, index),
      ),
    };
  } else {
    grading = await gradeSubjectiveAttempts({
      openai: context.openai,
      modelId: context.modelId,
      testCase,
    });
    if (grading.attempts.length === 0) {
      grading.attempts = testCase.attempts.map((submission, index) => ({
        id: stableAttemptId(testCase.id, index),
        status: 'ungraded',
        score: 0,
        maxScore: testCase.points,
        answer: answerText(submission),
        feedback: '没有收到可判定的答案，平台未执行正误判断。',
        gradingSource: 'not_graded',
        gradingReliable: false,
      }));
    }
  }
  const rawDiagnosis = await diagnoseAttempt({
    openai: context.openai,
    modelId: context.modelId,
    testCase,
    attempts: grading.attempts,
    baseline,
    existingDurableMemory,
  });
  const diagnosis = context.normalizeAttemptMemoryDiagnosis({
    raw: rawDiagnosis.output,
    concept: testCase.concept,
    attempts: grading.attempts.map((attempt) => ({
      status: attempt.status,
      answer: attempt.answer,
      feedback: attempt.feedback,
      gradingSource: attempt.gradingSource,
      gradingReliable: attempt.gradingReliable,
    })),
    hasExistingDurableMemory: Boolean(existingDurableMemory),
  });
  const checks = attemptMachineChecks(testCase, diagnosis, grading.attempts);
  return {
    phase: '07',
    fixtureSource: {
      file: path.relative(REPOSITORY_ROOT, PROBLEM_CASES_PATH),
      exportName: 'LOCAL_PROBLEM_WRITEBACK_CASES',
      extraction: 'typescript-ast',
    },
    modelInputPolicy: {
      assertionFieldsWithheld: [
        'writeMode',
        'expectedMemoryChange',
        'masteredSignal',
        'stuckPoint',
        'cause',
        'nextTeachingMove',
      ],
      expectedUsedOnlyAfterNormalization: true,
    },
    case: {
      id: testCase.id,
      title: testCase.title,
      fixtureUserId: testCase.fixtureUserId,
      problemTitle: testCase.problemTitle,
      concept: testCase.concept,
      questionType: testCase.questionType,
    },
    inputEvidence: {
      problem: {
        id: stableProblemId(testCase.id),
        prompt: testCase.questionPrompt,
        referenceAnswer: testCase.referenceAnswer,
        rubric: testCase.rubric,
        points: testCase.points,
      },
      attempts: grading.attempts,
      baseline,
      existingDurableMemory,
    },
    rawModelOutput: {
      grading: grading.generated,
      diagnosis: rawDiagnosis,
    },
    actual: { diagnosis },
    expected: {
      ...expectedAttemptActions(testCase),
      writeMode: testCase.writeMode,
      expectedMemoryChange: testCase.expectedMemoryChange,
      assertionOnly: true,
    },
    machineChecks: checks,
    passed: checks.every((check) => check.passed),
  };
}

async function runQuestionCase(context, testCase) {
  const baseline = fixtureBaseline(context.fixtureById.get(testCase.fixtureUserId));
  const sourceContext = await questionSourceContext(testCase);
  const generated = await answerAndDiagnoseQuestion({
    openai: context.openai,
    modelId: context.modelId,
    testCase,
    baseline,
    sourceContext,
  });
  const diagnosis = context.normalizeQuestionMemoryDiagnosis({
    raw: generated.output.diagnosis,
    studentMessage: testCase.userMessage,
    hasCourseSource: Boolean(testCase.sourceFilename),
    resolvedConversationTopic: null,
  });
  const checks = questionMachineChecks(testCase, diagnosis, generated.output.assistantReply);
  return {
    phase: '08',
    fixtureSource: {
      file: path.relative(REPOSITORY_ROOT, QUESTION_CASES_PATH),
      exportName: 'CSC148_QUESTION_WRITEBACK_CASES',
      extraction: 'typescript-ast',
    },
    modelInputPolicy: {
      assertionFieldsWithheld: [
        'expectedWorkingMemory',
        'expectedDurableMemory',
        'expectedReason',
        'manualCriteria',
      ],
      expectedUsedOnlyAfterNormalization: true,
    },
    case: {
      id: testCase.id,
      title: testCase.title,
      fixtureUserId: testCase.fixtureUserId,
      messageKind: testCase.messageKind,
      sourceFilename: testCase.sourceFilename,
    },
    inputEvidence: {
      studentMessage: testCase.userMessage,
      baseline,
      source: {
        filename: testCase.sourceFilename,
        title: testCase.sourceTitle,
        matchedSections: sourceContext.sections.map((section) => section.title),
      },
    },
    rawModelOutput: generated,
    actual: {
      assistantReply: generated.output.assistantReply,
      diagnosis,
    },
    expected: {
      workingMemoryAction: testCase.expectedWorkingMemory,
      durableMemoryAction: testCase.expectedDurableMemory,
      reason: testCase.expectedReason,
      manualCriteria: testCase.manualCriteria,
      assertionOnly: true,
    },
    machineChecks: checks,
    passed: checks.every((check) => check.passed),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  loadLocalEnvironment();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY；请在进程环境、.env.local 或 .env 中设置。');
  }
  const modelId = normalizeModelId(process.env.DEFAULT_MODEL);
  const problemCases = extractLiteralExport(PROBLEM_CASES_PATH, 'LOCAL_PROBLEM_WRITEBACK_CASES');
  const questionCases = extractLiteralExport(
    QUESTION_CASES_PATH,
    'CSC148_QUESTION_WRITEBACK_CASES',
  );
  const fixtures = extractLiteralExport(PROBLEM_CASES_PATH, 'LOCAL_MEMORY_TEST_USER_FIXTURES');
  const historyConcepts = extractLiteralExport(PROBLEM_CASES_PATH, 'HISTORY_CONCEPTS');
  const normalizers = loadSharedNormalizers();
  const { openai, dispatcher, proxyEnabled } = buildOpenAIClient(apiKey);
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.userId, fixture]));
  let selected = [];
  if (options.scenario === 'all' || options.scenario === PROBLEM_SCENARIO) {
    selected.push(
      ...problemCases.map((testCase) => ({
        scenarioId: PROBLEM_SCENARIO,
        testCase,
      })),
    );
  }
  if (options.scenario === 'all' || options.scenario === QUESTION_SCENARIO) {
    selected.push(
      ...questionCases.map((testCase) => ({
        scenarioId: QUESTION_SCENARIO,
        testCase,
      })),
    );
  }
  if (options.caseId) {
    selected = selected.filter(({ testCase }) => testCase.id === options.caseId);
  }
  if (options.limit) selected = selected.slice(0, options.limit);
  if (selected.length === 0) throw new Error('筛选后没有可运行的 case。');

  const runTimestamp = new Date().toISOString();
  const context = {
    openai,
    modelId,
    fixtureById,
    historyConcepts,
    ...normalizers,
  };
  const records = [];
  console.log(
    `runner=${RUNNER_VERSION} model=openai:${modelId} cases=${selected.length} proxy=${
      proxyEnabled ? 'enabled' : 'disabled'
    }`,
  );
  try {
    for (const [index, item] of selected.entries()) {
      const { scenarioId, testCase } = item;
      console.log(`[${index + 1}/${selected.length}] ${scenarioId}/${testCase.id}`);
      const recordedAt = new Date().toISOString();
      let result;
      try {
        result =
          scenarioId === PROBLEM_SCENARIO
            ? await runProblemCase(context, testCase)
            : await runQuestionCase(context, testCase);
      } catch (error) {
        result = {
          phase: scenarioId === PROBLEM_SCENARIO ? '07' : '08',
          case: {
            id: testCase.id,
            title: testCase.title,
            fixtureUserId: testCase.fixtureUserId,
          },
          error: publicError(error, apiKey),
          machineChecks: [],
          passed: false,
        };
      }
      const record = {
        version: 1,
        runnerVersion: RUNNER_VERSION,
        scenarioId,
        caseId: testCase.id,
        recordedAt,
        model: `openai:${modelId}`,
        persistence: 'filesystem',
        result,
      };
      await saveRecord(record, runTimestamp);
      records.push(record);
      console.log(`  ${result.passed ? 'PASS' : 'FAIL'}`);
      if (result.error) console.log(`  error=${result.error}`);
    }
  } finally {
    await dispatcher?.close();
  }

  const summaries = new Map();
  for (const record of records) {
    const current = summaries.get(record.scenarioId) || {
      scenarioId: record.scenarioId,
      cases: 0,
      passed: 0,
      failed: 0,
      records: [],
    };
    current.cases += 1;
    current[record.result.passed ? 'passed' : 'failed'] += 1;
    current.records.push({
      caseId: record.caseId,
      passed: record.result.passed,
      recordedAt: record.recordedAt,
    });
    summaries.set(record.scenarioId, current);
  }
  for (const summary of summaries.values()) {
    const directories = scenarioOutputDirectories(summary.scenarioId);
    const value = {
      version: 1,
      runnerVersion: RUNNER_VERSION,
      runTimestamp,
      model: `openai:${modelId}`,
      ...summary,
    };
    await Promise.all([
      writeJsonAtomic(path.join(directories.cliLatest, '_summary.json'), value),
      writeJsonAtomic(
        path.join(directories.cliRuns, `${runTimestamp.replaceAll(':', '-')}-_summary.json`),
        value,
      ),
    ]);
  }

  const passed = records.filter((record) => record.result.passed).length;
  console.log(`完成：${passed}/${records.length} 通过；记录已写入 cli-latest 与 cli-runs。`);
  if (passed !== records.length) process.exitCode = 1;
}

main().catch((error) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || '';
  console.error(`runner 失败：${publicError(error, apiKey)}`);
  process.exitCode = 1;
});
