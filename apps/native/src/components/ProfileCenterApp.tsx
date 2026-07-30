import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, GraduationCap, Save, UserRound } from 'lucide-react';

import { COURSE_AVATAR_PRESETS, courseAvatarUrlById } from '../assets';
import {
  DEFAULT_LEARNER_PROFILE,
  readStoredLearnerProfile,
  writeStoredLearnerProfile,
  type LearnerProfile,
} from '../data/learner-profile';

type ProfileCenterAppProps = {
  courseCount: number;
  notebookCount: number;
  problemCount: number;
  conversationCount: number;
  onBack: () => void;
};

const AVATAR_PAGE_SIZE = 21;

export function ProfileCenterApp({
  courseCount,
  notebookCount,
  problemCount,
  conversationCount,
  onBack,
}: ProfileCenterAppProps) {
  const [profile, setProfile] = useState<LearnerProfile>(() => readStoredLearnerProfile());
  const [name, setName] = useState(profile.name);
  const [signature, setSignature] = useState(profile.signature);
  const [school, setSchool] = useState(profile.school);
  const [avatarId, setAvatarId] = useState<string | null>(profile.avatarId);
  const [avatarPage, setAvatarPage] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const stored = readStoredLearnerProfile();
    setProfile(stored);
    setName(stored.name);
    setSignature(stored.signature);
    setSchool(stored.school);
    setAvatarId(stored.avatarId);
  }, []);

  const avatarPageCount = Math.max(1, Math.ceil(COURSE_AVATAR_PRESETS.length / AVATAR_PAGE_SIZE));
  const avatarPresetsOnPage = useMemo(() => {
    const start = avatarPage * AVATAR_PAGE_SIZE;
    return COURSE_AVATAR_PRESETS.slice(start, start + AVATAR_PAGE_SIZE);
  }, [avatarPage]);

  const previewUrl = courseAvatarUrlById(avatarId) || '';

  const dirty =
    name.trim() !== profile.name ||
    signature.trim() !== profile.signature ||
    school.trim() !== profile.school ||
    avatarId !== profile.avatarId;

  const saveProfile = () => {
    const next = writeStoredLearnerProfile({
      avatarId,
      name: name.trim() || DEFAULT_LEARNER_PROFILE.name,
      signature,
      school,
    });
    setProfile(next);
    setName(next.name);
    setSignature(next.signature);
    setSchool(next.school);
    setAvatarId(next.avatarId);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <section className="native-learn-profile-app" aria-label="个人中心">
      <div className="native-learn-profile-shell">
        <aside className="native-learn-profile-aside">
          <button type="button" className="native-learn-calendar-back" onClick={onBack}>
            <ArrowLeft size={16} />
            返回主屏
          </button>

          <div className="native-learn-profile-hero">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="native-learn-profile-avatar" />
            ) : (
              <span className="native-learn-profile-avatar is-empty">
                <UserRound size={36} />
              </span>
            )}
            <strong>{name.trim() || DEFAULT_LEARNER_PROFILE.name}</strong>
            <small>{signature.trim() || '还没有个性签名'}</small>
            {school.trim() ? (
              <span className="native-learn-profile-school">
                <GraduationCap size={14} />
                {school.trim()}
              </span>
            ) : null}
          </div>

          <div className="native-learn-profile-stats">
            <span>
              <strong>{courseCount}</strong>
              <small>课程</small>
            </span>
            <span>
              <strong>{notebookCount}</strong>
              <small>笔记本</small>
            </span>
            <span>
              <strong>{problemCount}</strong>
              <small>题目</small>
            </span>
            <span>
              <strong>{conversationCount}</strong>
              <small>会话</small>
            </span>
          </div>
        </aside>

        <div className="native-learn-profile-main">
          <header className="native-learn-profile-toolbar">
            <div>
              <span>个人中心</span>
              <h1>编辑资料</h1>
            </div>
            <button
              type="button"
              className="native-learn-profile-save"
              onClick={saveProfile}
              disabled={!dirty && !savedFlash}
            >
              {savedFlash ? <Check size={15} /> : <Save size={15} />}
              {savedFlash ? '已保存' : '保存'}
            </button>
          </header>

          <div className="native-learn-profile-form">
            <label className="native-learn-profile-field">
              <span>名字</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你的显示名称"
                maxLength={40}
              />
            </label>

            <label className="native-learn-profile-field">
              <span>签名</span>
              <textarea
                rows={3}
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                placeholder="一句话介绍自己"
                maxLength={160}
              />
            </label>

            <label className="native-learn-profile-field">
              <span>学校</span>
              <input
                value={school}
                onChange={(event) => setSchool(event.target.value)}
                placeholder="例如：University of Toronto"
                maxLength={80}
              />
            </label>

            <div className="native-learn-profile-avatar-block">
              <div className="native-learn-profile-avatar-heading">
                <span>个人头像</span>
                <small>
                  {avatarPage + 1} / {avatarPageCount}
                </small>
              </div>
              <div className="native-learn-profile-avatar-grid">
                {avatarPresetsOnPage.map((preset) => {
                  const selected = avatarId === preset.id;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      className={`native-learn-profile-avatar-option${selected ? ' is-selected' : ''}`}
                      onClick={() => setAvatarId(preset.id)}
                      aria-label={`选择头像 ${preset.id}`}
                      aria-pressed={selected}
                    >
                      <img src={preset.url} alt="" draggable={false} />
                    </button>
                  );
                })}
              </div>
              <div className="native-learn-profile-avatar-pager">
                <button
                  type="button"
                  disabled={avatarPage <= 0}
                  onClick={() => setAvatarPage((value) => Math.max(0, value - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={avatarPage >= avatarPageCount - 1}
                  onClick={() =>
                    setAvatarPage((value) => Math.min(avatarPageCount - 1, value + 1))
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
