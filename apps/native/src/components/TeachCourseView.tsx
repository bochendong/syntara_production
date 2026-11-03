import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Search, Send, Store, Upload, UserRoundPen } from 'lucide-react';
import { bundledMarbleAvatar, nativeAccountAvatarUrl, resolveNativeCourseAvatar } from '../assets';
import { CourseContentManager } from './CourseContentManager';
import { CourseAiRulesView } from './CourseAiRulesView';
import { CourseUploadSheet } from './CourseUploadSheet';
import { CourseStudentsView } from './CourseStudentsView';
import { CourseModal } from './CourseModal';
import {
  getCoursePublication,
  getCourseApplications,
  getManagedCourseContent,
  getManagedReleaseStatus,
  releaseNativeCourseVersion,
  reviewCourseApplication,
  type ManagedReleaseStatus,
  type CourseApplicationPage,
  type CoursePublication,
  type ManagedContentKind,
} from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import { PhonePage, PhoneEmpty } from './PhonePages';
import { CoursePublishDialog } from './CoursePublishDialog';
import { CourseProfileDialog } from './CourseProfileDialog';
import { GlassSkeletonRows } from './GlassLoadMore';
import './course-publication.css';
import './teach-course-view.css';

type Tab = ManagedContentKind | 'rules' | 'students' | 'applications';

/**
 * 「教学」里的单门课程管理：头部是课程、「发布更新」、「上传」和更多菜单（资料、商城）；
 * 下面分笔记、题库、学生、加入申请。开班和上课在「上课」页。
 */
export function TeachCourseView({
  courseId,
  onBack,
  onCourseChanged,
}: {
  courseId: string;
  onBack: () => void;
  onCourseChanged?: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>('notes');
  const [filter, setFilter] = useState({ query: '', page: 1 });
  const [loaded, setLoaded] = useState<{
    filter: typeof filter;
    publication?: CoursePublication;
    applications?: CourseApplicationPage;
    error?: string;
  } | null>(null);
  const [counts, setCounts] = useState<Partial<Record<ManagedContentKind, number>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [contentRevision, setContentRevision] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);
  const [release, setRelease] = useState<ManagedReleaseStatus | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  const loadRelease = useCallback(() => {
    void getManagedReleaseStatus(courseId)
      .then(setRelease)
      .catch(() => setRelease(null));
  }, [courseId]);
  useEffect(() => loadRelease(), [loadRelease]);
  const publishRelease = async () => {
    setReleasing(true);
    setReleaseError('');
    try {
      const result = await releaseNativeCourseVersion(courseId);
      setConfirmRelease(false);
      setNotice(`已发布第 ${result.version} 版。${result.text}`);
      loadRelease();
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : '发布失败');
    } finally {
      setReleasing(false);
    }
  };
  // 笔记或题目编辑到一半：切标签、返回前先确认。
  const [contentDirty, setContentDirty] = useState(false);
  const confirmLeave = () => {
    if (contentDirty && !window.confirm('有没保存的修改，确定放弃吗？')) return false;
    setContentDirty(false);
    return true;
  };
  const current = loaded?.filter === filter ? loaded : null;
  const publication = loaded?.publication;
  const pending = loaded?.applications?.total;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void Promise.all([
          getCoursePublication(courseId),
          getCourseApplications(courseId, filter.page, filter.query),
        ])
          .then(([publication, applications]) => {
            if (!cancelled) setLoaded({ filter, publication, applications });
          })
          .catch((cause) => {
            if (!cancelled)
              setLoaded({ filter, error: cause instanceof Error ? cause.message : '读取失败' });
          });
      },
      filter.query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [courseId, filter]);

  const loadCounts = useCallback(() => {
    for (const kind of ['notes', 'problems'] as const)
      void getManagedCourseContent(courseId, kind, 1, '')
        .then((page) => setCounts((previous) => ({ ...previous, [kind]: page.total })))
        .catch(() => {});
  }, [courseId]);
  useEffect(() => {
    if (publication?.canEditProfile) loadCounts();
  }, [publication?.canEditProfile, loadCounts]);

  const review = async (id: string, decision: 'approved' | 'rejected') => {
    if (busy) return;
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await reviewCourseApplication(courseId, id, decision);
      setNotice(
        decision === 'approved' ? '已同意加入课程，班级仍需另外加入。' : '已拒绝这条申请。',
      );
      setFilter({ ...filter });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '处理失败');
    } finally {
      setBusy(null);
    }
  };

  const canManageContent = Boolean(publication?.canEditProfile);
  const activeTab: Tab = canManageContent ? tab : 'applications';
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    ...(canManageContent
      ? [
          { id: 'notes' as const, label: '笔记', count: counts.notes },
          { id: 'problems' as const, label: '题库', count: counts.problems },
          { id: 'rules' as const, label: 'AI 规则' },
        ]
      : []),
    { id: 'students', label: '课程学生' },
    { id: 'applications', label: '加入申请', count: pending },
  ];
  const contentChanged = async () => {
    loadCounts();
    loadRelease();
    await onCourseChanged?.();
  };
  const approval = publication?.admission.mode === 'approval';

  return (
    <PhonePage
      title={publication?.name || '课程管理'}
      overlay
      largeTitle
      onBack={() => confirmLeave() && onBack()}
    >
      <div className="tp-page cp-management tcv-page">
        <header className="phone-large-head tp-head tcv-head">
          {publication ? (
            <img
              className="tcv-head-marble"
              src={
                bundledMarbleAvatar(publication.avatarUrl)?.url ||
                resolveNativeCourseAvatar(courseId, null)
              }
              alt=""
            />
          ) : null}
          <div className="tcv-head-copy">
            <h1>{publication?.name || '课程管理'}</h1>
            {publication ? (
              <span>
                {[publication.campus, publication.organizationName].filter(Boolean).join(' · ') ||
                  '无组织'}
                <i className={`tcv-store-chip${publication.listed ? ' is-listed' : ''}`}>
                  <img src={publication.listed ? marbleImages.green : marbleImages.amber} alt="" />
                  {publication.listed
                    ? approval
                      ? '已上架 · 加入需老师同意'
                      : '已上架 · 所有人可加入'
                    : '未上架'}
                </i>
              </span>
            ) : null}
          </div>
          {publication ? (
            <div className="tcv-head-actions">
              {release?.canRelease ? (
                <button
                  type="button"
                  className={release.total ? 'tcv-primary tcv-release' : 'tcv-ghost tcv-release'}
                  disabled={!release.total || contentDirty}
                  title={
                    contentDirty
                      ? '请先保存或放弃正在编辑的内容'
                      : release.total
                        ? '把已准备好的内容统一发布给学生'
                        : '当前没有需要记录的内容更新'
                  }
                  onClick={() => {
                    setReleaseError('');
                    setConfirmRelease(true);
                  }}
                >
                  {release.total ? (
                    <>
                      <Send size={15} aria-hidden />
                      发布内容更新 · {release.total}
                    </>
                  ) : (
                    '暂无更新'
                  )}
                </button>
              ) : null}
              {canManageContent ? (
                <button type="button" className="tcv-ghost" onClick={() => setUploading(true)}>
                  <Upload size={15} aria-hidden />
                  上传
                </button>
              ) : null}
              <div className="tcv-menu" ref={menuRef}>
                <button
                  type="button"
                  className="tcv-ghost tcv-icon-button"
                  aria-label="更多"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <MoreHorizontal size={18} aria-hidden />
                </button>
                {menuOpen ? (
                  <div className="tcv-menu-list" role="menu">
                    {publication.canEditProfile ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditingProfile(true);
                        }}
                      >
                        <UserRoundPen size={16} aria-hidden />
                        编辑课程资料
                      </button>
                    ) : null}
                    {publication.canPublish ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setPublishing(true);
                        }}
                      >
                        <Store size={16} aria-hidden />
                        {publication.listed ? '商城与加入设置' : '上架到商城'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </header>
        {notice && activeTab !== 'applications' ? (
          <p className="tcv-notice" role="status">
            {notice}
          </p>
        ) : null}

        {!loaded ? <GlassSkeletonRows rows={3} height={96} /> : null}
        {loaded?.error && !publication ? (
          <div className="phone-page-error" role="alert">
            {loaded.error}
            <button type="button" onClick={() => setFilter({ ...filter })}>
              重试
            </button>
          </div>
        ) : null}

        {publication ? (
          <div className="tcv-tabs" role="tablist" aria-label="课程管理">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={activeTab === item.id}
                onClick={() => item.id !== activeTab && confirmLeave() && setTab(item.id)}
              >
                {item.label}
                {item.count !== undefined ? (
                  <span
                    className={item.id === 'applications' && item.count > 0 ? 'is-pending' : ''}
                  >
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {publication && (activeTab === 'notes' || activeTab === 'problems') ? (
          <CourseContentManager
            key={activeTab}
            courseId={courseId}
            kind={activeTab}
            revision={contentRevision}
            onDirtyChange={setContentDirty}
            onChanged={contentChanged}
          />
        ) : null}

        {publication && activeTab === 'rules' ? (
          <CourseAiRulesView courseId={courseId} onDirtyChange={setContentDirty} />
        ) : null}

        {publication && activeTab === 'students' ? (
          <>
            <p className="cp-muted">这里显示已加入课程的学生；班级成员请在“上课”中管理。</p>
            <CourseStudentsView courseId={courseId} />
          </>
        ) : null}

        {publication && activeTab === 'applications' ? (
          <section className="tcv-panel" aria-label="加入申请">
            <label className="phone-search tcv-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                aria-label="搜索课程申请"
                placeholder="搜索姓名或邮箱"
                value={filter.query}
                onChange={(event) => setFilter({ query: event.target.value, page: 1 })}
              />
            </label>
            {!current ? <GlassSkeletonRows rows={3} height={88} /> : null}
            {current?.error ? (
              <div className="phone-page-error" role="alert">
                {current.error}
                <button type="button" onClick={() => setFilter({ ...filter })}>
                  重试
                </button>
              </div>
            ) : null}
            {error ? (
              <p className="phone-page-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="tcv-notice" role="status">
                {notice}
              </p>
            ) : null}
            {current?.applications?.applications.length === 0 ? (
              <PhoneEmpty
                title={filter.query ? '没有匹配的申请' : '暂无待同意的申请'}
                hint="学生在商城申请后会出现在这里。"
              />
            ) : null}
            {current?.applications?.applications.length ? (
              <div className="tcv-review-list">
                {current.applications.applications.map((application) => (
                  <article
                    className="tcv-review"
                    key={application.id}
                    aria-label={`${application.applicant.name || application.applicant.email}的加入申请`}
                  >
                    <img
                      className="tcv-review-avatar"
                      src={nativeAccountAvatarUrl(null, application.applicant.image)}
                      alt=""
                    />
                    <div className="tcv-review-person">
                      <strong>{application.applicant.name || '未命名学生'}</strong>
                      <small>
                        {application.applicant.email || '未设置邮箱'} ·{' '}
                        <time dateTime={application.createdAt}>
                          {new Date(application.createdAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </small>
                    </div>
                    <dl className="tcv-review-answers">
                      {application.answersJson.map((answer) => (
                        <div key={answer.id}>
                          <dt>{answer.label}</dt>
                          <dd>{answer.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="tcv-review-actions">
                      <button
                        type="button"
                        className="tcv-ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void review(application.id, 'rejected')}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className="tcv-primary"
                        disabled={Boolean(busy)}
                        onClick={() => void review(application.id, 'approved')}
                      >
                        {busy === application.id ? '处理中…' : '同意'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {current?.applications && current.applications.total > current.applications.pageSize ? (
              <nav className="tcv-pager" aria-label="申请分页">
                <button
                  type="button"
                  disabled={current.applications.page <= 1 || Boolean(busy)}
                  onClick={() => setFilter({ ...filter, page: current.applications!.page - 1 })}
                >
                  上一页
                </button>
                <span>
                  {current.applications.page} /{' '}
                  {Math.ceil(current.applications.total / current.applications.pageSize)}
                </span>
                <button
                  type="button"
                  disabled={
                    current.applications.page * current.applications.pageSize >=
                      current.applications.total || Boolean(busy)
                  }
                  onClick={() => setFilter({ ...filter, page: current.applications!.page + 1 })}
                >
                  下一页
                </button>
              </nav>
            ) : null}
          </section>
        ) : null}
      </div>
      {uploading ? (
        <CourseUploadSheet
          courseId={courseId}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setContentRevision((value) => value + 1);
            void contentChanged();
          }}
        />
      ) : null}
      {confirmRelease && release ? (
        <CourseModal title="发布内容更新" busy={releasing} onClose={() => setConfirmRelease(false)}>
          <div className="tcv-release-sheet">
            <p>发布后，新增、修改和待删除内容将统一对学生生效。草稿题目会继续保留在工作台。</p>
            <dl>
              {[
                ['新增笔记', release.addedNotebooks],
                ['改过的笔记', release.updatedNotebooks],
                ['新增题目', release.addedProblems],
                ['改过的题目', release.updatedProblems],
                ['待删除内容', release.deletions || 0],
              ].map(([label, count]) => (
                <div key={label} className={count ? '' : 'is-zero'}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            {release.changes?.length ? (
              <ul>
                {release.changes.map((change) => (
                  <li key={change.kind + change.id}>
                    {change.title} ·{' '}
                    {change.operation === 'delete'
                      ? '删除'
                      : change.draft
                        ? '草稿，本次不发布'
                        : '保存修改'}
                  </li>
                ))}
              </ul>
            ) : null}
            {releaseError ? (
              <p className="phone-page-error" role="alert">
                {releaseError}
              </p>
            ) : null}
            <div className="ccm-actions">
              <button
                type="button"
                className="ccm-ghost"
                disabled={releasing}
                onClick={() => setConfirmRelease(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="ccm-primary"
                disabled={releasing}
                onClick={() => void publishRelease()}
              >
                {releasing ? '发布中…' : `发布第 ${release.version + 1} 版`}
              </button>
            </div>
          </div>
        </CourseModal>
      ) : null}
      {publishing ? (
        <CoursePublishDialog
          courseId={courseId}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            setFilter({ ...filter });
          }}
        />
      ) : null}
      {editingProfile && publication ? (
        <CourseProfileDialog
          publication={publication}
          onClose={() => setEditingProfile(false)}
          onSaved={async (updated) => {
            setLoaded((previous) => (previous ? { ...previous, publication: updated } : previous));
            setEditingProfile(false);
            await onCourseChanged?.();
          }}
        />
      ) : null}
    </PhonePage>
  );
}
