import { useEffect, useId, useRef, useState } from 'react';
import { GlassSpinner } from '../GlassLoadMore';

export function ProblemSolutionConfirmation({
  busy,
  error,
  onCancel,
  onConfirm,
  subject = '答案',
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (remember: boolean) => void;
  subject?: '答案' | '隐藏测试';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pp-solution-confirm"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>确定查看{subject}吗？</h2>
      <p id={descriptionId}>
        查看{subject}前，会保存你当前的作答和题目进度，并记录本题的求助情况，帮助 AI
        了解你卡在哪里。
      </p>
      <label className="pp-solution-remember">
        <input
          type="checkbox"
          checked={remember}
          disabled={busy}
          onChange={(event) => setRemember(event.target.checked)}
        />
        记住这次选择，下次不再提醒
      </label>
      {error ? (
        <p className="native-problem-practice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pp-solution-confirm-actions">
        <button type="button" className="pp-run-button" disabled={busy} onClick={onCancel}>
          继续作答
        </button>
        <button
          type="button"
          className="pp-submit"
          disabled={busy}
          onClick={() => onConfirm(remember)}
        >
          {busy ? <GlassSpinner size={14} /> : null}保存进度并查看{subject}
        </button>
      </div>
    </dialog>
  );
}
