import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Search, UserRoundPlus, UsersRound, X } from 'lucide-react';
import {
  listAdminCourses,
  searchAdminAssignees,
  setAdminCourseAssignment,
  listAdminCourseStudents,
  removeAdminCourseStudent,
  downloadAdminCourseMaterials,
  type AdminCoursePage,
  type AdminCoursePerson,
  type AdminManagedCourse,
  type AdminCourseStudentPage,
} from '../data/platform-api-client';
import { nativeAccountAvatarUrl, resolveNativeCourseAvatar } from '../assets';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty } from './PhonePages';
import { useBackDismiss } from '../lib/use-back-dismiss';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '读取失败，请重试。';
}
function personName(person: AdminCoursePerson) {
  return person.name || person.email || person.id;
}

function PersonIdentity({ person, hint }: { person: AdminCoursePerson; hint?: string }) {
  return (
    <span className="ap-course-person">
      <img src={nativeAccountAvatarUrl(null, person.image)} alt="" />
      <span className="ap-course-person-copy">
        <strong>{personName(person)}</strong>
        <small>
          {person.email || '未设置邮箱'}
          {hint ? ` · ${hint}` : ''}
        </small>
      </span>
    </span>
  );
}

export function AdminCoursesTab() {
  const [filter, setFilter] = useState({ query: '', page: 1 });
  const [loaded, setLoaded] = useState<{
    filter: typeof filter;
    data: AdminCoursePage | null;
    error?: string;
  } | null>(null);
  const [opened, setOpened] = useState<{ courseId: string; kind: 'managers' | 'students' } | null>(
    null,
  );
  const searchRef = useRef<HTMLLabelElement>(null);
  const current = loaded?.filter === filter ? loaded : null;
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void listAdminCourses(filter.query, filter.page)
          .then((data) => {
            if (!cancelled) setLoaded({ filter, data });
          })
          .catch((error) => {
            if (!cancelled) setLoaded({ filter, data: null, error: errorText(error) });
          });
      },
      filter.query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter]);
  const changePage = (page: number) => {
    setOpened(null);
    setFilter({ ...filter, page });
    searchRef.current?.scrollIntoView({ block: 'start' });
  };
  return (
    <>
      <p className="phone-group-footer">
        按课程指定老师或管理员。分配只对这门课生效，原负责人保留。
      </p>
      <label className="phone-search ap-search" ref={searchRef}>
        <Search size={16} aria-hidden />
        <input
          type="search"
          placeholder="搜索课程名称或课号"
          value={filter.query}
          onChange={(event) => {
            setOpened(null);
            setFilter({ query: event.target.value, page: 1 });
          }}
        />
      </label>
      {!current ? <GlassSkeletonRows rows={5} height={74} /> : null}
      {current?.error ? (
        <div role="alert" className="phone-page-error">
          {current.error}
          <button type="button" onClick={() => setFilter({ ...filter })}>
            重新加载
          </button>
        </div>
      ) : null}
      {current?.data?.courses.length === 0 ? (
        <PhoneEmpty title="没有找到课程" hint="换个课程名称或课号试试。" />
      ) : null}
      {current?.data?.courses.length ? (
        <div className="phone-group ap-course-table">
          <div className="ap-course-table-head" aria-hidden="true">
            <span>课程</span>
            <span>负责人</span>
            <span>管理</span>
          </div>
          {current.data.courses.map((course) => (
            <ManagedCourseRow
              key={course.id}
              course={course}
              open={opened?.courseId === course.id ? opened.kind : null}
              onOpen={(kind) => setOpened({ courseId: course.id, kind })}
              onClose={() => setOpened(null)}
              onChanged={(next) =>
                setLoaded((value) =>
                  value?.data
                    ? {
                        ...value,
                        data: {
                          ...value.data,
                          courses: value.data.courses.map((row) =>
                            row.id === next.id ? next : row,
                          ),
                        },
                      }
                    : value,
                )
              }
            />
          ))}
        </div>
      ) : null}
      {current?.data ? (
        <nav className="ap-pagination" aria-label="课程分页">
          <span role="status">
            共 {current.data.total} 门 · 第 {current.data.page} /{' '}
            {Math.max(1, Math.ceil(current.data.total / current.data.pageSize))} 页
          </span>
          <div>
            <button
              type="button"
              disabled={current.data.page <= 1}
              onClick={() => changePage(current.data!.page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={current.data.page * current.data.pageSize >= current.data.total}
              onClick={() => changePage(current.data!.page + 1)}
            >
              下一页
            </button>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function ManagedCourseRow({
  course,
  open,
  onOpen,
  onClose,
  onChanged,
}: {
  course: AdminManagedCourse;
  open: 'managers' | 'students' | null;
  onOpen: (kind: 'managers' | 'students') => void;
  onClose: () => void;
  onChanged: (course: AdminManagedCourse) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    setDownloadMessage('');
    try {
      const result = await downloadAdminCourseMaterials(course.id);
      setDownloadMessage(
        result.path ? `已保存到 ${result.path}` : '资料已打包，请查看浏览器下载。',
      );
    } catch (error) {
      setDownloadError(errorText(error));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className={`ap-managed-course${open ? ' is-open' : ''}`}>
      <div className="ap-managed-course-row">
        <span className="ap-managed-course-title">
          <img
            className="ap-avatar"
            src={resolveNativeCourseAvatar(course.id, course.courseCode, course.avatarUrl)}
            alt=""
          />
          <span className="phone-row-copy">
            <strong>{course.courseCode || course.name}</strong>
            <small>{course.organizationName || '个人课程'}</small>
          </span>
        </span>
        <span className="ap-course-responsibles" role="group" aria-label="课程负责人">
          {course.responsiblePeople.length ? (
            course.responsiblePeople.map((person) => (
              <PersonIdentity key={person.id} person={person} />
            ))
          ) : (
            <small className="ap-course-no-owner">无负责人</small>
          )}
        </span>
        <div className="ap-course-row-actions">
          <button
            type="button"
            className="ap-course-assignment-action"
            aria-haspopup="dialog"
            aria-expanded={open === 'managers'}
            onClick={() => onOpen('managers')}
          >
            <UserRoundPlus size={15} aria-hidden />
            分配管理者
          </button>
          <button
            type="button"
            className="ap-course-assignment-action"
            aria-haspopup="dialog"
            aria-expanded={open === 'students'}
            onClick={() => onOpen('students')}
          >
            <UsersRound size={15} aria-hidden />
            学生管理
          </button>
          <button
            type="button"
            className="ap-course-assignment-action"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Download size={15} aria-hidden />
            {downloading ? '打包中…' : '下载资料'}
          </button>
        </div>
      </div>
      {downloadError ? (
        <p className="ap-course-download-error" role="alert">
          {downloadError}
        </p>
      ) : null}
      {downloadMessage ? (
        <p className="ap-course-download-message" role="status">
          {downloadMessage}
        </p>
      ) : null}
      {open === 'managers' ? (
        <CourseAssignmentDialog course={course} onChanged={onChanged} onClose={onClose} />
      ) : null}
      {open === 'students' ? <CourseStudentsDialog course={course} onClose={onClose} /> : null}
    </div>
  );
}

function CourseStudentsDialog({
  course,
  onClose,
}: {
  course: AdminManagedCourse;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState({ query: '', page: 1 });
  const [loaded, setLoaded] = useState<{
    filter: typeof filter;
    data?: AdminCourseStudentPage;
    error?: string;
  } | null>(null);
  const [pending, setPending] = useState<AdminCoursePerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const current = loaded?.filter === filter ? loaded : null;
  const dismiss = () => {
    if (busy) return;
    if (pending) setPending(null);
    else onClose();
  };
  useBackDismiss(true, dismiss, 60);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    searchRef.current?.focus();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void listAdminCourseStudents(course.id, filter.query, filter.page)
          .then((data) => {
            if (!cancelled) setLoaded({ filter, data });
          })
          .catch((error) => {
            if (!cancelled) setLoaded({ filter, error: errorText(error) });
          });
      },
      filter.query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [course.id, filter]);
  const remove = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setSaveError('');
    try {
      await removeAdminCourseStudent(course.id, pending.id);
      setNotice(`已将 ${personName(pending)} 移出这门课`);
      setPending(null);
      setFilter({ ...filter });
    } catch (error) {
      setSaveError(errorText(error));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ap-assignment-dialog"
      aria-labelledby="ap-students-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      }}
    >
      <header className="ap-assignment-head">
        <div>
          <h2 id="ap-students-title">学生管理</h2>
          <p>
            {course.courseCode || course.name} · {course.organizationName || '个人课程'}
          </p>
        </div>
        <button
          type="button"
          className="ap-icon-button"
          aria-label="关闭学生管理"
          disabled={busy}
          onClick={dismiss}
        >
          <X size={18} aria-hidden />
        </button>
      </header>
      <section className="ap-course-assignment" aria-label="课程学生">
        <div className="ap-section-heading">
          <h3>学生名单</h3>
          {current?.data ? (
            <span className="ap-section-caption">共 {current.data.total} 人</span>
          ) : null}
        </div>
        <label className="phone-search ap-search">
          <Search size={16} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder="搜索学生姓名或邮箱"
            value={filter.query}
            disabled={busy}
            onChange={(event) => setFilter({ query: event.target.value, page: 1 })}
          />
        </label>
        {saveError ? (
          <p className="phone-page-error" role="alert">
            {saveError}
          </p>
        ) : null}
        {notice ? (
          <p className="ap-panel-hint" role="status">
            {notice}
          </p>
        ) : null}
        {!current ? <GlassSkeletonRows rows={3} height={58} /> : null}
        {current?.error ? (
          <div className="phone-page-error" role="alert">
            {current.error}
            <button type="button" onClick={() => setFilter({ ...filter })}>
              重试
            </button>
          </div>
        ) : null}
        {current?.data?.students.length === 0 ? (
          <PhoneEmpty
            title={filter.query ? '没有匹配的学生' : '这门课还没有学生'}
            hint={filter.query ? '换个姓名或邮箱试试。' : '学生加入课程后会显示在这里。'}
          />
        ) : null}
        {current?.data?.students.length ? (
          <ul className="ap-assignee-list ap-course-students">
            {current.data.students.map((student) => (
              <li key={student.id}>
                <PersonIdentity person={student} />
                <button
                  type="button"
                  className="ap-remove-student"
                  disabled={busy}
                  aria-label={`移除学生 ${personName(student)}`}
                  onClick={() => {
                    setSaveError('');
                    setPending(student);
                  }}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {current?.data && current.data.total > current.data.pageSize ? (
          <nav className="ap-pagination" aria-label="学生分页">
            <span>
              第 {current.data.page} /{' '}
              {Math.max(1, Math.ceil(current.data.total / current.data.pageSize))} 页
            </span>
            <div>
              <button
                type="button"
                disabled={busy || current.data.page <= 1}
                onClick={() => setFilter({ ...filter, page: current.data!.page - 1 })}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={busy || current.data.page * current.data.pageSize >= current.data.total}
                onClick={() => setFilter({ ...filter, page: current.data!.page + 1 })}
              >
                下一页
              </button>
            </div>
          </nav>
        ) : null}
        {pending ? (
          <PhoneConfirm
            busy={busy}
            title="移除这位学生？"
            message={`将 ${personName(pending)} 移出 ${course.courseCode || course.name}，并撤销这门课的报名和班级成员关系。账号及历史学习记录会保留。`}
            confirmLabel="移除学生"
            destructive
            onConfirm={() => void remove()}
            onCancel={() => {
              if (!busy) setPending(null);
            }}
          />
        ) : null}
      </section>
    </dialog>,
    document.body,
  );
}

function CourseAssignmentDialog({
  course,
  onChanged,
  onClose,
}: {
  course: AdminManagedCourse;
  onChanged: (course: AdminManagedCourse) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminCoursePerson[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ person: AdminCoursePerson; assigned: boolean } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const dismiss = () => {
    if (busy) return;
    if (pending) setPending(null);
    else onClose();
  };
  useBackDismiss(true, dismiss, 60);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    searchInputRef.current?.focus();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void searchAdminAssignees(query)
          .then((rows) => {
            if (!cancelled) setUsers(rows);
          })
          .catch((cause) => {
            if (!cancelled) {
              setUsers([]);
              setError(errorText(cause));
            }
          });
      },
      query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, revision]);
  const save = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      onChanged(await setAdminCourseAssignment(course.id, pending.person.id, pending.assigned));
      setNotice(
        pending.assigned ? `已分配给 ${personName(pending.person)}` : '已取消这门课程的管理权限',
      );
      setPending(null);
    } catch (cause) {
      setError(errorText(cause));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ap-assignment-dialog"
      aria-labelledby="ap-assignment-title"
      aria-describedby="ap-assignment-course"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      }}
    >
      <header className="ap-assignment-head">
        <div>
          <h2 id="ap-assignment-title">分配管理者</h2>
          <p id="ap-assignment-course">
            {course.name} · {course.organizationName || '个人课程'}
          </p>
        </div>
        <button
          type="button"
          className="ap-icon-button"
          aria-label="关闭分配窗口"
          disabled={busy}
          onClick={dismiss}
        >
          <X size={18} aria-hidden />
        </button>
      </header>
      <section
        className="ap-course-assignment"
        aria-label={`${course.courseCode || course.name}的课程管理者`}
      >
        <div className="ap-section-heading">
          <h3>课程管理者</h3>
          <span className="ap-section-caption">仅限老师 / 管理员</span>
        </div>
        <p className="ap-panel-hint">分配后可在课程列表和教学页使用这门课。</p>
        {!course.owner.id.startsWith('system:') ? (
          <div className="ap-original-owner">
            <span className="ap-section-caption">原负责人</span>
            <PersonIdentity person={course.owner} />
          </div>
        ) : null}
        {course.managers.length ? (
          <ul className="ap-assigned-people">
            {course.managers.map((person) => (
              <li key={person.id}>
                <PersonIdentity
                  person={person}
                  hint={
                    !person.isActive || !['TEACHER', 'ADMIN'].includes(person.role)
                      ? '当前身份无管理权限'
                      : undefined
                  }
                />
                <button
                  type="button"
                  aria-label={`取消 ${personName(person)} 的课程管理权限`}
                  disabled={busy}
                  onClick={() => setPending({ person, assigned: false })}
                >
                  <X size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ap-panel-hint">
            {course.owner.id.startsWith('system:') ? '无负责人' : '尚未分配其他管理者。'}
          </p>
        )}
        <label className="phone-search ap-search">
          <Search size={16} aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="查找老师或管理员（姓名 / 邮箱）"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setUsers(null);
              setError('');
            }}
          />
        </label>
        {error ? (
          <div className="phone-page-error" role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                setError('');
                setUsers(null);
                setRevision((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : null}
        {notice ? (
          <p className="ap-panel-hint" role="status">
            {notice}
          </p>
        ) : null}
        {!users ? <GlassSkeletonRows rows={2} height={48} /> : null}
        {users ? (
          <ul className="ap-assignee-list">
            {users.map((person) => {
              const assigned =
                person.id === course.owner.id ||
                course.managers.some((manager) => manager.id === person.id);
              return (
                <li key={person.id}>
                  <PersonIdentity
                    person={person}
                    hint={person.role === 'ADMIN' ? '管理员' : '老师'}
                  />
                  <button
                    type="button"
                    disabled={busy || assigned}
                    onClick={() => setPending({ person, assigned: true })}
                  >
                    {assigned ? '已负责' : '分配'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {users?.length === 0 && !error ? (
          <p className="ap-panel-hint">没有匹配的老师或管理员。可先在「账号」中设置身份。</p>
        ) : null}
        {pending ? (
          <PhoneConfirm
            busy={busy}
            title={pending.assigned ? '分配课程管理权限？' : '取消课程管理权限？'}
            message={`${personName(pending.person)} ${pending.assigned ? '将可以管理' : '将不再通过此分配管理'} ${course.courseCode || course.name}。`}
            confirmLabel={pending.assigned ? '确认分配' : '取消权限'}
            destructive={!pending.assigned}
            onConfirm={() => {
              if (!busy) void save();
            }}
            onCancel={() => {
              if (!busy) setPending(null);
            }}
          />
        ) : null}
      </section>
    </dialog>,
    document.body,
  );
}
