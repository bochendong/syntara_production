import {
  Brain,
  CalendarPlus2,
  CheckCircle2,
  CircleHelp,
  FileQuestion,
  Globe2,
  Image,
  Loader2,
  Presentation,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

import type { NativeLearningAction, NativeLearningActionKind } from '../domain/teaching';

const ACTION_PRESENTATION: Record<
  NativeLearningActionKind,
  {
    verb: string;
    Icon: typeof Sparkles;
  }
> = {
  'calendar.propose_add': { verb: '确认添加', Icon: CalendarPlus2 },
  'calendar.propose_update': { verb: '确认修改', Icon: CalendarPlus2 },
  'calendar.propose_delete': { verb: '确认删除', Icon: CalendarPlus2 },
  'calendar.search': { verb: '查看日历', Icon: Search },
  'calendar.start_recent': { verb: '查看最近安排', Icon: CalendarPlus2 },
  'memory.search': { verb: '查看记忆依据', Icon: Brain },
  'web.search': { verb: '查看检索依据', Icon: Globe2 },
  'review_mode.request_choice': { verb: '选择复习方式', Icon: CircleHelp },
  'learner_progress.request_confirmation': { verb: '确认学习状态', Icon: CheckCircle2 },
  'practice.propose_generation': { verb: '开始针对练习', Icon: FileQuestion },
  'classroom.propose_temporary_explanation': { verb: '生成课堂讲解', Icon: Presentation },
  'image.propose_generation': { verb: '生成讲解图片', Icon: Image },
  'memory.propose_write': { verb: '确认写入记忆', Icon: Brain },
};

function actionState(action: NativeLearningAction, busy: boolean) {
  if (busy) return { label: '处理中…', Icon: Loader2, className: 'is-running' };
  if (action.status === 'completed') {
    return { label: '已完成', Icon: CheckCircle2, className: 'is-completed' };
  }
  if (action.status === 'failed') {
    return { label: '重试', Icon: TriangleAlert, className: 'is-failed' };
  }
  return {
    label: ACTION_PRESENTATION[action.kind].verb,
    Icon: ACTION_PRESENTATION[action.kind].Icon,
    className: '',
  };
}

export function NativeLearningActions({
  actions,
  busyActionId = null,
  onExecute,
}: {
  actions: NativeLearningAction[];
  busyActionId?: string | null;
  onExecute: (action: NativeLearningAction) => void;
}) {
  const visibleActions = actions.filter((action) => action.status !== 'cancelled');
  if (!visibleActions.length) return null;

  return (
    <section className="native-learning-actions" aria-label="助教建议的下一步">
      <header>
        <span>
          <Sparkles size={12} />
          建议的下一步
        </span>
        <small>写入本机前会明确确认</small>
      </header>
      <div>
        {visibleActions.map((action) => {
          const busy = busyActionId === action.id;
          const state = actionState(action, busy);
          const disabled = busy || action.status === 'completed';
          const PresentationIcon = ACTION_PRESENTATION[action.kind].Icon;
          return (
            <article key={action.id}>
              <span className="native-learning-action-icon">
                <PresentationIcon size={15} />
              </span>
              <span>
                <strong>{action.label}</strong>
                <small>{action.summary ?? '由你决定是否执行，助教不会暗中修改本机数据。'}</small>
              </span>
              <button
                type="button"
                className={state.className}
                disabled={disabled}
                onClick={() => onExecute(action)}
              >
                <state.Icon size={12} className={busy ? 'spin-icon' : undefined} />
                {state.label}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
