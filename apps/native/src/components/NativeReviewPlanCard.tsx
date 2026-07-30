import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileQuestion,
  History,
  Target,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';

import { getLocalRepository } from '../data/repository';
import type { LocalProblem } from '../domain/models';
import { reviewPlanEventId } from '../domain/learning-experiences';
import type {
  NativeReviewPlan,
  NativeReviewPlanCalendarItem,
  NativeReviewPlanTask,
  NativeTeachingEvidence,
} from '../domain/teaching';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';

type ProblemStatus = 'idle' | 'passed' | 'failed' | 'pending';

function progressStatus(value: string | undefined): ProblemStatus {
  if (value === 'passed') return 'passed';
  if (value === 'failed' || value === 'error' || value === 'partial') return 'failed';
  if (value === 'pending') return 'pending';
  return 'idle';
}

function statusLabel(status: ProblemStatus) {
  if (status === 'passed') {
    return { label: '已完成', className: 'native-review-problem-passed', Icon: CheckCircle2 };
  }
  if (status === 'failed') {
    return { label: '需重做', className: 'native-review-problem-failed', Icon: XCircle };
  }
  if (status === 'pending') {
    return { label: '待批改', className: 'native-review-problem-pending', Icon: Clock3 };
  }
  return { label: '未开始', className: '', Icon: Circle };
}

function dateParts(value?: string) {
  if (!value) return { label: '待安排', weekday: '' };
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { label: value, weekday: '' };
  return {
    label: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
  };
}

function evidenceIcon(sourceType: NativeTeachingEvidence['sourceType']) {
  if (sourceType === 'calendar' || sourceType === 'schedule') return CalendarDays;
  if (sourceType === 'problem_attempt' || sourceType === 'problem_bank') return History;
  return Brain;
}

function evidenceForTask(plan: NativeReviewPlan, task: NativeReviewPlanTask) {
  const evidenceById = new Map((plan.evidence ?? []).map((item) => [item.id, item]));
  return (task.evidenceIds ?? []).flatMap((id) => {
    const evidence = evidenceById.get(id);
    return evidence ? [evidence] : [];
  });
}

export function NativeReviewPlanCard({
  courseId,
  plan,
  problems,
  addedScheduleIds,
  statusRevision,
  onOpenProblem,
  onToggleCalendar,
}: {
  courseId: string;
  plan: NativeReviewPlan;
  problems: LocalProblem[];
  addedScheduleIds: Set<string>;
  statusRevision: number;
  onOpenProblem: (problemId: string, plan: NativeReviewPlan) => void;
  onToggleCalendar: (
    task: NativeReviewPlanTask,
    calendarItem: NativeReviewPlanCalendarItem | null,
    plan: NativeReviewPlan,
  ) => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [problemStatuses, setProblemStatuses] = useState<Record<string, ProblemStatus>>({});

  const problemById = useMemo(
    () => new Map(problems.map((problem) => [problem.id, problem])),
    [problems],
  );
  const planProblemIds = useMemo(
    () => [...new Set(plan.tasks.flatMap((task) => task.problemIds ?? []))],
    [plan.tasks],
  );
  const calendarByTaskId = useMemo(() => {
    const items = plan.calendarItems ?? [];
    return new Map(items.map((item) => [item.id ?? item.eventId ?? item.title, item]));
  }, [plan.calendarItems]);

  useEffect(() => {
    let alive = true;
    void getLocalRepository()
      .then((repository) => repository.listProblemProgress(courseId))
      .then((progress) => {
        if (!alive) return;
        const byProblemId = new Map(progress.map((item) => [item.problemId, item]));
        setProblemStatuses(
          Object.fromEntries(
            planProblemIds.map((problemId) => [
              problemId,
              progressStatus(byProblemId.get(problemId)?.status),
            ]),
          ),
        );
      })
      .catch(() => {
        if (alive) setProblemStatuses({});
      });
    return () => {
      alive = false;
    };
  }, [courseId, planProblemIds, statusRevision]);

  const completedCount = planProblemIds.filter(
    (problemId) => problemStatuses[problemId] === 'passed',
  ).length;
  const highlightedEvidence = (plan.evidence ?? []).slice(0, 3);
  const primaryEvidence =
    (plan.evidence ?? []).find((item) => item.sourceType === 'problem_attempt') ??
    plan.evidence?.[0] ??
    null;

  return (
    <>
      {highlightedEvidence.length ? (
        <div className="native-review-evidence-pills" aria-label="计划依据">
          {highlightedEvidence.map((evidence, index) => {
            const Icon = evidenceIcon(evidence.sourceType);
            return (
              <span key={evidence.id ?? `${evidence.sourceType}-${index}`}>
                <Icon size={12} />
                {evidence.title ?? evidence.excerpt ?? evidence.sourceType}
              </span>
            );
          })}
        </div>
      ) : null}

      {primaryEvidence ? (
        <button
          type="button"
          className="native-review-mistake-card"
          onClick={() => setEvidenceOpen(true)}
        >
          <span>
            <History size={15} />
          </span>
          <span>
            <strong>{primaryEvidence.title ?? '为什么这样安排？'}</strong>
            <small>
              {primaryEvidence.reason ?? primaryEvidence.excerpt ?? '查看这份计划引用的学习证据'}
            </small>
          </span>
          <ChevronRight size={15} />
        </button>
      ) : null}

      <section className="native-review-plan-card">
        <header>
          <div>
            <strong>{plan.title}</strong>
            <small>
              {plan.summary ??
                `${plan.estimatedMinutes ?? 0} 分钟 · ${planProblemIds.length} 道针对题`}
              {planProblemIds.length ? ` · 已完成 ${completedCount}/${planProblemIds.length}` : ''}
            </small>
          </div>
          <span>
            <Target size={14} />
            目标：{plan.learningGoal ?? plan.nextSteps?.[0] ?? '按证据完成复习'}
          </span>
        </header>

        <div className="native-review-day-list">
          {plan.tasks.map((task, taskIndex) => {
            const calendarItem =
              calendarByTaskId.get(task.id) ??
              (plan.calendarItems ?? []).find(
                (item) => item.date === task.date && item.title === task.title,
              ) ??
              null;
            const scheduleId = reviewPlanEventId(
              courseId,
              plan.id,
              task.id,
              calendarItem?.eventId ?? calendarItem?.id,
            );
            const added = addedScheduleIds.has(scheduleId);
            const date = dateParts(task.date ?? calendarItem?.date);
            const taskEvidence = evidenceForTask(plan, task);
            return (
              <article className="native-review-day" key={task.id}>
                <span className="native-review-day-index">{taskIndex + 1}</span>
                <div className="native-review-day-content">
                  <header>
                    <div>
                      <span>
                        {date.label}
                        {date.weekday ? ` · ${date.weekday}` : ''}
                      </span>
                      {task.minutes ? (
                        <small>
                          <Clock3 size={11} />
                          {task.minutes} 分钟
                        </small>
                      ) : null}
                    </div>
                    {(task.date ?? calendarItem?.date) ? (
                      <button
                        type="button"
                        className={added ? 'native-review-calendar-added' : undefined}
                        onClick={() => onToggleCalendar(task, calendarItem, plan)}
                      >
                        {added ? <Undo2 size={12} /> : <CalendarCheck2 size={12} />}
                        {added ? '撤销' : '添加到日历'}
                      </button>
                    ) : null}
                  </header>
                  <h3>{task.title}</h3>
                  <p>{task.reason ?? calendarItem?.reason ?? '完成后会根据真实作答更新计划。'}</p>

                  {taskEvidence.length || plan.rationale?.length ? (
                    <details>
                      <summary>
                        <Brain size={12} />
                        为什么这样安排
                        <span>展开依据</span>
                      </summary>
                      <ul>
                        {(taskEvidence.length
                          ? taskEvidence.map(
                              (evidence) =>
                                evidence.reason ?? evidence.excerpt ?? evidence.title ?? '学习证据',
                            )
                          : (plan.rationale ?? [])
                        ).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {task.problemIds?.length ? (
                    <div className="native-review-problem-list">
                      {task.problemIds.map((problemId, problemIndex) => {
                        const problem = problemById.get(problemId);
                        if (!problem) return null;
                        const status = problemStatuses[problemId] ?? 'idle';
                        const meta = statusLabel(status);
                        return (
                          <button
                            type="button"
                            key={problemId}
                            onClick={() => onOpenProblem(problemId, plan)}
                          >
                            <span className="native-review-problem-icon">
                              <FileQuestion size={14} />
                            </span>
                            <span>
                              <small>题目 {problemIndex + 1}</small>
                              <strong>{problem.title}</strong>
                            </span>
                            <span className={meta.className}>
                              <meta.Icon size={11} />
                              {meta.label}
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="native-review-no-new-problem">
                      <Check size={12} />
                      本任务不新增题目，按计划完成回顾即可
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <NativeWorkspaceDialog
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        title="计划证据"
        description="计划引用的具体日程、作答、资料与学习记忆。"
        className="native-review-evidence-dialog"
      >
        <header>
          <div>
            <span>教学决策 · 可追溯</span>
            <h2>计划证据</h2>
            <p>这些证据来自本机上下文或平台检索结果，不把推测写成事实。</p>
          </div>
          <button type="button" onClick={() => setEvidenceOpen(false)} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="native-review-evidence-body">
          {(plan.evidence ?? []).map((evidence, index) => (
            <section
              key={evidence.id ?? `${evidence.sourceType}-${index}`}
              className={
                evidence.sourceType === 'problem_attempt'
                  ? 'native-review-evidence-wrong'
                  : evidence.sourceType === 'memory'
                    ? 'native-review-evidence-memory'
                    : 'native-review-evidence-correct'
              }
            >
              <small>{evidence.title ?? evidence.sourceType}</small>
              <p>{evidence.excerpt ?? evidence.reason ?? '这条证据没有公开摘录。'}</p>
              {typeof evidence.confidence === 'number' ? (
                <span>置信度 {Math.round(evidence.confidence * 100)}%</span>
              ) : null}
            </section>
          ))}
          {plan.evidence?.length ? null : (
            <section>
              <small>暂无证据</small>
              <p>这份计划没有附带可展示的证据，因此不会把它标记成个性化结论。</p>
            </section>
          )}
        </div>
      </NativeWorkspaceDialog>
    </>
  );
}
