import { classroomProblemDocument } from '../../data/classroom-practice-scope';
import { useEffect, useState } from 'react';

import { getLocalRepository } from '../../data/repository';
import type { LocalProblem, LocalProblemProgress } from '../../domain/models';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';

export type ProblemStatus = 'passed' | 'partial' | 'failed' | 'pending';

export function progressStatus(value: string | undefined | null): ProblemStatus | null {
  return value === 'passed' || value === 'partial' || value === 'failed' || value === 'pending'
    ? value
    : null;
}

/** 答题卡上的颜色：通过绿、错了粉、部分对琥珀、等批改蓝；没做是一颗空玻璃。 */
export const STATUS_MARBLES: Record<ProblemStatus, MarbleColor> = {
  passed: 'green',
  failed: 'pink',
  partial: 'amber',
  pending: 'blue',
};

export const STATUS_LABELS: Record<ProblemStatus, string> = {
  passed: '通过',
  failed: '错了',
  partial: '部分对',
  pending: '待批改',
};

const PROGRESS_EVENT = 'syntara:problem-progress';

export function notifyProblemProgress() {
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

/** 本机作答进度：每道题最新的状态。 */
export function useProblemStatuses(
  courseId: string,
  revision: unknown,
  classSessionId?: string,
  problemIds?: string[],
  preview?: { listProblemProgress: () => LocalProblemProgress[] } | null,
) {
  const [statuses, setStatuses] = useState(() => {
    const initial = new Map<string, ProblemStatus>();
    for (const item of preview?.listProblemProgress() ?? []) {
      const status = progressStatus(item.status);
      if (status) initial.set(item.problemId, status);
    }
    return initial;
  });
  const [mistakes, setMistakes] = useState<Set<string>>(() => new Set());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(PROGRESS_EVENT, bump);
    return () => window.removeEventListener(PROGRESS_EVENT, bump);
  }, []);
  useEffect(() => {
    if (preview) return;
    let alive = true;
    void getLocalRepository()
      .then(async (repository) => {
        if (!classSessionId) return repository.listProblemProgress(courseId);
        const documents = await Promise.all(
          (problemIds ?? []).map((id) => repository.loadProblemDocument(id)),
        );
        return documents.flatMap((document) => {
          const progress = classroomProblemDocument(document, classSessionId)?.progress;
          return progress ? [progress] : [];
        });
      })
      .then((progress) => {
        if (!alive) return;
        const next = new Map<string, ProblemStatus>();
        for (const item of progress) {
          const status = progressStatus(item.status);
          if (status) next.set(item.problemId, status);
        }
        setStatuses(next);
        setMistakes(
          new Set(
            progress.filter((item) => item.hasIncorrectAttempt).map((item) => item.problemId),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, revision, tick, classSessionId, problemIds, preview]);
  return [statuses, setStatuses, mistakes] as const;
}

const DIFFICULTY_TICKS: Record<LocalProblem['difficulty'], number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

/** 答题卡的一格：一颗写着题号的弹珠，难度是下面的一到三个小点。 */
export function SheetCell({
  number,
  status,
  difficulty,
  current = false,
  previouslyIncorrect = false,
  title,
  size = 'md',
  fresh = false,
  onClick,
}: {
  number: number | undefined;
  status: ProblemStatus | null | undefined;
  difficulty?: LocalProblem['difficulty'];
  current?: boolean;
  previouslyIncorrect?: boolean;
  title?: string;
  size?: 'sm' | 'md';
  /** 机构新发布的题：右上角一颗小蓝珠。 */
  fresh?: boolean;
  onClick: () => void;
}) {
  const recovered = status === 'passed' && previouslyIncorrect;
  const statusLabel = recovered
    ? '曾经做错过，现已通过'
    : status
      ? STATUS_LABELS[status]
      : '未作答';
  return (
    <button
      type="button"
      className={[
        'sheet-cell',
        `is-${size}`,
        status ? `is-${status}` : 'is-todo',
        current ? 'is-current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title ? `${title} · ${statusLabel}` : statusLabel}
      aria-label={`${number === undefined ? title || '我的题目' : `第 ${number} 题`}，${statusLabel}`}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="sheet-cell-orb">
        {status ? (
          <img src={marbleImages[recovered ? 'purple' : STATUS_MARBLES[status]]} alt="" />
        ) : null}
        <b>{number ?? '私'}</b>
        {fresh ? <img className="sheet-cell-new" src={marbleImages.blue} alt="新" /> : null}
      </span>
      {difficulty && size === 'md' ? (
        <span className="sheet-cell-ticks" aria-hidden>
          {Array.from({ length: DIFFICULTY_TICKS[difficulty] ?? 1 }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      ) : null}
    </button>
  );
}
