import {
  Brain,
  CalendarPlus2,
  CheckCircle2,
  CircleHelp,
  FileQuestion,
  Globe2,
  Image,
  Presentation,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

import type { NativeLearningAction, NativeLearningActionKind } from '../domain/teaching';
import { learningActionMarbles } from '../lib/learning-action-marbles';
import { GlassSpinner } from './GlassLoadMore';

const ACTION_PRESENTATION: Record<
  NativeLearningActionKind,
  {
    verb: string;
    /** 手机上按钮只放两个字。 */
    short: string;
    Icon: typeof Sparkles;
  }
> = {
  'calendar.propose_add': { verb: '确认添加', short: '添加', Icon: CalendarPlus2 },
  'calendar.propose_update': { verb: '确认修改', short: '修改', Icon: CalendarPlus2 },
  'calendar.propose_delete': { verb: '确认删除', short: '删除', Icon: CalendarPlus2 },
  'calendar.search': { verb: '查看日历', short: '查看', Icon: Search },
  'calendar.start_recent': { verb: '查看最近安排', short: '查看', Icon: CalendarPlus2 },
  'memory.search': { verb: '查看记忆依据', short: '查看', Icon: Brain },
  'web.search': { verb: '查看检索依据', short: '查看', Icon: Globe2 },
  'review_mode.request_choice': { verb: '选择复习方式', short: '选择', Icon: CircleHelp },
  'learner_progress.request_confirmation': {
    verb: '确认学习状态',
    short: '确认',
    Icon: CheckCircle2,
  },
  'practice.propose_generation': { verb: '开始针对练习', short: '开始', Icon: FileQuestion },
  'classroom.propose_temporary_explanation': {
    verb: '生成课堂讲解',
    short: '生成',
    Icon: Presentation,
  },
  'image.propose_generation': { verb: '生成讲解图片', short: '生成', Icon: Image },
  'memory.propose_write': { verb: '确认写入记忆', short: '记住', Icon: Brain },
};

function actionState(action: NativeLearningAction, busy: boolean, compact: boolean) {
  if (busy)
    return {
      label: compact ? '' : '处理中…',
      Icon: GlassSpinner as unknown as typeof Sparkles,
      className: 'is-running',
    };
  if (action.status === 'completed') {
    return { label: compact ? '完成' : '已完成', Icon: CheckCircle2, className: 'is-completed' };
  }
  if (action.status === 'failed') {
    return { label: '重试', Icon: TriangleAlert, className: 'is-failed' };
  }
  return {
    label: compact ? ACTION_PRESENTATION[action.kind].short : ACTION_PRESENTATION[action.kind].verb,
    Icon: ACTION_PRESENTATION[action.kind].Icon,
    className: '',
  };
}

export function NativeLearningActions({
  actions,
  busyActionId = null,
  compact = false,
  onExecute,
}: {
  actions: NativeLearningAction[];
  busyActionId?: string | null;
  /** 手机：去掉说明文字，只留一行标题和一个短按钮。 */
  compact?: boolean;
  onExecute: (action: NativeLearningAction) => void;
}) {
  const visibleActions = actions.filter((action) => action.status !== 'cancelled');
  if (!visibleActions.length) return null;

  return (
    <section
      className={`native-learning-actions${compact ? ' is-compact' : ''}`}
      aria-label="助教建议的下一步"
    >
      {compact ? null : (
        <header>
          <span>
            <Sparkles size={12} />
            建议的下一步
          </span>
          <small>写入本机前会明确确认</small>
        </header>
      )}
      <div>
        {visibleActions.map((action) => {
          const busy = busyActionId === action.id;
          const state = actionState(action, busy, compact);
          const disabled = busy || action.status === 'completed';
          const PresentationIcon = ACTION_PRESENTATION[action.kind].Icon;
          return (
            <article key={action.id} data-learning-action-id={action.id}>
              <span className={`native-learning-action-icon${compact ? ' has-learning-mark' : ''}`}>
                {compact ? (
                  <img
                    src={learningActionMarbles[action.kind]}
                    alt=""
                    className="learning-confirmation-mark"
                  />
                ) : (
                  <PresentationIcon size={15} />
                )}
              </span>
              <span>
                <strong>{action.label}</strong>
                {compact ? null : (
                  <small>{action.summary ?? '由你决定是否执行，助教不会暗中修改本机数据。'}</small>
                )}
              </span>
              <button
                type="button"
                className={state.className}
                disabled={disabled}
                data-onboarding={
                  action.kind === 'memory.propose_write' && !disabled ? 'remember' : undefined
                }
                onClick={() => onExecute(action)}
              >
                {compact && !busy ? null : (
                  <state.Icon size={12} className={busy ? 'spin-icon' : undefined} />
                )}
                {state.label}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
