import type { ProblemCoachMove } from '../../../../lib/problem-bank/problem-coach';

/**
 * 做题页「问 AI」交给课程主聊天的那道题：聊天输入框上方挂一张题目小卡，
 * 卡片挂着时每条消息都带上这道题（题面 + 学生当前作答，不含参考答案）。
 */
export type ProblemChatAttachment = {
  problemId: string;
  courseId: string;
  title: string;
  /** 发送时现读：做题页还开着（最小化）时拿到最新的草稿。 */
  readContext: () => string;
  /** 「完整解答」答完后记一次求助（和看参考答案一样）。 */
  onSolutionDelivered?: () => void;
};

export type ProblemChatRequest = {
  id: number;
  attachment: ProblemChatAttachment;
  /** ask = 只挂卡片、聚焦输入框；其它 = 立刻发出这条快捷提问。 */
  move: ProblemCoachMove;
};

/** 用户消息上方的题目小卡（存在消息 metadata 里，历史里也能看到）。 */
export type ProblemChatCard = { id: string; title: string };

export function problemChatCard(metadata: unknown): ProblemChatCard | null {
  const card = (metadata as { problemCard?: unknown } | undefined)?.problemCard;
  if (!card || typeof card !== 'object') return null;
  const { id, title } = card as Record<string, unknown>;
  return typeof id === 'string' && typeof title === 'string' ? { id, title } : null;
}
