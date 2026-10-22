import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import type { NativeChatRequest } from './schema';

/** 和 apps/native/src/domain/teaching.ts 的 NativeLearningAction 同形。 */
export interface NativeChatAction {
  id: string;
  kind:
    | 'calendar.propose_add'
    | 'calendar.propose_update'
    | 'calendar.propose_delete'
    | 'memory.propose_write'
    | 'practice.propose_generation';
  label: string;
  summary?: string;
  status: 'proposed';
  confirmation: 'required';
  payload: Record<string, unknown>;
}

export interface NativeChatProblemSelection {
  id: string;
  title: string;
  requestedCount: number;
  problems: Array<{
    problemId: string;
    title: string;
    reason: string;
    type?: string;
    difficulty?: string;
    tags?: string[];
    latestAttemptStatus?: string | null;
  }>;
}

/** 这一轮里模型提出的卡片，回答结束后一起放进消息 metadata。 */
export interface NativeChatProposals {
  actions: NativeChatAction[];
  classroom: { title: string; reason: string } | null;
  problemSelection: NativeChatProblemSelection | null;
}

const ACCEPTED = { ok: true, note: '已显示给学生确认。继续用文字回答即可。' };

export function createNativeChatTools(
  input: NativeChatRequest,
  proposals: NativeChatProposals,
): ToolSet {
  const nextId = () => `${input.requestId}:action:${proposals.actions.length + 1}`;
  const knownEventIds = new Set(input.context.calendar.map((event) => event.id));
  const problemsById = new Map(input.context.problems.map((problem) => [problem.id, problem]));
  const notesById = new Map(input.context.notes.map((note) => [note.id, note]));
  const memoriesById = new Map(input.context.memories.map((memory) => [memory.id, memory]));

  const tools: ToolSet = {
    remember: tool({
      description:
        '把一条学习结论记进这门课的学习记忆（一颗弹珠）。学生明说“记住…”时 explicit=true，直接保存；否则学生确认后保存。',
      inputSchema: z.object({
        kind: z
          .enum(['mistake', 'knowledge_gap', 'preference', 'reflection'])
          .describe(
            'mistake=做错的点, knowledge_gap=没掌握的知识, preference=学习偏好, reflection=学生自己的总结',
          ),
        title: z.string().min(1).max(40).describe('很短的标题'),
        text: z.string().min(1).max(300).describe('一两句话，以后复习时能看懂'),
        concepts: z
          .array(z.string().min(1).max(30))
          .max(3)
          .default([])
          .describe('1–3 个核心概念名，尽量沿用学习记忆里已有的概念写法，例如“链式法则”'),
        noteIds: z
          .array(z.string())
          .max(3)
          .default([])
          .describe('和这条记忆最相关的课程笔记片段 id（来自笔记列表）'),
        memoryId: z
          .string()
          .optional()
          .describe('同一个点以前已经记过时，填那条记忆的 id：合并进去而不是新增'),
        explicit: z.boolean().default(false).describe('学生自己明确要求记住'),
      }),
      execute: async ({ kind, title, text, concepts, noteIds, memoryId, explicit }) => {
        if (proposals.actions.some((action) => action.kind === 'memory.propose_write')) {
          return { ok: false, note: '这一轮已经提议过一条记忆了。' };
        }
        const existing = memoryId ? memoriesById.get(memoryId) : undefined;
        const notes = noteIds.flatMap((id) => notesById.get(id) ?? []);
        const sourceReferences = [
          ...new Set([
            ...notes.map((note) => `section:${note.id.split('#')[0]}`),
            ...concepts.map((concept) => `concept:${conceptKey(concept)}`),
          ]),
        ];
        proposals.actions.push({
          id: nextId(),
          kind: 'memory.propose_write',
          label: title,
          summary: text,
          status: 'proposed',
          confirmation: 'required',
          payload: {
            autoConfirm: explicit || undefined,
            memory: {
              ...(existing ? { id: existing.id } : {}),
              kind,
              title,
              text,
              scope: 'course',
              targetType: 'course',
              notebookId: notes.find((note) => note.notebookId)?.notebookId,
              sourceReferences,
              question: latestQuestion(input),
            },
          },
        });
        return ACCEPTED;
      },
    }),

    propose_calendar: tool({
      description: '提议在这门课的日历里新增、修改或删除一个事项（学生确认后执行）。',
      inputSchema: z.object({
        op: z.enum(['add', 'update', 'delete']),
        eventId: z.string().optional().describe('update/delete 时必填，用日历列表里的 id'),
        title: z.string().min(1).max(80),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('YYYY-MM-DD'),
        kind: z
          .enum(['assignment', 'exam', 'progress', 'tutorial', 'holiday', 'other'])
          .default('other'),
        note: z.string().max(200).optional(),
      }),
      execute: async ({ op, eventId, title, date, kind, note }) => {
        if (op !== 'add' && (!eventId || !knownEventIds.has(eventId))) {
          return { ok: false, note: '找不到这个日历事项 id，请用日历列表里的 id。' };
        }
        if (proposals.actions.filter((action) => action.kind.startsWith('calendar.')).length >= 6) {
          return { ok: false, note: '一次最多提议 6 个日历变更。' };
        }
        proposals.actions.push({
          id: nextId(),
          kind: `calendar.propose_${op}`,
          label: op === 'delete' ? `删除：${title}` : title,
          summary: `${date}${note ? ` · ${note}` : ''}`,
          status: 'proposed',
          confirmation: 'required',
          payload: {
            event: { ...(eventId ? { id: eventId } : {}), title, date, kind, note: note ?? '' },
          },
        });
        return ACCEPTED;
      },
    }),

    suggest_classroom: tool({
      description: '建议把这个内容做成一节带图和讲解的小课堂，学生点卡片后生成。',
      inputSchema: z.object({
        title: z.string().min(1).max(40),
        reason: z.string().max(120).describe('为什么课堂比文字更好，一句话'),
      }),
      execute: async ({ title, reason }) => {
        proposals.classroom = { title, reason };
        return ACCEPTED;
      },
    }),
  };

  // 手机端不提供题库：根本不给模型这个工具。
  if (input.surface !== 'phone' && problemsById.size) {
    tools.select_practice = tool({
      description: '从题库里挑几道真实题目给学生练，学生确认后打开。',
      inputSchema: z.object({
        problems: z
          .array(z.object({ id: z.string(), reason: z.string().max(80) }))
          .min(1)
          .max(8),
      }),
      execute: async ({ problems }) => {
        const picked = problems.flatMap(({ id, reason }) => {
          const problem = problemsById.get(id);
          return problem ? [{ problem, reason }] : [];
        });
        if (!picked.length) return { ok: false, note: '这些题号都不在题库里，只能用列表里的 id。' };
        proposals.problemSelection = {
          id: `${input.requestId}:practice`,
          title: '针对练习',
          requestedCount: problems.length,
          problems: picked.map(({ problem, reason }) => ({
            problemId: problem.id,
            title: problem.title,
            reason,
            type: problem.type,
            difficulty: problem.difficulty,
            tags: problem.tags,
            latestAttemptStatus: problem.status ?? null,
          })),
        };
        proposals.actions = proposals.actions.filter(
          (action) => action.kind !== 'practice.propose_generation',
        );
        proposals.actions.push({
          id: nextId(),
          kind: 'practice.propose_generation',
          label: `练 ${picked.length} 道题`,
          status: 'proposed',
          confirmation: 'required',
          payload: { problemIds: picked.map(({ problem }) => problem.id) },
        });
        return { ...ACCEPTED, selected: picked.length };
      },
    });
  }

  return tools;
}

/** 概念标签统一写法：去空白、小写，星图按完全相同的字符串连线。 */
export function conceptKey(concept: string): string {
  return concept.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

export function latestQuestion(input: NativeChatRequest): string {
  return input.messages.at(-1)?.role === 'user' ? (input.messages.at(-1)?.text.trim() ?? '') : '';
}
