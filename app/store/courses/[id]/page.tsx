'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BadgeCheck, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { PurchaseConfirmDialog } from '@/components/courses/purchase-confirm-dialog';
import { useStoreStaging } from '@/components/courses/store-runtime';
import { toast } from '@/lib/notifications/client-toast';
import { backendJson } from '@/lib/utils/backend-api';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { MARBLE_AVATAR_CATALOG } from '@/lib/constants/marble-avatars';
import avatarThemeHues from '@/lib/constants/marble-avatar-theme-hues.json';
import { courseDisplayCode } from '@/lib/course-space/course-display-name';
import store from '../store.module.css';
import styles from './detail.module.css';
import { PLATFORM_TUTORIAL_COURSE_ID } from '@/lib/onboarding/spotlight';

type StoreNotebook = {
  id: string;
  name: string;
  description: string | null;
  sectionCount: number;
  publishedProblemCount: number;
  _count: { scenes: number };
};

type StoreCourseDetailResponse = {
  course: {
    id: string;
    name: string;
    description: string | null;
    tags: string[];
    university: string | null;
    courseCode: string | null;
    avatarUrl: string | null;
    ownerName: string;
    organization: { name: string; verified: boolean } | null;
    averageRating: number;
    reviewCount: number;
    publishedProblemCount: number;
    purchased: boolean;
    notebooks: StoreNotebook[];
  };
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    reviewerName: string;
    updatedAt: string;
  }>;
};

function notebookPages(notebook: StoreNotebook) {
  return notebook.sectionCount || notebook._count.scenes || 0;
}

function courseArt(id: string, storedUrl: string | null) {
  const url = resolveCourseAvatarDisplayUrl(id, storedUrl);
  let pathname = url;
  try {
    pathname = new URL(url, 'https://syntara.local').pathname;
  } catch {
    /* Custom image URLs have no bundled scene. */
  }
  const avatar = MARBLE_AVATAR_CATALOG.find((item) => item.url === pathname);
  const hue = avatar ? (avatarThemeHues[avatar.id as keyof typeof avatarThemeHues] ?? 220) : 220;
  return {
    url,
    scene: avatar ? `/avatars/marble-backgrounds-v1/${avatar.filename}` : null,
    tint: {
      '--st-from': `hsl(${hue} 85% 88%)`,
      '--st-to': `hsl(${(hue + 40) % 360} 90% 94%)`,
      '--st-accent': `hsl(${hue} 55% 34%)`,
    } as CSSProperties,
  };
}

function Stars({ value }: { value: number }) {
  return (
    <span className={styles.stars} aria-label={`${value} 星`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          size={13}
          fill={index < Math.round(value) ? 'currentColor' : 'none'}
          aria-hidden
        />
      ))}
    </span>
  );
}

export default function StoreCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const staging = useStoreStaging();
  const id = typeof params.id === 'string' ? params.id : '';
  const [data, setData] = useState<StoreCourseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [coursePurchaseOpen, setCoursePurchaseOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void backendJson<StoreCourseDetailResponse>(`/api/courses/store/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setLoadError(error instanceof Error ? error.message : '课程详情加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);

  const openCourse = useCallback(() => {
    router.push(`${staging ? '/test/app' : '/learn'}?courseId=${encodeURIComponent(id)}`);
  }, [id, router, staging]);

  const handleBuy = async (): Promise<boolean> => {
    setBuying(true);
    try {
      await backendJson('/api/courses/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCourseId: id }),
      });
      toast.success('已加入课程');
      openCourse();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入失败');
      return false;
    } finally {
      setBuying(false);
    }
  };

  const handleReview = async () => {
    setSubmitting(true);
    try {
      await backendJson(`/api/courses/store/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      toast.success('评价已提交');
      setComment('');
      setRevision((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交评价失败');
    } finally {
      setSubmitting(false);
    }
  };

  const backLink = (
    <Link href="/store/courses" className={styles.back}>
      <ChevronLeft size={20} aria-hidden />
      商城
    </Link>
  );

  if (loading)
    return (
      <div className={store.shell}>
        <main className={`${store.main} ${styles.page}`}>
          {backLink}
          <div className={styles.loading} role="status" aria-label="正在加载课程详情">
            <div className={styles.loadingCover} />
            <div className={styles.loadingTitle} />
            <div className={styles.loadingFacts} />
          </div>
        </main>
      </div>
    );

  if (!data)
    return (
      <div className={store.shell}>
        <main className={`${store.main} ${styles.page}`}>
          {backLink}
          <div className={styles.empty} role="alert">
            <h1>课程详情暂不可用</h1>
            <p>{loadError || '这门课程可能已经下架。'}</p>
            <button
              type="button"
              className={store.get}
              onClick={() => setRevision((value) => value + 1)}
            >
              重试
            </button>
          </div>
        </main>
      </div>
    );

  const { course, reviews } = data;
  const art = courseArt(course.id, course.avatarUrl);
  const title = courseDisplayCode(course) || course.name;
  const pages = course.notebooks.reduce((sum, notebook) => sum + notebookPages(notebook), 0);
  const facts = [
    ...(course.reviewCount > 0
      ? [{ label: `${course.reviewCount} 个评分`, value: course.averageRating.toFixed(1) }]
      : []),
    { label: '章节', value: String(course.notebooks.length) },
    ...(pages ? [{ label: '内容页', value: String(pages) }] : []),
    ...(course.publishedProblemCount
      ? [{ label: '题目', value: String(course.publishedProblemCount) }]
      : []),
    ...(course.university ? [{ label: '学校', value: course.university }] : []),
  ];

  return (
    <div className={store.shell}>
      <main className={`${store.main} ${styles.page}`} style={art.tint}>
        {backLink}
        {art.scene ? (
          <div
            className={styles.cover}
            style={{ backgroundImage: `url("${art.scene}")` }}
            aria-hidden
          />
        ) : null}
        <header className={`${styles.identity} ${art.scene ? styles.withCover : ''}`}>
          <img className={styles.avatar} src={art.url} alt="" />
          <div className={styles.heading}>
            <h1>{title}</h1>
            {title !== course.name ? <p>{course.name}</p> : null}
            <span className={styles.organization}>
              {course.organization?.name || course.ownerName}
              {course.organization?.verified ? <BadgeCheck size={14} aria-label="已认证" /> : null}
            </span>
            <button
              type="button"
              className={`${store.get} ${styles.get}`}
              data-onboarding={
                id === PLATFORM_TUTORIAL_COURSE_ID && !course.purchased ? 'tutorial-get' : undefined
              }
              disabled={buying}
              onClick={() => (course.purchased ? openCourse() : setCoursePurchaseOpen(true))}
            >
              {buying ? (
                <span className={store.getRing} aria-label="正在获取" />
              ) : course.purchased ? (
                '打开'
              ) : (
                '获取'
              )}
            </button>
          </div>
        </header>

        <dl className={styles.facts} aria-label="课程信息">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
              {fact.label.endsWith('个评分') ? <Stars value={course.averageRating} /> : null}
            </div>
          ))}
        </dl>

        <section className={styles.section} aria-labelledby="course-chapters-heading">
          <h2 id="course-chapters-heading">章节</h2>
          {course.notebooks.length ? (
            <div className={styles.chapters}>
              {course.notebooks.map((notebook, index) => {
                const content = (
                  <>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    <strong>{notebook.name}</strong>
                    <span>
                      {notebookPages(notebook) ? `${notebookPages(notebook)} 页` : ''}
                      {notebookPages(notebook) && notebook.publishedProblemCount ? ' · ' : ''}
                      {notebook.publishedProblemCount ? `${notebook.publishedProblemCount} 题` : ''}
                    </span>
                  </>
                );
                return course.purchased ? (
                  <Link
                    key={notebook.id}
                    className={styles.chapter}
                    href={
                      staging
                        ? `/test/app?courseId=${encodeURIComponent(id)}&page=notes`
                        : `/classroom/${encodeURIComponent(notebook.id)}`
                    }
                    aria-label={`打开${notebook.name}`}
                  >
                    {content}
                    <ChevronRight size={17} aria-hidden />
                  </Link>
                ) : (
                  <article key={notebook.id} className={styles.chapter}>
                    {content}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className={styles.muted}>还没有整理好的章节，机构发布后会出现在这里。</p>
          )}
        </section>

        {course.description ? (
          <section className={styles.section} aria-label="课程简介">
            <p className={`${styles.description} ${expanded ? styles.expanded : ''}`}>
              {course.description}
            </p>
            {!expanded && course.description.length > 150 ? (
              <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
                更多
              </button>
            ) : null}
          </section>
        ) : null}

        {course.tags.length ? (
          <div className={styles.tags} aria-label="课程标签">
            {course.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}

        <section className={styles.section} aria-labelledby="course-reviews-heading">
          <h2 id="course-reviews-heading">评分及评价</h2>
          {course.reviewCount > 0 ? (
            <div className={styles.reviewSummary}>
              <strong>{course.averageRating.toFixed(1)}</strong>
              <div>
                <Stars value={course.averageRating} />
                <p>满分 5 分 · {course.reviewCount} 个评分</p>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>还没有评价，欢迎分享你的学习体验。</p>
          )}
          {reviews.length ? (
            <div className={styles.reviews}>
              {reviews.map((review) => (
                <article key={review.id} className={styles.review}>
                  <header>
                    <Stars value={review.rating} />
                    <time dateTime={review.updatedAt}>
                      {new Date(review.updatedAt).toLocaleDateString()}
                    </time>
                  </header>
                  <p>{review.comment || '这位同学留下了评分。'}</p>
                  <small>{review.reviewerName}</small>
                </article>
              ))}
            </div>
          ) : null}
          {course.purchased ? (
            <form
              className={styles.reviewForm}
              onSubmit={(event) => {
                event.preventDefault();
                void handleReview();
              }}
            >
              <fieldset>
                <legend>为这门课程评分</legend>
                <div className={styles.ratingPicker}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={`${index + 1} 星`}
                      aria-pressed={rating === index + 1}
                      onClick={() => setRating(index + 1)}
                    >
                      <Star size={22} fill={index < rating ? 'currentColor' : 'none'} aria-hidden />
                    </button>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="course-review">写下你的学习体验</label>
              <textarea
                id="course-review"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="课程内容、例题或讲解有哪些帮助？"
              />
              <button type="submit" className={store.get} disabled={submitting}>
                {submitting ? '提交中…' : '提交评价'}
              </button>
            </form>
          ) : (
            <p className={styles.muted}>获取课程后可以评分和评价。</p>
          )}
        </section>
        <PurchaseConfirmDialog
          open={coursePurchaseOpen}
          onOpenChange={setCoursePurchaseOpen}
          itemTypeLabel="课程"
          itemName={course.name}
          countSummary={`包含 ${course.notebooks.length} 个章节${pages ? `，共 ${pages} 页内容` : ''}。`}
          note="加入后可在课程列表中找到，学习进度会保存在你的账号里。"
          busy={buying}
          confirmLabel="获取课程"
          onConfirm={handleBuy}
        />
      </main>
    </div>
  );
}
