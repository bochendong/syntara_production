import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, X } from 'lucide-react';

import { isPlatformCourse } from '../../data/chat-sync';
import { getNativeClassStanding } from '../../data/platform-api-client';
import type {
  NativeClassStanding,
  NativeClassStandingMetric,
} from '../../data/platform-api-contracts';
import { getLocalRepository } from '../../data/repository';
import { selectStandingIllustration, type StandingIllustration } from './class-standing-art';
import './class-standing.css';

/**
 * 题库「和同班比」：首页一根细管（我 / 平均 / 第一），点开是整张卡片，
 * 左边按学习状态轮换手绘与引用，右边四根玻璃管；做完一组题回来，弹出整张卡片看名次变化。
 * 数字都来自服务器的聚合结果，不显示任何同学的名字。
 */

export type StandingPeriod = 'week' | 'all';

const PENDING_KEY = 'syntara.bank-compare-pending.v1';
const OPEN_KEY = 'syntara.bank-compare-open.v1';

type Pending = { courseId: string; solved: number; rank: number; at: number };

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就不弹。
  }
}

/** 每门课最近一次拉到的「本周」结果，开始做题前用来记下名次。 */
const lastWeekStanding = new Map<string, NativeClassStanding>();

/** 开始做一组题前记下现在的名次，做完回来比较。 */
export function markStandingBeforePractice(courseId: string) {
  const standing = lastWeekStanding.get(courseId);
  if (!standing) return;
  writeSession(PENDING_KEY, {
    courseId,
    solved: standing.metrics.solved.me,
    rank: standing.rank,
    at: Date.now(),
  } satisfies Pending);
}

/** 拉同班对比；refreshKey 变了（比如又做对了题）就隔一会儿再拉一次。做完一组回来名次变了，previousRank 是出发前的名次。 */
export function useClassStanding(courseId: string, period: StandingPeriod, refreshKey: number) {
  const [standing, setStanding] = useState<NativeClassStanding | null>(null);
  const [previousRank, setPreviousRank] = useState<number | null>(null);
  const first = useRef(true);
  useEffect(() => {
    let cancelled = false;
    const delay = first.current ? 0 : 1500;
    first.current = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const repository = await getLocalRepository();
          if (!(await isPlatformCourse(repository, courseId))) {
            if (!cancelled) setStanding(null);
            return;
          }
          const next = await getNativeClassStanding(courseId, period);
          if (cancelled) return;
          setStanding(next);
          if (next.period === 'week') lastWeekStanding.set(courseId, next);
          const rank = takeImprovement(next);
          if (rank !== null) setPreviousRank(rank);
        } catch {
          // 离线或服务器没这个接口时不显示。
          if (!cancelled) setStanding(null);
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [courseId, period, refreshKey]);
  return { standing, previousRank, clearImprovement: () => setPreviousRank(null) };
}

/** 做完一组回来：做对的题比出发前多了，就返回出发前的名次（只看一次）。 */
function takeImprovement(standing: NativeClassStanding): number | null {
  if (standing.period !== 'week') return null;
  const pending = readSession<Pending>(PENDING_KEY);
  if (!pending || pending.courseId !== standing.courseId) return null;
  const stale = Date.now() - pending.at > 6 * 3600_000;
  const improved = standing.metrics.solved.me > pending.solved;
  if (stale || improved) writeSession(PENDING_KEY, null);
  return !stale && improved ? pending.rank : null;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

type TubeSpec = {
  key: keyof NativeClassStanding['metrics'];
  label: string;
  note: string;
  color: 'green' | 'blue' | 'amber' | 'purple';
  format: (value: number) => string;
  unit: string;
};

const TUBES: TubeSpec[] = [
  { key: 'solved', label: '做对', note: '道题', color: 'green', format: String, unit: '' },
  {
    key: 'firstTry',
    label: '正确率',
    note: '第一次就对',
    color: 'blue',
    format: percent,
    unit: '',
  },
  { key: 'streak', label: '连续', note: '天在做题', color: 'amber', format: String, unit: ' 天' },
  { key: 'chapters', label: '章节', note: '全做对', color: 'purple', format: String, unit: ' 章' },
];

function scaleOf(key: TubeSpec['key'], metric: NativeClassStandingMetric) {
  if (key === 'firstTry') return 1;
  return Math.max(metric.top, metric.me, 1);
}

/** 一根玻璃管：我的弹珠、平均线、戴皇冠的第一。 */
function StandingTube({
  spec,
  metric,
  compact = false,
}: {
  spec: TubeSpec;
  metric: NativeClassStandingMetric;
  compact?: boolean;
}) {
  const scale = scaleOf(spec.key, metric);
  const at = (value: number) => `${Math.min(100, Math.max(0, (value / scale) * 100))}%`;
  const meIsTop = metric.me >= metric.top;
  return (
    <div className={`cs-tube cs-${spec.color}${compact ? ' is-compact' : ''}`}>
      <span className="cs-fill" style={{ width: at(metric.me) }} />
      <span className="cs-avg" style={{ left: at(metric.average) }} aria-hidden>
        <small>平均</small>
      </span>
      {meIsTop ? null : (
        <span className="cs-marble is-top" style={{ left: at(metric.top) }} aria-hidden>
          <i>👑</i>
          <small>{`第一 ${spec.format(metric.top)}`}</small>
        </span>
      )}
      <span className="cs-marble is-me" style={{ left: at(metric.me) }} aria-hidden>
        {meIsTop ? <i>👑</i> : null}
        <small>{`我 ${spec.format(metric.me)}`}</small>
      </span>
    </div>
  );
}

const illustrationImages = import.meta.glob<string>('../../assets/class-standing/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** 配图与引用作为一组，首页展开卡片和练习后的弹窗共用。 */
export function ClassStandingArt({ illustration }: { illustration: StandingIllustration }) {
  return (
    <figure className="cs-art">
      <img
        className="cs-art-image"
        src={illustrationImages[`../../assets/class-standing/${illustration.id}.webp`]}
        alt={illustration.alt}
        width={768}
        height={1152}
        decoding="async"
        loading="lazy"
      />
      <figcaption className="cs-art-caption">
        <blockquote>{illustration.quote}</blockquote>
        <cite>— {illustration.attribution}</cite>
      </figcaption>
    </figure>
  );
}

function scopeLine(standing: NativeClassStanding) {
  const who = standing.scope === 'class' ? '同班' : '这门课';
  return `${who} ${standing.size} 人 · 你排第 ${standing.rank}`;
}

/** 整张卡片：左边插图，右边四根管子 + 追第一的那一章。 */
export function ClassStandingCard({
  standing,
  period,
  onPeriod,
  onChase,
  chaseTitle,
  previousRank,
  onCollapse,
  artwork,
}: {
  standing: NativeClassStanding;
  period: StandingPeriod;
  onPeriod: (period: StandingPeriod) => void;
  onChase?: () => void;
  chaseTitle?: string | null;
  previousRank?: number | null;
  onCollapse?: () => void;
  artwork?: StandingIllustration;
}) {
  const improved = previousRank != null && previousRank > standing.rank;
  const illustration = artwork ?? selectStandingIllustration(standing, previousRank != null);
  const hintCount = standing.hint?.problemIds.length ?? 0;
  return (
    <section className="cs-card" aria-label="和同班比">
      <ClassStandingArt illustration={illustration} />
      <div className="cs-body">
        <header className="cs-head">
          <div>
            <strong>{standing.scope === 'class' ? '和同班比' : '和同学比'}</strong>
            <span>
              {improved
                ? `第 ${previousRank} → 第 ${standing.rank} · ${standing.scope === 'class' ? '同班' : '这门课'} ${standing.size} 人`
                : scopeLine(standing)}
            </span>
          </div>
          <div className="cs-seg" role="tablist" aria-label="时间">
            {(['week', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={period === value}
                className={period === value ? 'is-on' : undefined}
                onClick={() => onPeriod(value)}
              >
                {value === 'week' ? '本周' : '累计'}
              </button>
            ))}
          </div>
          {onCollapse ? (
            <button type="button" className="cs-close" onClick={onCollapse} aria-label="收起">
              <X size={16} />
            </button>
          ) : null}
        </header>
        <div className="cs-rows">
          {TUBES.map((spec) => {
            const metric = standing.metrics[spec.key];
            return (
              <div key={spec.key} className="cs-row">
                <div className="cs-label">
                  <b>{spec.label}</b>
                  {spec.note}
                </div>
                <StandingTube spec={spec} metric={metric} />
                <div className="cs-value">
                  <b>{spec.format(metric.me)}</b> / {spec.format(metric.top)}
                  {spec.unit}
                </div>
              </div>
            );
          })}
        </div>
        {standing.hint && hintCount && onChase ? (
          <div className="cs-foot">
            <div className="cs-hint">
              <b>{`第一名多做了「${chaseTitle || standing.hint.chapterName || '这一章'}」`}</b>
              {`你在这章还有 ${hintCount} 题没做对`}
            </div>
            <button type="button" className="cs-chase" onClick={onChase}>
              <b>
                去追 <Play size={12} fill="currentColor" />
              </b>
              {`先做这 ${hintCount} 题`}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 首页的细条：一根管子 + 名次，点一下展开整张卡片。 */
export function ClassStandingStrip({
  standing,
  onOpen,
}: {
  standing: NativeClassStanding;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="cs-strip" onClick={onOpen} aria-label="展开和同班比">
      <span className="cs-strip-rank">
        <b>{standing.rank}</b>
        <small>{`/ ${standing.size}`}</small>
      </span>
      <span className="cs-strip-tube">
        <small>
          {standing.scope === 'class' ? '本周 · 和同班比做对题数' : '本周 · 和同学比做对题数'}
        </small>
        <StandingTube spec={TUBES[0]} metric={standing.metrics.solved} compact />
      </span>
      <ChevronDown size={18} className="cs-strip-chevron" aria-hidden />
    </button>
  );
}

/** 做完一组回来时弹出的整张卡片。 */
export function ClassStandingPopup(
  props: Parameters<typeof ClassStandingCard>[0] & { onClose: () => void },
) {
  const { onClose, ...card } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="cs-popup"
      role="dialog"
      aria-modal="true"
      aria-label="这组做完了"
      onClick={onClose}
    >
      <div className="cs-popup-inner" onClick={(event) => event.stopPropagation()}>
        <ClassStandingCard {...card} onCollapse={onClose} />
      </div>
    </div>
  );
}

export function readStandingOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStandingOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // 记不住就每次收起。
  }
}
