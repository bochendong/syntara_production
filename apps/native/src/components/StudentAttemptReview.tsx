import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  getManagedStudentAttempt,
  getManagedStudentAttempts,
  type ManagedCourseStudent,
  type ManagedStudentAttempt,
  type ManagedStudentAttemptDetail,
  type ManagedStudentAttemptPage,
} from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import { useBackDismiss } from '../lib/use-back-dismiss';
import { AttemptDetail } from './problem-bank/attempt-history';

type Problem = NonNullable<ManagedCourseStudent['insights']>['problems'][number];
const STUDENT_ATTEMPT_LABELS = {
  passed: '通过',
  partial: '部分正确',
  failed: '未通过',
  error: '出错',
  pending: '待批改',
};
const marbles = {
  passed: marbleImages.green,
  partial: marbleImages.amber,
  failed: marbleImages.pink,
  error: marbleImages.pink,
  pending: marbleImages.blue,
};
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN');

export function StudentProblemAttempts({
  courseId,
  studentId,
  problem,
  ago,
}: {
  courseId: string;
  studentId: string;
  problem: Problem;
  ago: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<ManagedStudentAttemptPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ManagedStudentAttempt | null>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    let active = true;
    getManagedStudentAttempts(courseId, studentId, problem.id, page)
      .then((data) => {
        if (active) setHistory(data);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, studentId, problem.id, open, page, retry]);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) {
            setLoading(true);
            setError('');
          }
          setOpen(!open);
        }}
      >
        <img src={marbles[problem.status]} alt="" />
        <span className="csv-attempt-copy">
          <strong>{problem.title}</strong>
          <small>
            {[
              problem.chapterName,
              STUDENT_ATTEMPT_LABELS[problem.status],
              `尝试 ${problem.attemptCount} 次`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
        <time dateTime={problem.lastAttemptAt}>{ago(problem.lastAttemptAt)}</time>
        <ChevronDown
          size={16}
          className={open ? 'csv-chevron is-open' : 'csv-chevron'}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={id} className="csv-attempt-menu" aria-label={`${problem.title}的尝试记录`}>
          {loading ? (
            <p role="status" className="ccp-muted">
              正在读取做题记录…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="phone-page-error">
              {error}
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setLoading(true);
                  setRetry(retry + 1);
                }}
              >
                重试
              </button>
            </p>
          ) : null}
          {!loading && !error && history ? (
            <>
              {!history.attempts.length ? <p className="ccp-muted">没有做题记录。</p> : null}
              <ul>
                {history.attempts.map((attempt, index) => (
                  <li key={attempt.id}>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSelected(attempt)}
                    >
                      <img src={marbles[attempt.status]} alt="" />
                      <span className="csv-attempt-copy">
                        <strong>
                          第 {history.total - (history.page - 1) * history.pageSize - index} 次 ·{' '}
                          {STUDENT_ATTEMPT_LABELS[attempt.status]}
                        </strong>
                        <small>
                          {timestamp(attempt.createdAt)}
                          {attempt.score === null ? '' : ` · ${Math.round(attempt.score * 100)}%`}
                        </small>
                      </span>
                      <ChevronRight size={15} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {history && history.total > history.pageSize ? (
            <nav className="tcv-pager" aria-label="尝试记录分页">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setPage(page - 1);
                }}
              >
                上一页
              </button>
              <span>
                {page} / {Math.ceil(history.total / history.pageSize)}
              </span>
              <button
                type="button"
                disabled={loading || page * history.pageSize >= history.total}
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setPage(page + 1);
                }}
              >
                下一页
              </button>
            </nav>
          ) : null}
        </div>
      ) : null}
      {selected ? (
        <StudentAttemptPopup
          courseId={courseId}
          studentId={studentId}
          problem={problem}
          selected={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </li>
  );
}

function StudentAttemptPopup({
  courseId,
  studentId,
  problem,
  selected,
  onClose,
}: {
  courseId: string;
  studentId: string;
  problem: Problem;
  selected: ManagedStudentAttempt;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ManagedStudentAttemptDetail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const titleId = useId();
  useBackDismiss(true, onClose, 50);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let active = true;
    getManagedStudentAttempt(courseId, studentId, problem.id, selected.id)
      .then((data) => {
        if (active) setDetail(data.attempt);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取失败');
      });
    return () => {
      active = false;
    };
  }, [courseId, studentId, problem.id, selected.id, retry]);
  return createPortal(
    <dialog
      ref={dialog}
      className="csv-attempt-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <h2 id={titleId}>{problem.title}</h2>
          <p>
            {STUDENT_ATTEMPT_LABELS[selected.status]} · {timestamp(selected.createdAt)}
            {selected.score === null ? '' : ` · ${Math.round(selected.score * 100)}%`}
          </p>
        </div>
        <button type="button" aria-label="关闭做题记录" onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </header>
      <div className="csv-attempt-dialog-body">
        {error ? (
          <p role="alert" className="phone-page-error">
            {error}{' '}
            <button
              type="button"
              onClick={() => {
                setError('');
                setRetry(retry + 1);
              }}
            >
              重试
            </button>
          </p>
        ) : !detail ? (
          <p role="status" className="ccp-muted">
            正在读取这次提交…
          </p>
        ) : (
          <AttemptDetail attempt={detail} language={detail.language} answerLabel="学生提交" />
        )}
      </div>
    </dialog>,
    document.body,
  );
}
