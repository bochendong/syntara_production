import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import {
  courseAnswerContractSchema,
  inferCourseAnswerContractConversationTask,
  renderCourseAnswerContractPrompt,
  resolveCourseAnswerContractReviewText,
  validateCourseAnswerContractWithContract,
  type CourseAnswerContract,
  type CourseAnswerContractTask,
  type CourseAnswerContractValidationResult,
  type CourseRuleEvaluatorKey,
  getCourseAnswerContract,
} from '@/features/memory/domain/course-answer-contract';
import type { SourceAnswerContract } from '@/features/memory/server/source-packet';
import type { StatelessChatRequest } from '@/lib/types/chat';

export type LoadedCourseRulePack = {
  id: string;
  ruleSetKey: string;
  evaluatorKey: CourseRuleEvaluatorKey;
  artifactKind: string;
  appliesTo: CourseAnswerContractTask[];
  contract: CourseAnswerContract;
};

function messageText(message: StatelessChatRequest['messages'][number]): string {
  return message.parts
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

export function courseRulePackHash(contract: CourseAnswerContract): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export async function loadApplicableCourseRulePacks(args: {
  prisma: PrismaClient;
  courseId: string;
  task: CourseAnswerContractTask;
}): Promise<LoadedCourseRulePack[]> {
  if (args.task === 'not_applicable') return [];
  const rows = await args.prisma.courseRulePack.findMany({
    where: {
      courseId: args.courseId,
      status: 'active',
      appliesTo: { has: args.task },
    },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
  });
  return rows.flatMap((row) => {
    const parsed = courseAnswerContractSchema.safeParse(row.contractJson);
    if (!parsed.success) return [];
    if (
      row.evaluatorKey !== 'python_function_contract' &&
      row.evaluatorKey !== 'python_class_contract' &&
      row.evaluatorKey !== 'prompt_contract'
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        ruleSetKey: row.ruleSetKey,
        evaluatorKey: row.evaluatorKey,
        artifactKind: row.artifactKind,
        appliesTo: row.appliesTo as CourseAnswerContractTask[],
        contract: parsed.data,
      },
    ];
  });
}

export async function loadCourseRuleContext(args: {
  prisma: PrismaClient;
  courseId: string;
  body: StatelessChatRequest;
}): Promise<{
  task: CourseAnswerContractTask;
  reviewText: string;
  packs: LoadedCourseRulePack[];
  prompt: string;
}> {
  const userMessages = args.body.messages
    .filter((message) => message.role === 'user')
    .map(messageText)
    .filter(Boolean);
  const task = inferCourseAnswerContractConversationTask(userMessages);
  const reviewText = resolveCourseAnswerContractReviewText(userMessages, task);
  const packs = await loadApplicableCourseRulePacks({
    prisma: args.prisma,
    courseId: args.courseId,
    task,
  });
  return {
    task,
    reviewText,
    packs,
    prompt: packs.map((pack) => renderCourseAnswerContractPrompt(pack.contract)).join('\n\n'),
  };
}

export function validateCourseRulePacks(args: {
  packs: LoadedCourseRulePack[];
  task: CourseAnswerContractTask;
  reviewText: string;
  answerText: string;
}): CourseAnswerContractValidationResult[] {
  return args.packs.map((pack) =>
    validateCourseAnswerContractWithContract({
      contract: pack.contract,
      evaluatorKey: pack.evaluatorKey,
      message: args.reviewText,
      answerText: args.answerText,
      taskHint: args.task,
    }),
  );
}

export function formatCourseRuleGuidance(results: CourseAnswerContractValidationResult[]): string {
  const failures = [
    ...new Map(
      results.flatMap((result) => result.failures).map((failure) => [failure.checkId, failure]),
    ).values(),
  ];
  if (failures.length === 0) return '';
  return [
    '本轮确定性课程规范检查发现以下必须覆盖的项目：',
    ...failures.map(
      (failure, index) =>
        `${index + 1}. ${failure.message}${failure.evidenceRefs.length ? `（依据：${failure.evidenceRefs.join('、')}）` : ''}`,
    ),
  ].join('\n');
}

export async function replaceCourseRulePack(args: {
  prisma: PrismaClient;
  courseId: string;
  ruleSetKey: string;
  evaluatorKey: CourseRuleEvaluatorKey;
  artifactKind: string;
  appliesTo: CourseAnswerContractTask[];
  contract: CourseAnswerContract;
  sourceRefs?: Prisma.InputJsonValue;
}) {
  const contentHash = courseRulePackHash(args.contract);
  return args.prisma.courseRulePack.upsert({
    where: { courseId_ruleSetKey: { courseId: args.courseId, ruleSetKey: args.ruleSetKey } },
    create: {
      courseId: args.courseId,
      ruleSetKey: args.ruleSetKey,
      evaluatorKey: args.evaluatorKey,
      artifactKind: args.artifactKind,
      appliesTo: args.appliesTo,
      version: args.contract.version,
      contractJson: args.contract,
      sourceRefs: args.sourceRefs,
      contentHash,
    },
    update: {
      evaluatorKey: args.evaluatorKey,
      artifactKind: args.artifactKind,
      appliesTo: args.appliesTo,
      version: args.contract.version,
      status: 'active',
      contractJson: args.contract,
      sourceRefs: args.sourceRefs,
      contentHash,
    },
  });
}

function sourceRuleEvaluator(contract: SourceAnswerContract): {
  evaluatorKey: CourseRuleEvaluatorKey;
  artifactKind: string;
} {
  const text = [
    contract.title,
    contract.summary,
    ...contract.rules.flatMap((rule) => [rule.rule, rule.when, rule.example]),
  ].join('\n');
  if (/docstring|doctest|type\s*(?:annotation|hint)|文档字符串|类型标注|类型注解/i.test(text)) {
    return { evaluatorKey: 'python_function_contract', artifactKind: 'python_function' };
  }
  if (/Representation Invariants?|BinarySearchTree|\bBST\b|表示不变量|二叉搜索树/i.test(text)) {
    return { evaluatorKey: 'python_class_contract', artifactKind: 'python_class' };
  }
  return { evaluatorKey: 'prompt_contract', artifactKind: 'written_answer' };
}

export function buildRulePackContractFromSource(args: {
  sourceHash: string;
  fallbackCourseCode: string;
  sourceTitle: string;
  sourceContract: SourceAnswerContract;
}): {
  evaluatorKey: CourseRuleEvaluatorKey;
  artifactKind: string;
  contract: CourseAnswerContract;
} {
  const evaluator = sourceRuleEvaluator(args.sourceContract);
  const base =
    evaluator.evaluatorKey === 'python_function_contract'
      ? getCourseAnswerContract('CSC108')
      : evaluator.evaluatorKey === 'python_class_contract'
        ? getCourseAnswerContract('CSC148')
        : null;
  const courseCode = args.sourceContract.courseCode || args.fallbackCourseCode;
  if (base) {
    return {
      ...evaluator,
      contract: {
        ...base,
        id: `source-answer-contract.${args.sourceHash.slice(0, 16)}`,
        courseCode,
        title: args.sourceContract.title,
        evidence: args.sourceContract.rules.map((rule, index) => ({
          id: `source.rule.${index + 1}`,
          sourcePath: `course-source:${args.sourceHash}`,
          sourceTitle: args.sourceTitle,
          sectionTitle: rule.evidence,
        })),
        checks: base.checks.map((check) => ({
          ...check,
          evidenceRefs: args.sourceContract.rules.length
            ? args.sourceContract.rules.map((_, index) => `source.rule.${index + 1}`)
            : check.evidenceRefs,
        })),
      },
    };
  }
  return {
    ...evaluator,
    contract: {
      version: 1,
      id: `source-answer-contract.${args.sourceHash.slice(0, 16)}`,
      courseCode,
      title: args.sourceContract.title,
      evidence: args.sourceContract.rules.map((rule, index) => ({
        id: `source.rule.${index + 1}`,
        sourcePath: `course-source:${args.sourceHash}`,
        sourceTitle: args.sourceTitle,
        sectionTitle: rule.evidence,
      })),
      checks: args.sourceContract.rules.map((rule, index) => ({
        id: `source.rule.${args.sourceHash.slice(0, 8)}.${index + 1}`,
        category:
          rule.category === 'proof_style'
            ? 'testing'
            : rule.category === 'forbidden_move'
              ? 'visible_override'
              : 'function_contract',
        severity: 'error',
        appliesTo: ['generation', 'code_review', 'grading'],
        rule: [rule.rule, rule.when ? `Applies when: ${rule.when}` : ''].filter(Boolean).join(' '),
        evidenceRefs: [`source.rule.${index + 1}`],
      })),
    },
  };
}
