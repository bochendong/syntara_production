import { useState } from 'react';
import type { NativeStoreCourse } from '../data/platform-api-contracts';
import { nativeStoreAction } from '../data/platform-api-client';
import { CourseModal } from './CourseModal';
import './course-join.css';

/** 侧边栏「待批准」的课：提交或改了重发申请后，通知它重新读。 */
export const COURSE_APPLICATIONS_CHANGED = 'syntara:course-applications-changed';

/** 机构课程的老师能看到学生在这门课的学情，加入时说一句。 */
export function CoursePrivacyNote() {
  return <p className="cp-privacy-note">老师可以看到你在这门课的做题和提问</p>;
}

/**
 * 申请加入需要老师同意的课；resend 时带上上次填的内容，改了再发（同一条申请，不会重复）。
 */
export function CourseJoinDialog({
  course,
  initialAnswers,
  resend,
  onClose,
  onSubmitted,
}: {
  course: Pick<NativeStoreCourse, 'id' | 'name' | 'admission'> & {
    organization?: { name: string } | null;
  };
  initialAnswers?: Record<string, string>;
  /** 上次申请的状态：待批准时是改了重发，未通过时是重新申请。 */
  resend?: 'pending' | 'rejected';
  onClose: () => void;
  onSubmitted: (status: 'joined' | 'pending') => Promise<void> | void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <CourseModal
      title={
        resend === 'pending' ? '修改申请' : resend === 'rejected' ? '重新申请' : '申请加入课程'
      }
      subtitle={course.name}
      busy={busy}
      onClose={onClose}
    >
      <p className="cp-muted">
        {resend === 'pending'
          ? '申请还在等老师同意。改好后重新发送，会替换上次填的内容。'
          : resend === 'rejected'
            ? '上次申请没有通过，可以改好后重新发送。'
            : '这门课加入需要老师同意。提交后等老师同意，就能进入课程。'}
      </p>
      {course.organization ? <CoursePrivacyNote /> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const result = await nativeStoreAction(course.id, 'join', answers);
            window.dispatchEvent(new Event(COURSE_APPLICATIONS_CHANGED));
            await onSubmitted(result.status ?? 'joined');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '提交失败');
            setBusy(false);
          }
        }}
      >
        <fieldset className="cp-form-fields" disabled={busy}>
          {(course.admission?.fields ?? []).map((field, index) => (
            <label key={field.id} className="cp-field">
              {field.label}
              <input
                autoFocus={index === 0}
                required
                inputMode={field.kind === 'phone_last4' ? 'numeric' : 'text'}
                pattern={field.kind === 'phone_last4' ? '[0-9]{4}' : undefined}
                maxLength={field.kind === 'phone_last4' ? 4 : 500}
                placeholder={field.kind === 'phone_last4' ? '请输入 4 位数字' : '请输入'}
                value={answers[field.id] ?? ''}
                onChange={(event) => setAnswers({ ...answers, [field.id]: event.target.value })}
              />
            </label>
          ))}
        </fieldset>
        {error ? (
          <p className="cp-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cp-form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="cp-primary" type="submit" disabled={busy}>
            {busy ? '正在提交…' : resend ? '重新发送' : '提交申请'}
          </button>
        </div>
      </form>
    </CourseModal>
  );
}
