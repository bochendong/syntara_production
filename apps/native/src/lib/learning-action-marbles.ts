import blue from '../assets/marbles/r-blue-swirl.webp?url';
import purple from '../assets/marbles/r-purple-swirl.webp?url';
import pink from '../assets/marbles/r-pink-swirl.webp?url';
import green from '../assets/marbles/r-green-swirl.webp?url';
import amber from '../assets/marbles/r-amber-swirl.webp?url';
import type { NativeLearningActionKind } from '../domain/teaching';

export type MarbleColor = 'blue' | 'purple' | 'pink' | 'green' | 'amber';

export const marbleImages: Record<MarbleColor, string> = { blue, purple, pink, green, amber };

export const classroomMarble = blue;

export const learningActionMarbles: Record<NativeLearningActionKind, string> = {
  'calendar.propose_add': green,
  'calendar.propose_update': green,
  'calendar.propose_delete': green,
  'calendar.search': green,
  'calendar.start_recent': green,
  'memory.search': purple,
  'memory.propose_write': purple,
  'web.search': blue,
  'review_mode.request_choice': amber,
  'learner_progress.request_confirmation': amber,
  'practice.propose_generation': amber,
  'classroom.propose_temporary_explanation': blue,
  'image.propose_generation': pink,
};

/** 难度弹珠：基础绿、进阶琥珀、挑战粉（题库、做题、聊天表格徽章都用这一套）。 */
export const DIFFICULTY_MARBLES: Record<'easy' | 'medium' | 'hard', MarbleColor> = {
  easy: 'green',
  medium: 'amber',
  hard: 'pink',
};

/** 每种学习记忆一种颜色的弹珠，罐子里一眼能看出薄弱点多还是错题多。 */
const MEMORY_KIND_MARBLES: Record<string, { color: MarbleColor; label: string }> = {
  mistake: { color: 'pink', label: '错题' },
  knowledge_gap: { color: 'amber', label: '薄弱点' },
  preference: { color: 'blue', label: '偏好' },
  reflection: { color: 'green', label: '反思' },
};

const DEFAULT_MEMORY_MARBLE = { color: 'purple' as MarbleColor, label: '学习状态' };

export function memoryMarble(kind: string | null | undefined): {
  color: MarbleColor;
  label: string;
} {
  return (kind && MEMORY_KIND_MARBLES[kind]) || DEFAULT_MEMORY_MARBLE;
}

export const MEMORY_MARBLE_LEGEND: { color: MarbleColor; label: string }[] = [
  ...Object.values(MEMORY_KIND_MARBLES),
  DEFAULT_MEMORY_MARBLE,
];
