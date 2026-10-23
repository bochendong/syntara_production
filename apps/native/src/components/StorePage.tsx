import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Plus, Search } from 'lucide-react';
import { resolveNativeCourseAvatar } from '../assets';
import { listNativeStoreCourses, nativeStoreAction } from '../data/platform-api-client';
import type { NativeStoreCourse } from '../data/platform-api-contracts';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneEmpty, PhonePage } from './PhonePages';
import './store-page.css';

/**
 * App 商城：机构做好的课程，点「+」加入（引用，不复制），加入后出现在课程列表里。
 * 和网页 /store/courses 同一份数据。
 */
export function StorePage({
  onBack,
  onJoined,
  onOpenCourse,
}: {
  onBack: () => void;
  /** 加入后刷新课程列表，返回时课程已经在侧栏里。 */
  onJoined: (courseId: string) => Promise<void>;
  onOpenCourse: (courseId: string) => void;
}) {
  const [courses, setCourses] = useState<NativeStoreCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [organization, setOrganization] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [flying, setFlying] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listNativeStoreCourses()
      .then((next) => {
        if (!cancelled) setCourses(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const organizations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const course of courses ?? [])
      if (course.organization) seen.set(course.organization.id, course.organization.name);
    return [...seen];
  }, [courses]);

  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (courses ?? []).filter((course) => {
      if (organization && course.organization?.id !== organization) return false;
      const haystack = [course.name, course.courseCode, course.organization?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [courses, organization, query]);

  const join = async (course: NativeStoreCourse) => {
    if (course.joined) {
      onOpenCourse(course.id);
      return;
    }
    setJoining(course.id);
    setError(null);
    try {
      await nativeStoreAction(course.id, 'join');
      setFlying(course.id);
      setCourses((current) =>
        (current ?? []).map((item) => (item.id === course.id ? { ...item, joined: true } : item)),
      );
      await onJoined(course.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setJoining(null);
      window.setTimeout(() => setFlying((current) => (current === course.id ? null : current)), 900);
    }
  };

  return (
    <PhonePage title="商城" overlay onBack={onBack}>
      <label className="phone-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索课程或机构"
          type="search"
        />
      </label>

      {organizations.length > 1 ? (
        <div className="st-orgs" role="group" aria-label="机构">
          <button
            type="button"
            aria-pressed={organization === null}
            onClick={() => setOrganization(null)}
          >
            全部
          </button>
          {organizations.map(([id, name]) => (
            <button
              type="button"
              key={id}
              aria-pressed={organization === id}
              onClick={() => setOrganization((current) => (current === id ? null : id))}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="phone-page-error">
          {error}{' '}
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </p>
      ) : null}

      {courses === null && !error ? (
        <GlassSkeletonRows rows={4} height={72} />
      ) : visible.length ? (
        <div className="st-grid">
          {visible.map((course, index) => (
            <article
              key={course.id}
              className={`st-card${course.joined ? ' is-joined' : ''}${flying === course.id ? ' is-flying' : ''}`}
              style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
            >
              <img
                className="st-card-marble"
                src={resolveNativeCourseAvatar(course.id, course.courseCode)}
                alt=""
                aria-hidden
              />
              <span className="st-card-copy">
                <strong>{course.courseCode || course.name}</strong>
                {course.courseCode ? <small>{course.name}</small> : null}
                <span className="st-card-meta">
                  {course.organization ? (
                    <em>
                      {course.organization.name}
                      {course.organization.verified ? (
                        <BadgeCheck size={13} strokeWidth={2} aria-label="已认证" />
                      ) : null}
                    </em>
                  ) : null}
                  {course.notebookCount ? <small>{course.notebookCount} 本笔记</small> : null}
                </span>
              </span>
              <button
                type="button"
                className="st-card-add"
                aria-label={course.joined ? `打开${course.name}` : `加入${course.name}`}
                disabled={joining !== null}
                onClick={() => void join(course)}
              >
                {course.joined ? (
                  <Check size={17} strokeWidth={2.4} aria-hidden />
                ) : (
                  <Plus size={18} strokeWidth={2.2} aria-hidden />
                )}
              </button>
            </article>
          ))}
        </div>
      ) : courses !== null ? (
        <PhoneEmpty
          title={courses.length ? '没有匹配的课程' : '商城里还没有课程'}
          hint={courses.length ? '换个关键词再试。' : '机构上架课程后会出现在这里。'}
        />
      ) : null}
    </PhonePage>
  );
}
