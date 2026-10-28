import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { BadgeCheck, ChevronRight, Search, Star, X } from 'lucide-react';
import { storeCourseCode } from '../../../../lib/course-space/course-display-name';
import { bundledMarbleAvatar, resolveNativeCourseAvatar } from '../assets';
import {
  getNativeStoreCourse,
  listNativeStoreCourses,
  nativeStoreAction,
} from '../data/platform-api-client';
import type { NativeStoreCourse, NativeStoreCourseDetail } from '../data/platform-api-contracts';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneEmpty, PhonePage } from './PhonePages';
import {
  completeOnboardingStep,
  PLATFORM_TUTORIAL_COURSE_ID,
  onboardingStore,
} from '../lib/onboarding';
import { onboardingFeaturedCourses } from '../../../../lib/onboarding/store-featured';
import { groupStoreCoursesByCategory, storeCourseCategory } from '../lib/store-course-categories';
import './store-page.css';

/**
 * App 商城，参照 App Store：大标题、精选大卡、热门排行、按学科的横向货架、课程详情页。
 * 课程都是机构做好的，点「获取」只是加入（引用，不复制），之后变成「打开」。
 * 和网页 /store/courses 同一份数据。
 */

type JoinState = 'idle' | 'joining';

function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

/** 每门课一种柔和底色，跟着它的弹珠色相走（没有弹珠时按 id 取）。 */
function tintFor(course: Pick<NativeStoreCourse, 'id' | 'avatarUrl'>): CSSProperties {
  const hue = bundledMarbleAvatar(course.avatarUrl)?.hue ?? (hashId(course.id) * 47) % 360;
  return {
    '--st-from': `hsl(${hue} 85% 88%)`,
    '--st-to': `hsl(${(hue + 40) % 360} 90% 94%)`,
    '--st-accent': `hsl(${hue} 55% 34%)`,
  } as CSSProperties;
}

function marbleFor(course: Pick<NativeStoreCourse, 'id' | 'courseCode' | 'avatarUrl'>): string {
  return (
    bundledMarbleAvatar(course.avatarUrl)?.url ??
    resolveNativeCourseAvatar(course.id, course.courseCode)
  );
}

/** 商城课程名都带学校前缀，如 "UTM-CSC 108"。 */
function codeOf(course: NativeStoreCourse): string | null {
  return storeCourseCode({ ...course, organizationName: course.organization?.name });
}

function titleOf(course: NativeStoreCourse): string {
  return codeOf(course) || course.name;
}

function subtitleOf(course: NativeStoreCourse): string {
  return codeOf(course) ? course.name : (course.organization?.name ?? '');
}

/** 精选 / 热门的排序：评分、学习人数、内容量。 */
function popularity(course: NativeStoreCourse): number {
  return (
    course.averageRating * Math.min(course.reviewCount, 20) * 2 +
    course.learnerCount * 3 +
    course.notebookCount +
    course.problemCount * 0.05
  );
}

function compactCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return String(value);
}

/** 获取后，课程弹珠缩小飞向左上角（侧栏的课程列表）。 */
function flyMarble(from: HTMLElement | null, src: string) {
  if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = from.getBoundingClientRect();
  const marble = document.createElement('img');
  marble.src = src;
  marble.alt = '';
  marble.className = 'st-flying-marble';
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

function GetButton({
  course,
  state,
  size = 'sm',
  onGet,
}: {
  course: NativeStoreCourse;
  state: JoinState;
  size?: 'sm' | 'lg';
  onGet: (course: NativeStoreCourse, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const joining = state === 'joining';
  return (
    <button
      type="button"
      className={`st-get st-get-${size}${course.joined ? ' is-open' : ''}${joining ? ' is-busy' : ''}`}
      aria-label={course.joined ? `打开${course.name}` : `获取${course.name}`}
      data-onboarding={
        course.id === PLATFORM_TUTORIAL_COURSE_ID
          ? course.joined
            ? 'tutorial-open'
            : 'tutorial-get'
          : undefined
      }
      disabled={joining}
      onClick={(event) => {
        event.stopPropagation();
        onGet(course, event);
      }}
    >
      {joining ? <span className="st-get-ring" aria-hidden /> : course.joined ? '打开' : '获取'}
    </button>
  );
}

function Rating({ value, count }: { value: number; count?: number }) {
  if (!value) return null;
  return (
    <span className="st-rating" aria-label={`评分 ${value}`}>
      <Star size={11} strokeWidth={0} fill="currentColor" aria-hidden />
      {value.toFixed(1)}
      {count ? <small>({compactCount(count)})</small> : null}
    </span>
  );
}

/** 精选大卡：整张卡是课程的颜色，一颗大弹珠浮在右下。 */
function FeatureCard({
  course,
  state,
  onOpen,
  onGet,
}: {
  course: NativeStoreCourse;
  state: JoinState;
  onOpen: (course: NativeStoreCourse) => void;
  onGet: (course: NativeStoreCourse, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const scene = bundledMarbleAvatar(course.avatarUrl)?.sceneUrl;
  return (
    <article
      className={`st-feature${scene ? ' has-scene' : ''}`}
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
      <div className="st-feature-copy">
        <small>{course.organization?.name ?? '精选'}</small>
        <h3>{titleOf(course)}</h3>
        {course.description || course.courseCode ? (
          <p>{course.description || course.name}</p>
        ) : null}
      </div>
      {scene ? null : (
        <img className="st-feature-marble" src={marbleFor(course)} alt="" aria-hidden />
      )}
      <div className="st-feature-bar">
        <img src={marbleFor(course)} alt="" aria-hidden data-fly />
        <span>
          <strong>{course.name}</strong>
          <small>
            {course.notebookCount} 章{course.problemCount ? ` · ${course.problemCount} 题` : ''}
          </small>
        </span>
        <GetButton course={course} state={state} onGet={onGet} />
      </div>
    </article>
  );
}

/** App Store 式的一行：弹珠图标、名字、副标题、获取。 */
function CourseRow({
  course,
  rank,
  state,
  onOpen,
  onGet,
}: {
  course: NativeStoreCourse;
  rank?: number;
  state: JoinState;
  onOpen: (course: NativeStoreCourse) => void;
  onGet: (course: NativeStoreCourse, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className="st-row"
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
      <img className="st-row-marble" src={marbleFor(course)} alt="" aria-hidden data-fly />
      {rank ? <b className="st-row-rank">{rank}</b> : null}
      <span className="st-row-copy">
        <strong>{titleOf(course)}</strong>
        <small>{subtitleOf(course)}</small>
        <Rating value={course.averageRating} count={course.reviewCount} />
      </span>
      <GetButton course={course} state={state} onGet={onGet} />
    </div>
  );
}

/** 机构货架上的竖卡：彩色底上一颗弹珠。 */
function CourseTile({
  course,
  onOpen,
}: {
  course: NativeStoreCourse;
  onOpen: (course: NativeStoreCourse) => void;
}) {
  return (
    <button type="button" className="st-tile" onClick={() => onOpen(course)}>
      <span className="st-tile-art" style={tintFor(course)}>
        <img src={marbleFor(course)} alt="" aria-hidden />
        {course.joined ? <i className="st-tile-joined" aria-label="已获取" /> : null}
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
    <section className="st-shelf">
      <header className="st-shelf-head">
        <h2>
          {icon}
          {title}
        </h2>
        {onSeeAll ? (
          <button type="button" onClick={onSeeAll} aria-label={`查看全部${title}`}>
            全部
            <ChevronRight size={16} aria-hidden />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/** 课程详情：大图标 + 获取，信息条，章节，简介，评价。 */
function StoreDetail({
  course,
  state,
  onBack,
  onGet,
}: {
  course: NativeStoreCourse;
  state: JoinState;
  onBack: () => void;
  onGet: (course: NativeStoreCourse, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const [detail, setDetail] = useState<NativeStoreCourseDetail | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNativeStoreCourse(course.id)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [course.id]);

  const merged = { ...(detail ?? course), joined: course.joined } as NativeStoreCourseDetail;
  const scene = bundledMarbleAvatar(course.avatarUrl)?.sceneUrl;
  const facts = [
    merged.averageRating
      ? {
          label: `${compactCount(merged.reviewCount)} 个评分`,
          value: merged.averageRating.toFixed(1),
          stars: merged.averageRating,
        }
      : null,
    merged.learnerCount ? { label: '学习者', value: compactCount(merged.learnerCount) } : null,
    { label: '章节', value: String(merged.notebookCount) },
    merged.sceneCount ? { label: '课堂页', value: compactCount(merged.sceneCount) } : null,
    merged.problemCount ? { label: '题目', value: compactCount(merged.problemCount) } : null,
    merged.university ? { label: '学校', value: merged.university } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; stars?: number }>;

  return (
    <PhonePage title="" overlay onBack={onBack}>
      <div className="st-detail">
        {scene ? (
          <div
            className="st-detail-scene"
            style={{ backgroundImage: `url("${scene}")` }}
            aria-hidden
          />
        ) : null}
        <header className={`st-detail-head${scene ? ' has-scene' : ''}`}>
          <img className="st-detail-marble" src={marbleFor(course)} alt="" aria-hidden data-fly />
          <div className="st-detail-title">
            <h1>{titleOf(course)}</h1>
            {course.courseCode ? <p>{course.name}</p> : null}
            {course.organization ? (
              <span className="st-org">
                {course.organization.name}
                {course.organization.verified ? (
                  <BadgeCheck size={14} strokeWidth={2} aria-label="已认证" />
                ) : null}
              </span>
            ) : null}
            <GetButton course={course} state={state} size="lg" onGet={onGet} />
          </div>
        </header>

        <div className="st-facts" role="list">
          {facts.map((fact) => (
            <div key={fact.label} role="listitem">
              <small>{fact.label}</small>
              <strong>{fact.value}</strong>
              {fact.stars ? (
                <span className="st-stars" aria-hidden>
                  {'★★★★★'.slice(0, Math.round(fact.stars))}
                  <i>{'★★★★★'.slice(Math.round(fact.stars))}</i>
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {detail?.notebooks.length ? (
          <Shelf title="章节">
            <div className="st-chapters">
              {detail.notebooks.map((notebook, index) => (
                <div key={notebook.id} className="st-chapter" style={tintFor(course)}>
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <strong>{notebook.name}</strong>
                  <small>
                    {notebook.sceneCount ? `${notebook.sceneCount} 页` : ''}
                    {notebook.sceneCount && notebook.problemCount ? ' · ' : ''}
                    {notebook.problemCount ? `${notebook.problemCount} 题` : ''}
                  </small>
                </div>
              ))}
            </div>
          </Shelf>
        ) : !detail ? (
          <GlassSkeletonRows rows={1} height={120} />
        ) : null}

        {merged.description ? (
          <section className="st-about">
            <p className={expanded ? 'is-open' : undefined}>{merged.description}</p>
            {!expanded && merged.description.length > 90 ? (
              <button type="button" onClick={() => setExpanded(true)}>
                更多
              </button>
            ) : null}
          </section>
        ) : null}

        {detail?.reviews.length ? (
          <Shelf title="评分及评价">
            <div className="st-review-summary">
              <strong>{merged.averageRating.toFixed(1)}</strong>
              <small>满分 5 分 · {compactCount(merged.reviewCount)} 个评分</small>
            </div>
            <div className="st-reviews">
              {detail.reviews.map((review) => (
                <article key={review.id} className="st-review">
                  <span className="st-stars" aria-label={`${review.rating} 星`}>
                    {'★★★★★'.slice(0, review.rating)}
                    <i>{'★★★★★'.slice(review.rating)}</i>
                  </span>
                  <p>{review.comment || '—'}</p>
                  <small>{review.reviewerName}</small>
                </article>
              ))}
            </div>
          </Shelf>
        ) : null}
      </div>
    </PhonePage>
  );
}

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
  const [category, setCategory] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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

  const all = useMemo(() => courses ?? [], [courses]);
  const ranked = useMemo(() => [...all].sort((a, b) => popularity(b) - popularity(a)), [all]);
  const onboarding = useSyncExternalStore(onboardingStore.subscribe, onboardingStore.snapshot);
  const featured = onboardingFeaturedCourses(ranked, onboarding?.status === 'active');
  const categories = useMemo(() => groupStoreCoursesByCategory(ranked), [ranked]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const listMode = terms.length > 0 || category !== null;
  const listed = useMemo(
    () =>
      ranked.filter((course) => {
        const subject = storeCourseCategory(course);
        if (category && subject.id !== category) return false;
        const haystack = [
          course.name,
          course.courseCode,
          course.organization?.name,
          course.university,
          subject.label,
          ...course.tags,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    [ranked, category, terms],
  );

  const stateOf = (course: NativeStoreCourse): JoinState =>
    joining === course.id ? 'joining' : 'idle';
  const openCourse = (course: NativeStoreCourse) => setOpenId(course.id);

  const get = async (course: NativeStoreCourse, event: MouseEvent<HTMLButtonElement>) => {
    if (course.joined) {
      onOpenCourse(course.id);
      return;
    }
    const marble =
      event.currentTarget
        .closest('.st-feature-bar, .st-row, .st-detail-head')
        ?.querySelector<HTMLElement>('[data-fly]') ?? null;
    setJoining(course.id);
    setError(null);
    try {
      await nativeStoreAction(course.id, 'join');
      if (course.id === PLATFORM_TUTORIAL_COURSE_ID) completeOnboardingStep('store');
      flyMarble(marble, marbleFor(course));
      setCourses((current) =>
        (current ?? []).map((item) => (item.id === course.id ? { ...item, joined: true } : item)),
      );
      await onJoined(course.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setJoining(null);
    }
  };

  const openCourseData = openId ? all.find((course) => course.id === openId) : null;
  const categoryName = categories.find((group) => group.id === category)?.label;

  return (
    <>
      <PhonePage title={categoryName ?? '商城'} overlay largeTitle onBack={onBack}>
        <div className="st-page">
          <header className="phone-large-head st-head">
            <h1>{categoryName ?? '商城'}</h1>
            <label className="phone-search st-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索课程"
                aria-label="搜索商城课程"
                type="search"
              />
              {query || category ? (
                <button
                  type="button"
                  aria-label="清除"
                  onClick={() => {
                    setQuery('');
                    setCategory(null);
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
          </header>

          {categories.length ? (
            <nav className="st-categories" aria-label="课程分类">
              <button
                type="button"
                aria-pressed={category === null}
                onClick={() => setCategory(null)}
              >
                全部课程
              </button>
              {categories.map((group) => (
                <button
                  type="button"
                  key={group.id}
                  aria-pressed={category === group.id}
                  onClick={() => setCategory(group.id)}
                >
                  {group.label}
                  <small>{group.courses.length}</small>
                </button>
              ))}
            </nav>
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
            <>
              <GlassSkeletonRows rows={1} height={300} />
              <GlassSkeletonRows rows={3} height={64} />
            </>
          ) : !all.length && courses !== null ? (
            <PhoneEmpty title="商城里还没有课程" hint="机构上架课程后会出现在这里。" />
          ) : listMode ? (
            listed.length ? (
              <div className="st-list">
                {listed.map((course) => (
                  <CourseRow
                    key={course.id}
                    course={course}
                    state={stateOf(course)}
                    onOpen={openCourse}
                    onGet={get}
                  />
                ))}
              </div>
            ) : (
              <PhoneEmpty title="没有匹配的课程" hint="换个关键词再试。" />
            )
          ) : (
            <>
              <div className="st-features" role="list">
                {featured.map((course) => (
                  <FeatureCard
                    key={course.id}
                    course={course}
                    state={stateOf(course)}
                    onOpen={openCourse}
                    onGet={get}
                  />
                ))}
              </div>

              {ranked.length > 3 ? (
                <Shelf title="热门">
                  <div className="st-columns">
                    {chunk(ranked.slice(0, 12), 3).map((column, columnIndex) => (
                      <div key={columnIndex} className="st-column">
                        {column.map((course, index) => (
                          <CourseRow
                            key={course.id}
                            course={course}
                            rank={columnIndex * 3 + index + 1}
                            state={stateOf(course)}
                            onOpen={openCourse}
                            onGet={get}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </Shelf>
              ) : null}

              {categories.map((group) => (
                <Shelf
                  key={group.id}
                  title={group.label}
                  onSeeAll={group.courses.length > 2 ? () => setCategory(group.id) : undefined}
                >
                  <div className="st-tiles">
                    {group.courses.map((course) => (
                      <CourseTile key={course.id} course={course} onOpen={openCourse} />
                    ))}
                  </div>
                </Shelf>
              ))}
            </>
          )}
        </div>
      </PhonePage>

      {openCourseData ? (
        <StoreDetail
          course={openCourseData}
          state={stateOf(openCourseData)}
          onBack={() => setOpenId(null)}
          onGet={get}
        />
      ) : null}
    </>
  );
}
