'use client';

import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { BadgeCheck, ChevronRight, Search, Star, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useStoreStaging } from '@/components/courses/store-runtime';
import avatarThemeHues from '@/lib/constants/marble-avatar-theme-hues.json';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { enrollCourseFromStore, listCommunityStoreCourses } from '@/lib/utils/course-storage';
import type { CommunityCourseListItem, StoreOrganization } from '@/lib/utils/database';
import { toast } from '@/lib/notifications/client-toast';
import { cn } from '@/lib/utils';
import styles from './store.module.css';

/**
 * 课程商城（参照 App Store）：大标题、精选大卡、热门排行、按机构的横向货架。
 * 只放机构课程；「获取」= 加入（引用，不复制），之后变成「打开」。和 App 商城同一份数据。
 */

type Course = CommunityCourseListItem;

const MARBLE_PREFIX = '/avatars/marble-collection-v1/';
const SCENE_PREFIX = '/avatars/marble-backgrounds-v1/';

function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function marbleFor(course: Course): string {
  return resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl);
}

/** 弹珠头像对应的场景图（3:1）和色相；自定义头像没有场景。 */
function marbleArt(course: Course): { scene?: string; hue: number } {
  const url = marbleFor(course);
  if (url.startsWith(MARBLE_PREFIX)) {
    const filename = url.slice(MARBLE_PREFIX.length);
    const id = filename.replace(/\.webp$/, '') as keyof typeof avatarThemeHues;
    return { scene: SCENE_PREFIX + filename, hue: avatarThemeHues[id] ?? 220 };
  }
  return { hue: (hashId(course.id) * 47) % 360 };
}

function tintFor(course: Course): CSSProperties {
  const { hue } = marbleArt(course);
  return {
    '--st-from': `hsl(${hue} 85% 88%)`,
    '--st-to': `hsl(${(hue + 40) % 360} 90% 94%)`,
    '--st-accent': `hsl(${hue} 55% 34%)`,
  } as CSSProperties;
}

function titleOf(course: Course): string {
  return course.courseCode?.trim() || course.name;
}

function subtitleOf(course: Course): string {
  return course.courseCode?.trim() ? course.name : (course.organization?.name ?? '');
}

function popularity(course: Course): number {
  return (
    (course.averageRating ?? 0) * Math.min(course.reviewCount ?? 0, 20) * 2 +
    (course.notebookCount ?? 0) +
    (course.publishedProblemCount ?? 0) * 0.05
  );
}

function compactCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return String(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/** 获取后，课程弹珠缩小飞向左上角的课程列表。 */
function flyMarble(from: HTMLElement | null, src: string) {
  if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = from.getBoundingClientRect();
  const marble = document.createElement('img');
  marble.src = src;
  marble.alt = '';
  marble.className = styles.flyingMarble;
  Object.assign(marble.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.appendChild(marble);
  const dx = 36 - (rect.left + rect.width / 2);
  const dy = 120 - (rect.top + rect.height / 2);
  const animation = marble.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.3 - 70}px) scale(0.5)`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.14)`, opacity: 0.15 },
    ],
    { duration: 820, easing: 'cubic-bezier(.5,0,.2,1)' },
  );
  animation.onfinish = () => marble.remove();
}

type GetHandler = (course: Course, event: MouseEvent<HTMLButtonElement>) => void;

function GetButton({ course, busy, onGet }: { course: Course; busy: boolean; onGet: GetHandler }) {
  return (
    <button
      type="button"
      className={cn(styles.get, busy && styles.getBusy)}
      aria-label={course.purchased ? `打开${course.name}` : `获取${course.name}`}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onGet(course, event);
      }}
    >
      {busy ? <span className={styles.getRing} aria-hidden /> : course.purchased ? '打开' : '获取'}
    </button>
  );
}

function Rating({ course }: { course: Course }) {
  if (!course.averageRating) return null;
  return (
    <span className={styles.rating}>
      <Star size={11} strokeWidth={0} fill="currentColor" aria-hidden />
      {course.averageRating.toFixed(1)}
      {course.reviewCount ? <small>({compactCount(course.reviewCount)})</small> : null}
    </span>
  );
}

function FeatureCard({
  course,
  busy,
  onOpen,
  onGet,
}: {
  course: Course;
  busy: boolean;
  onOpen: (course: Course) => void;
  onGet: GetHandler;
}) {
  const { scene } = marbleArt(course);
  return (
    <article
      className={cn(styles.feature, scene && styles.featureScene)}
      style={{
        ...tintFor(course),
        ...(scene ? ({ '--st-scene': `url("${scene}")` } as CSSProperties) : {}),
      }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(course)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(course);
        }
      }}
    >
      <div className={styles.featureCopy}>
        <small>{course.organization?.name ?? '精选'}</small>
        <h3>{titleOf(course)}</h3>
        {course.description || course.courseCode ? (
          <p>{course.description || course.name}</p>
        ) : null}
      </div>
      {scene ? null : (
        <img className={styles.featureMarble} src={marbleFor(course)} alt="" aria-hidden />
      )}
      <div className={styles.featureBar} data-get-row>
        <img src={marbleFor(course)} alt="" aria-hidden data-fly />
        <span>
          <strong>{course.name}</strong>
          <small>
            {course.notebookCount ?? 0} 章
            {course.publishedProblemCount ? ` · ${course.publishedProblemCount} 题` : ''}
          </small>
        </span>
        <GetButton course={course} busy={busy} onGet={onGet} />
      </div>
    </article>
  );
}

function CourseRow({
  course,
  rank,
  busy,
  onOpen,
  onGet,
}: {
  course: Course;
  rank?: number;
  busy: boolean;
  onOpen: (course: Course) => void;
  onGet: GetHandler;
}) {
  return (
    <div
      className={styles.row}
      data-get-row
      role="button"
      tabIndex={0}
      onClick={() => onOpen(course)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(course);
        }
      }}
    >
      <img className={styles.rowMarble} src={marbleFor(course)} alt="" aria-hidden data-fly />
      {rank ? <b className={styles.rowRank}>{rank}</b> : null}
      <span className={styles.rowCopy}>
        <strong>{titleOf(course)}</strong>
        <small>{subtitleOf(course)}</small>
        <Rating course={course} />
      </span>
      <GetButton course={course} busy={busy} onGet={onGet} />
    </div>
  );
}

function CourseTile({ course, onOpen }: { course: Course; onOpen: (course: Course) => void }) {
  return (
    <button type="button" className={styles.tile} onClick={() => onOpen(course)}>
      <span className={styles.tileArt} style={tintFor(course)}>
        <img src={marbleFor(course)} alt="" aria-hidden />
        {course.purchased ? <i className={styles.tileJoined} aria-label="已获取" /> : null}
      </span>
      <strong>{titleOf(course)}</strong>
      <small>{subtitleOf(course)}</small>
    </button>
  );
}

function Shelf({
  title,
  icon,
  onSeeAll,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.shelf}>
      <header className={styles.shelfHead}>
        <h2>
          {title}
          {icon}
        </h2>
        {onSeeAll ? (
          <button type="button" onClick={onSeeAll}>
            全部
            <ChevronRight size={16} aria-hidden />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export default function CourseStorePage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const staging = useStoreStaging();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const load = useCallback(async () => {
    if (sessionStatus !== 'authenticated') return;
    setCourses(await listCommunityStoreCourses());
  }, [sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated') {
      router.replace(staging ? '/test' : '/login');
      return;
    }
    void load();
  }, [sessionStatus, staging, router, load]);

  const ranked = useMemo(
    () => [...(courses ?? [])].sort((a, b) => popularity(b) - popularity(a)),
    [courses],
  );

  const organizations = useMemo(() => {
    const groups = new Map<string, { organization: StoreOrganization; courses: Course[] }>();
    for (const course of ranked) {
      if (!course.organization) continue;
      const group = groups.get(course.organization.id) ?? {
        organization: course.organization,
        courses: [],
      };
      group.courses.push(course);
      groups.set(course.organization.id, group);
    }
    return [...groups.values()].sort((a, b) => b.courses.length - a.courses.length);
  }, [ranked]);

  const terms = deferredSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listMode = terms.length > 0 || orgFilter !== null;
  const listed = ranked.filter((course) => {
    if (orgFilter && course.organization?.id !== orgFilter) return false;
    const haystack = [
      course.name,
      course.courseCode,
      course.organization?.name,
      course.university,
      ...course.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const openCourse = useCallback(
    (course: Course) => router.push(`/store/courses/${encodeURIComponent(course.id)}`),
    [router],
  );

  const getCourse: GetHandler = async (course, event) => {
    if (course.purchased) {
      router.push(`${staging ? '/test/app' : '/learn'}?courseId=${encodeURIComponent(course.id)}`);
      return;
    }
    const marble =
      event.currentTarget.closest('[data-get-row]')?.querySelector<HTMLElement>('[data-fly]') ??
      null;
    setAddingId(course.id);
    try {
      await enrollCourseFromStore(course.id);
      flyMarble(marble, marbleFor(course));
      setCourses((current) =>
        (current ?? []).map((row) => (row.id === course.id ? { ...row, purchased: true } : row)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取失败');
    } finally {
      setAddingId(null);
    }
  };

  if (sessionStatus !== 'authenticated') return null;
  const orgName = orgFilter
    ? organizations.find((group) => group.organization.id === orgFilter)?.organization.name
    : null;

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.largeTitle}>
          <h1>{orgName ?? '商城'}</h1>
          <label className={styles.search}>
            <Search size={17} aria-hidden />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="课程、机构"
              type="search"
            />
            {searchQuery || orgFilter ? (
              <button
                type="button"
                aria-label="清除"
                onClick={() => {
                  setSearchQuery('');
                  setOrgFilter(null);
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        {courses === null ? (
          <div className={styles.skeleton} aria-busy />
        ) : !courses.length ? (
          <div className={styles.empty}>
            <span className={styles.emptyOrb} aria-hidden />
            <p>还没有机构课程</p>
          </div>
        ) : listMode ? (
          listed.length ? (
            <div className={styles.list}>
              {listed.map((course) => (
                <CourseRow
                  key={course.id}
                  course={course}
                  busy={addingId === course.id}
                  onOpen={openCourse}
                  onGet={getCourse}
                />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyOrb} aria-hidden />
              <p>没有匹配的课程</p>
            </div>
          )
        ) : (
          <>
            <div className={styles.features}>
              {ranked.slice(0, 5).map((course) => (
                <FeatureCard
                  key={course.id}
                  course={course}
                  busy={addingId === course.id}
                  onOpen={openCourse}
                  onGet={getCourse}
                />
              ))}
            </div>

            {ranked.length > 3 ? (
              <Shelf title="热门">
                <div className={styles.columns}>
                  {chunk(ranked.slice(0, 12), 3).map((column, columnIndex) => (
                    <div key={columnIndex} className={styles.column}>
                      {column.map((course, index) => (
                        <CourseRow
                          key={course.id}
                          course={course}
                          rank={columnIndex * 3 + index + 1}
                          busy={addingId === course.id}
                          onOpen={openCourse}
                          onGet={getCourse}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </Shelf>
            ) : null}

            {organizations.map(({ organization, courses: orgCourses }) => (
              <Shelf
                key={organization.id}
                title={organization.name}
                icon={
                  organization.verified ? (
                    <BadgeCheck
                      size={18}
                      strokeWidth={2}
                      className={styles.verified}
                      aria-label="已认证"
                    />
                  ) : null
                }
                onSeeAll={orgCourses.length > 2 ? () => setOrgFilter(organization.id) : undefined}
              >
                <div className={styles.tiles}>
                  {orgCourses.map((course) => (
                    <CourseTile key={course.id} course={course} onOpen={openCourse} />
                  ))}
                </div>
              </Shelf>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
