'use client';

import {
  applyNotebookChatDurableMemory,
  updateNotebookWorkingMemory,
  type NotebookWorkingMemory,
} from '@/lib/learning/study-memory';
import { addMemoryActivity, updateMemoryActivity } from '@/lib/store/memory-activity';
import type { NotebookProblemAttemptRecord } from '@/lib/problem-bank';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';
import type { NotebookPlanResult } from '@/lib/notebook/send-message';

function compact(value: string | null | undefined, maxChars: number) {
  const text = value?.replace(/\s+/g, ' ').trim() || '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function feedbackFromAttempt(attempt: NotebookProblemAttemptRecord) {
  return compact(
    [attempt.result?.feedback, attempt.result?.analysis]
      .map((item) => item?.trim())
      .filter(Boolean)
      .join(' '),
    600,
  );
}

function activityDoneDescription(memory: NotebookWorkingMemory) {
  return compact(
    [
      memory.masteredSignal ? `掌握：${memory.masteredSignal}` : '',
      memory.stuckPoint ? `薄弱：${memory.stuckPoint}` : '',
      memory.probableCause ? `原因：${memory.probableCause}` : '',
      memory.nextTeachingMove ? `下一步：${memory.nextTeachingMove}` : '',
    ]
      .filter(Boolean)
      .join('；') ||
      memory.summary ||
      '我更新了这次学习的掌握点、薄弱点和下一步帮助方式。',
    220,
  );
}

function queueWorkingMemoryWrite(args: {
  stageId: string;
  activityDescription: string;
  buildMemory: () => Omit<NotebookWorkingMemory, 'updatedAt'>;
}) {
  const activityId = addMemoryActivity({
    title: '我正在更新这次学习的短期记忆',
    description: args.activityDescription || '我会把这次互动里有用的学习状态整理出来。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['短期', '笔记本', '后台'],
  });

  window.setTimeout(() => {
    try {
      const { memory } = updateNotebookWorkingMemory({
        stageId: args.stageId,
        memory: args.buildMemory(),
      });
      updateMemoryActivity(activityId, {
        title: '我已经记住这次学习状态',
        description: activityDoneDescription(memory),
        status: 'completed',
        layer: 'study_memory',
        chips: ['短期', '已覆盖', memory.source === 'problem_attempt' ? '做题' : '聊天'],
      });
    } catch (error) {
      updateMemoryActivity(activityId, {
        title: '这次短期记忆没有更新成功',
        description: '我没有改动已有记忆，当前对话仍然可以继续。',
        status: 'failed',
        layer: 'study_memory',
        chips: ['短期', '失败'],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 0);
}

function queueDurableMemoryWrite(args: {
  notebookId: string;
  notebookName?: string | null;
  sourceMessageId: string;
  studentMessage: string;
  plan: NotebookPlanResult;
}) {
  const diagnosis = args.plan.memoryDiagnosis;
  if (!diagnosis || diagnosis.durableMemoryAction === 'skip') return;
  const activityId = addMemoryActivity({
    title: '我正在核对这条长期学习记忆',
    description: `我会按「${diagnosis.knowledgePoint}」稳定合并，不重复保存整段问答。`,
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['长期', '笔记本', diagnosis.durableMemoryAction],
  });

  window.setTimeout(() => {
    try {
      const serverWriteback = args.plan.durableMemoryWriteback;
      if (serverWriteback?.status === 'failed') {
        let pendingResult = applyNotebookChatDurableMemory({
          stageId: args.notebookId,
          notebookName: args.notebookName,
          sourceMessageId: args.sourceMessageId,
          studentMessage: args.studentMessage,
          knowledgePointKeyOverride: serverWriteback.knowledgePointKey,
          diagnosis,
          markPendingServerSync: true,
        });
        if (
          diagnosis.durableMemoryAction === 'revise' &&
          pendingResult.reason === 'missing_existing_for_revise'
        ) {
          pendingResult = applyNotebookChatDurableMemory({
            stageId: args.notebookId,
            notebookName: args.notebookName,
            sourceMessageId: args.sourceMessageId,
            studentMessage: args.studentMessage,
            knowledgePointKeyOverride: serverWriteback.knowledgePointKey,
            diagnosis: {
              ...diagnosis,
              durableMemoryAction: 'create',
              layerRouting: {
                ...diagnosis.layerRouting,
                longTerm: 'create',
              },
            },
            markPendingServerSync: true,
          });
        }
        updateMemoryActivity(activityId, {
          title: '长期记忆写回失败',
          description:
            pendingResult.outcome === 'skipped'
              ? `回答已经保留，但服务端长期记忆没有改动，且本地证据不足以排队重试（${serverWriteback.reason || 'unknown'}）。`
              : `回答已经保留；本条学习状态已进入本地待同步队列，下次笔记本请求会自动重试（${serverWriteback.reason || 'unknown'}）。`,
          status: 'failed',
          layer: 'study_memory',
          chips: [
            '长期',
            '服务端失败',
            pendingResult.outcome === 'skipped' ? '未排队' : '本地待同步',
          ],
          error: serverWriteback.reason || 'database_write_failed',
        });
        return;
      }
      if (serverWriteback?.status === 'skipped') {
        updateMemoryActivity(activityId, {
          title: '这轮没有改动长期记忆',
          description:
            serverWriteback.reason === 'missing_existing_for_revise'
              ? '模型建议修订，但服务端没有同知识点的既有长期记忆；为避免伪造，我保守跳过了。'
              : `服务端证据门槛未通过，已有长期记忆保持不变（${serverWriteback.reason || 'skipped'}）。`,
          status: 'completed',
          layer: 'study_memory',
          chips: ['长期', '服务端跳过'],
        });
        return;
      }

      const localFallback = !serverWriteback || serverWriteback.status === 'unavailable';
      let result = applyNotebookChatDurableMemory({
        stageId: args.notebookId,
        notebookName: args.notebookName,
        sourceMessageId: args.sourceMessageId,
        studentMessage: args.studentMessage,
        knowledgePointKeyOverride: serverWriteback?.knowledgePointKey,
        diagnosis,
        markPendingServerSync: localFallback,
      });
      const serverConfirmed =
        serverWriteback?.status === 'created' || serverWriteback?.status === 'updated';
      if (
        serverConfirmed &&
        diagnosis.durableMemoryAction === 'revise' &&
        result.reason === 'missing_existing_for_revise'
      ) {
        result = applyNotebookChatDurableMemory({
          stageId: args.notebookId,
          notebookName: args.notebookName,
          sourceMessageId: args.sourceMessageId,
          studentMessage: args.studentMessage,
          knowledgePointKeyOverride: serverWriteback?.knowledgePointKey,
          diagnosis: {
            ...diagnosis,
            durableMemoryAction: 'create',
            layerRouting: {
              ...diagnosis.layerRouting,
              longTerm: 'create',
            },
          },
          markPendingServerSync: false,
        });
      }
      if (result.outcome === 'skipped') {
        updateMemoryActivity(activityId, {
          title: '这轮没有改动长期记忆',
          description:
            result.reason === 'missing_existing_for_revise'
              ? '模型建议修订，但本地没有同知识点的既有长期记忆；为避免伪造，我保守跳过了。'
              : '这轮缺少可安全写入的稳定学习状态，已有长期记忆保持不变。',
          status: 'completed',
          layer: 'study_memory',
          chips: ['长期', '保守跳过'],
        });
        return;
      }
      updateMemoryActivity(activityId, {
        title: localFallback
          ? '已在本地保存长期学习记忆'
          : result.outcome === 'created'
            ? '已同步一条长期学习记忆'
            : '已同步更新长期学习记忆',
        description: activityDoneDescription({
          source: 'chat_turn',
          title: result.item?.title || '长期学习状态',
          summary: result.item?.text || '',
          masteredSignal: result.item?.learnerState?.masteredSignal,
          stuckPoint: result.item?.learnerState?.stuckPoint,
          probableCause: result.item?.learnerState?.cause,
          nextTeachingMove: result.item?.learnerState?.nextTeachingMove,
          updatedAt: result.item?.updatedAt || Date.now(),
        }),
        status: 'completed',
        layer: 'study_memory',
        chips: [
          '长期',
          localFallback ? '本地 fallback' : '服务端 + 本地投影',
          result.outcome === 'created' ? '新建' : '稳定合并',
        ],
      });
    } catch (error) {
      updateMemoryActivity(activityId, {
        title: '这次长期记忆没有更新成功',
        description: '我没有改动已有长期记忆，当前对话仍然可以继续。',
        status: 'failed',
        layer: 'study_memory',
        chips: ['长期', '失败'],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 0);
}

export function queueChatTurnWorkingMemoryUpdate(args: {
  notebookId: string;
  notebookName?: string | null;
  sourceMessageId: string;
  studentMessage: string;
  plan: NotebookPlanResult;
}) {
  const diagnosis = args.plan.memoryDiagnosis;
  if (!diagnosis) return;

  if (diagnosis.workingMemoryAction === 'update') {
    queueWorkingMemoryWrite({
      stageId: args.notebookId,
      activityDescription: '我会从这次提问里整理：你掌握了哪里、哪里还不稳、下一步怎么帮。',
      buildMemory: () => ({
        source: 'chat_turn',
        title: `短期学习状态：${diagnosis.knowledgePoint}`,
        summary: [
          diagnosis.masteredSignal ? `掌握：${diagnosis.masteredSignal}` : '',
          diagnosis.stuckPoint ? `薄弱：${diagnosis.stuckPoint}` : '',
          diagnosis.cause ? `原因：${diagnosis.cause}` : '',
          `下一步：${diagnosis.nextTeachingMove}`,
        ]
          .filter(Boolean)
          .join('\n'),
        currentTask: diagnosis.knowledgePoint,
        masteredSignal: diagnosis.masteredSignal || undefined,
        stuckPoint: diagnosis.stuckPoint || undefined,
        probableCause: diagnosis.cause || undefined,
        nextTeachingMove: diagnosis.nextTeachingMove,
        evidence: diagnosis.evidenceFromMessage.map((text, index) => ({
          type: 'student_message' as const,
          label: `学生证据 ${index + 1}`,
          text: compact(text, 320),
        })),
      }),
    });
  }

  queueDurableMemoryWrite({
    notebookId: args.notebookId,
    notebookName: args.notebookName,
    sourceMessageId: args.sourceMessageId,
    studentMessage: args.studentMessage,
    plan: args.plan,
  });
}

export function queueProblemAttemptWorkingMemoryUpdate(args: {
  notebookId: string;
  notebookName?: string | null;
  problem: Pick<NotebookProblemClientRecord, 'id' | 'title' | 'type' | 'tags' | 'points'>;
  attempt: NotebookProblemAttemptRecord;
}) {
  if (
    (args.attempt.kind !== 'answer' && args.attempt.kind !== 'submit') ||
    (args.attempt.status !== 'passed' &&
      args.attempt.status !== 'failed' &&
      args.attempt.status !== 'partial')
  ) {
    return;
  }
  const passed = args.attempt.status === 'passed';
  const feedback = feedbackFromAttempt(args.attempt);
  const scoreText =
    args.attempt.score != null ? `，得分 ${args.attempt.score}/${args.problem.points}` : '';

  queueWorkingMemoryWrite({
    stageId: args.notebookId,
    activityDescription: passed
      ? `我会记住你已经通过「${args.problem.title}」，之后可以给你更进一步的迁移题。`
      : `我会记住「${args.problem.title}」还没完全通过，下一步优先复盘这里。`,
    buildMemory: () => ({
      source: 'problem_attempt',
      title: '短期学习状态',
      summary: [
        `学生刚完成题目「${args.problem.title}」，结果：${args.attempt.status}${scoreText}。`,
        feedback ? `反馈：${feedback}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      currentTask: args.problem.title,
      stuckPoint: passed
        ? undefined
        : feedback || `题目「${args.problem.title}」尚未完全通过，需要下一轮复盘。`,
      masteredSignal: passed ? `题目「${args.problem.title}」已通过。` : undefined,
      nextTeachingMove: passed
        ? '下一轮可以给同知识点的迁移题，确认不是只记住了这一题。'
        : '下一轮先根据反馈定位错误步骤，再用一个更小的相似题检查修复情况。',
      recentAttempt: {
        problemId: args.problem.id,
        problemTitle: args.problem.title,
        status: args.attempt.status,
        score: args.attempt.score,
        feedback: feedback || undefined,
      },
      evidence: [
        {
          type: 'problem_attempt',
          label: '做题结果',
          text: `状态：${args.attempt.status}${scoreText}${feedback ? `；反馈：${feedback}` : ''}`,
        },
      ],
    }),
  });
}
