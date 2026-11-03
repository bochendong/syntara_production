import { useState } from 'react';
import {
  COURSE_AVATAR_PRESETS,
  bundledMarbleAvatar,
  resolveNativeCourseAvatar,
  writeStoredCourseAvatarId,
} from '../assets';
import { updateManagedCourseProfile, type CoursePublication } from '../data/platform-api-client';
import { CourseModal } from './CourseModal';

export function CourseProfileDialog({
  publication,
  onClose,
  onSaved,
}: {
  publication: CoursePublication;
  onClose: () => void;
  onSaved: (publication: CoursePublication) => Promise<void> | void;
}) {
  const [name, setName] = useState(publication.name);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const avatar =
    COURSE_AVATAR_PRESETS.find((item) => item.id === avatarId)?.url ||
    bundledMarbleAvatar(publication.avatarUrl)?.url ||
    resolveNativeCourseAvatar(publication.courseId, null);
  return (
    <CourseModal title="编辑课程资料" subtitle="修改课程名称和头像" busy={busy} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const updated = await updateManagedCourseProfile(publication.courseId, {
              name,
              avatarId,
            });
            if (avatarId) writeStoredCourseAvatarId(publication.courseId, null);
            await onSaved(updated);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '保存失败');
            setBusy(false);
          }
        }}
      >
        <fieldset className="cp-form-fields" disabled={busy}>
          <label className="cp-field">
            课程名称
            <input
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="cp-profile-preview">
            <img src={avatar} alt="" />
            <span>课程头像</span>
          </div>
          <div className="cp-avatar-grid" aria-label="选择课程头像">
            {COURSE_AVATAR_PRESETS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={avatarId === item.id ? 'is-selected' : ''}
                aria-label={`选择头像 ${item.name}`}
                aria-pressed={avatarId === item.id}
                onClick={() => setAvatarId(item.id)}
              >
                <img src={item.url} alt="" />
              </button>
            ))}
          </div>
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
          <button type="submit" className="cp-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存'}
          </button>
        </div>
      </form>
    </CourseModal>
  );
}
