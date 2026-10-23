'use client';

import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { LANDING_MARBLE_ART } from '@/components/home/landing/marble-art';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthStore } from '@/lib/store/auth';
import { enrollCourseFromStore, listCommunityStoreCourses } from '@/lib/utils/course-storage';
import type { CommunityCourseListItem, StoreOrganization } from '@/lib/utils/database';
import { toast } from '@/lib/notifications/client-toast';
import { cn } from '@/lib/utils';
import styles from './store.module.css';

/** 每门课一颗固定的弹珠（按 id 取），机构课程用更亮的稀有款。 */
const COURSE_ORB_ART = [
  LANDING_MARBLE_ART.cosmos,
  LANDING_MARBLE_ART.blue,
  LANDING_MARBLE_ART.purple,
  LANDING_MARBLE_ART.green,
  LANDING_MARBLE_ART.ocean,
  LANDING_MARBLE_ART.amber,
  LANDING_MARBLE_ART.pink,
  LANDING_MARBLE_ART.rainforest,
  LANDING_MARBLE_ART.chemistry,
  LANDING_MARBLE_ART.biology,
];

function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function orbArtFor(id: string) {
  return COURSE_ORB_ART[hashId(id) % COURSE_ORB_ART.length];
}

const ORG_TINTS = ['#7aa7ff', '#b28cff', '#69d3a8', '#ffb35c', '#ff8fb8'];

function orgTint(id: string): string {
  return ORG_TINTS[hashId(id) % ORG_TINTS.length];
}

/** 点「+」后，课程球缩成一颗弹珠飞向左上角的课程列表。 */
function flyMarble(from: HTMLElement, artSrc: string) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = from.getBoundingClientRect();
  const marble = document.createElement('img');
  marble.src = artSrc;
  marble.alt = '';
  marble.className = styles.flyingMarble;
  Object.assign(marble.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.appendChild(marble);
  const dx = 28 - (rect.left + rect.width / 2);
  const dy = 96 - (rect.top + rect.height / 2);
  const animation = marble.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      {
        transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 80}px) scale(0.45)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.2 },
    ],
    { duration: 820, easing: 'cubic-bezier(.5,0,.2,1)' },
  );
  animation.onfinish = () => marble.remove();
}

function OrgMarble({ organization, size = 28 }: { organization: StoreOrganization; size?: number }) {
  return (
    <span
      className={styles.orgMarble}
      style={{ '--tint': orgTint(organization.id), width: size, height: size } as CSSProperties}
      aria-hidden
    >
      {organization.logoUrl ? (
        <img src={organization.logoUrl} alt="" />
      ) : (
        <span>{organization.name.slice(0, 1)}</span>
      )}
    </span>
  );
}

function CountMarble({ tone, value, label }: { tone: string; value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <span className={styles.count} title={label} aria-label={`${label} ${value}`}>
      <span className={styles.countDot} style={{ '--tone': tone } as CSSProperties} />
      {value}
    </span>
  );
}

function StoreCourseCard({
  item,
  adding,
  onAdd,
  onOpen,
}: {
  item: CommunityCourseListItem;
  adding: boolean;
  onAdd: (item: CommunityCourseListItem, orb: HTMLElement) => void;
  onOpen: (item: CommunityCourseListItem) => void;
}) {
  const art = orbArtFor(item.id);
  const added = Boolean(item.purchased);
  const priced = (item.coursePriceCents ?? 0) > 0;

  const handleAdd = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (added) {
      onOpen(item);
      return;
    }
    const orb = event.currentTarget
      .closest(`.${styles.card}`)
      ?.querySelector<HTMLElement>(`.${styles.orb}`);
    if (orb) onAdd(item, orb);
  };

  return (
    <article
      className={cn(styles.card, added && styles.cardAdded)}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(item);
      }}
    >
      <div className={styles.orbWrap}>
        <img className={styles.orb} src={art.src} alt="" draggable={false} />
        <span className={styles.orbShine} aria-hidden />
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{item.name}</h3>
        {item.organization ? (
          <p className={styles.cardOrg}>
            <OrgMarble organization={item.organization} size={16} />
            {item.organization.name}
          </p>
        ) : null}
        <div className={styles.counts}>
          <CountMarble tone="#7aa7ff" value={item.notebookCount ?? 0} label="笔记" />
          <CountMarble tone="#69d3a8" value={item.sceneCount ?? 0} label="课堂页" />
          <CountMarble tone="#ff8fb8" value={item.publishedProblemCount ?? 0} label="题目" />
          {priced ? (
            <span className={styles.price}>{Math.round((item.coursePriceCents ?? 0) / 100)} ✦</span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className={cn(styles.addButton, added && styles.addButtonDone)}
        aria-label={added ? '已添加，进入学习' : `添加「${item.name}」`}
        disabled={adding}
        onClick={handleAdd}
      >
        {added ? <Check size={18} strokeWidth={2.6} /> : <Plus size={20} strokeWidth={2.4} />}
      </button>
    </article>
  );
}

export default function CourseStorePage() {
  const router = useRouter();
  const authHydrated = usePersistHydrated(useAuthStore);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [courses, setCourses] = useState<CommunityCourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const load = useCallback(async () => {
    if (!authHydrated || !isLoggedIn) return;
    try {
      setCourses(await listCommunityStoreCourses());
    } finally {
      setLoading(false);
    }
  }, [authHydrated, isLoggedIn]);

  useEffect(() => {
    if (!authHydrated) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    void load();
  }, [authHydrated, isLoggedIn, router, load]);

  const organizations = useMemo(() => {
    const byId = new Map<string, StoreOrganization>();
    for (const item of courses) {
      if (item.organization) byId.set(item.organization.id, item.organization);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [courses]);

  const visibleCourses = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    return courses.filter((item) => {
      if (orgFilter && item.organization?.id !== orgFilter) return false;
      if (!query) return true;
      return [
        item.name,
        item.description ?? '',
        item.organization?.name ?? '',
        item.courseCode ?? '',
        item.university ?? '',
        item.tags.join(' '),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [courses, deferredSearchQuery, orgFilter]);

  const openCourse = useCallback(
    (item: CommunityCourseListItem) => {
      router.push(
        item.purchased
          ? `/learn?courseId=${encodeURIComponent(item.id)}`
          : `/store/courses/${encodeURIComponent(item.id)}`,
      );
    },
    [router],
  );

  const addCourse = useCallback(async (item: CommunityCourseListItem, orb: HTMLElement) => {
    setAddingId(item.id);
    flyMarble(orb, orbArtFor(item.id).src);
    try {
      await enrollCourseFromStore(item.id);
      setCourses((current) =>
        current.map((row) => (row.id === item.id ? { ...row, purchased: true } : row)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加失败');
    } finally {
      setAddingId(null);
    }
  }, []);

  if (!authHydrated || !isLoggedIn) return null;

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <div className={styles.searchPill}>
          <Search size={17} className={styles.searchIcon} aria-hidden />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索课程"
            aria-label="搜索课程"
          />
          {searchQuery ? (
            <button type="button" aria-label="清空" onClick={() => setSearchQuery('')}>
              <X size={15} />
            </button>
          ) : null}
        </div>

        {organizations.length > 1 ? (
          <nav className={styles.orgRow} aria-label="机构">
            <button
              type="button"
              className={cn(styles.orgChip, !orgFilter && styles.orgChipActive)}
              onClick={() => setOrgFilter(null)}
            >
              全部
            </button>
            {organizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                className={cn(styles.orgChip, orgFilter === organization.id && styles.orgChipActive)}
                onClick={() =>
                  setOrgFilter((current) => (current === organization.id ? null : organization.id))
                }
              >
                <OrgMarble organization={organization} size={22} />
                <span>{organization.name}</span>
              </button>
            ))}
          </nav>
        ) : null}

        {loading ? (
          <div className={styles.grid} aria-busy>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className={cn(styles.card, styles.cardSkeleton)} />
            ))}
          </div>
        ) : visibleCourses.length > 0 ? (
          <div className={styles.grid}>
            {visibleCourses.map((item) => (
              <StoreCourseCard
                key={item.id}
                item={item}
                adding={addingId === item.id}
                onAdd={addCourse}
                onOpen={openCourse}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyOrb} aria-hidden />
            <p>{courses.length > 0 ? '没有匹配的课程' : '还没有机构课程'}</p>
          </div>
        )}
      </main>
    </div>
  );
}
