import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, X } from 'lucide-react';

import { isPlatformCourse } from '../../data/chat-sync';
import { getNativeClassStanding } from '../../data/platform-api-client';
import type {
  NativeClassStanding,
  NativeClassStandingMetric,
} from '../../data/platform-api-contracts';
import { getLocalRepository } from '../../data/repository';
import './class-standing.css';

/**
 * 题库「和同班比」：首页一根细管（我 / 平均 / 第一），点开是整张卡片，
 * 左边一张插图（大学女生在桌前想事情），右边四根玻璃管；做完一组题回来，弹出整张卡片看名次变化。
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

type ArtMood = 'thinking' | 'cheer' | 'start';

function artMood(standing: NativeClassStanding, improved: boolean): ArtMood {
  if (standing.rank === 1 && standing.metrics.solved.me > 0) return 'cheer';
  if (improved) return 'cheer';
  if (standing.metrics.solved.me === 0) return 'start';
  return 'thinking';
}

const CAPTIONS: Record<ArtMood, [string, string]> = {
  thinking: ['我到底会了多少？', '班里最好的那个人，今天又在做什么'],
  cheer: ['又往前挪了一点。', '这一颗，是自己挣来的'],
  start: ['这周还没开始。', '先做一道，看看自己在哪'],
};

/** 插图：夜里窗边，一个大学女生在桌前。想事情时撑着下巴，往前挪了就举起手。 */
export function StudyGirlArt({ mood }: { mood: ArtMood }) {
  const cheer = mood === 'cheer';
  return (
    <svg
      className="cs-art-svg"
      viewBox="0 0 270 330"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <g fill="#fff">
        <circle cx="30" cy="34" r="1.4" opacity=".8" />
        <circle cx="72" cy="20" r="1" opacity=".6" />
        <circle cx="120" cy="44" r="1.6" opacity=".8" />
        <circle cx="240" cy="150" r="1.2" opacity=".7" />
        <circle cx="18" cy="140" r="1" opacity=".5" />
      </g>
      <rect
        x="158"
        y="22"
        width="92"
        height="112"
        rx="10"
        fill="#38428f"
        stroke="#7e7cc9"
        strokeWidth="3"
      />
      <line x1="204" y1="22" x2="204" y2="134" stroke="#7e7cc9" strokeWidth="3" />
      <line x1="158" y1="78" x2="250" y2="78" stroke="#7e7cc9" strokeWidth="3" />
      <circle cx="228" cy="48" r="12" fill="#fff3c4" />
      <circle cx="233" cy="44" r="11" fill="#38428f" />
      <circle cx="176" cy="44" r="1.6" fill="#fff" />
      <circle cx="186" cy="104" r="1.3" fill="#fff" opacity=".8" />
      <circle cx="232" cy="112" r="1.6" fill="#fff" />

      {/* 想法泡泡 */}
      <circle cx="70" cy="112" r="4" fill="#fff" opacity=".85" />
      <circle cx="58" cy="94" r="6.5" fill="#fff" opacity=".9" />
      <ellipse cx="62" cy="62" rx="34" ry="24" fill="#fff" />
      <circle
        cx="52"
        cy="62"
        r="10"
        fill={cheer ? '#ffd45a' : '#a68aff'}
        stroke="#2a2550"
        strokeWidth="1.5"
      />
      <ellipse cx="48.5" cy="58" rx="3.2" ry="2" fill="#fff" transform="rotate(-25 48.5 58)" />
      <text x="72" y="70" fontSize="22" fontWeight="800" fill="#2a2550" fontFamily="sans-serif">
        {cheer ? '!' : mood === 'start' ? '…' : '?'}
      </text>

      <path
        d="M70 122 Q66 96 92 90 Q126 84 134 116 Q140 150 136 196 L66 196 Q62 150 70 122 Z"
        fill="#3a2a3f"
      />
      {cheer ? (
        <>
          {/* 举起两只手 */}
          <path d="M66 196 L50 140" stroke="#2a2550" strokeWidth="19" strokeLinecap="round" />
          <path d="M66 196 L50 140" stroke="#ff8db7" strokeWidth="15" strokeLinecap="round" />
          <circle cx="48" cy="132" r="9" fill="#ffe3d1" stroke="#2a2550" strokeWidth="2" />
          <path d="M136 196 L152 140" stroke="#2a2550" strokeWidth="19" strokeLinecap="round" />
          <path d="M136 196 L152 140" stroke="#ff8db7" strokeWidth="15" strokeLinecap="round" />
          <circle cx="154" cy="132" r="9" fill="#ffe3d1" stroke="#2a2550" strokeWidth="2" />
        </>
      ) : null}
      <path
        d="M54 230 Q56 186 82 176 L118 176 Q146 186 148 230 Z"
        fill="#ff8db7"
        stroke="#2a2550"
        strokeWidth="2"
      />
      <path d="M86 176 Q100 188 114 176" fill="none" stroke="#2a2550" strokeWidth="2" />
      <rect
        x="93"
        y="150"
        width="16"
        height="28"
        rx="6"
        fill="#ffd9c2"
        stroke="#2a2550"
        strokeWidth="2"
      />
      <circle cx="101" cy="130" r="27" fill="#ffe3d1" stroke="#2a2550" strokeWidth="2" />
      <path
        d="M73 132 Q70 100 101 99 Q132 99 129 130 Q122 112 104 112 Q96 122 80 120 Q76 126 73 132 Z"
        fill="#3a2a3f"
      />
      <path
        d="M89 133 Q92 130 95 133"
        fill="none"
        stroke="#2a2550"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M106 133 Q109 130 112 133"
        fill="none"
        stroke="#2a2550"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="86" cy="141" r="4" fill="#ff8db7" opacity=".45" />
      <circle cx="116" cy="141" r="4" fill="#ff8db7" opacity=".45" />
      {cheer ? (
        <path d="M95 145 Q101 152 107 145 Z" fill="#2a2550" />
      ) : (
        <path
          d="M97 147 Q101 149 104 146"
          fill="none"
          stroke="#2a2550"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      {cheer ? null : (
        <>
          {/* 撑着下巴 */}
          <path d="M136 226 L118 160" stroke="#2a2550" strokeWidth="19" strokeLinecap="round" />
          <path d="M136 226 L118 160" stroke="#ff8db7" strokeWidth="15" strokeLinecap="round" />
          <circle cx="116" cy="154" r="9" fill="#ffe3d1" stroke="#2a2550" strokeWidth="2" />
        </>
      )}

      <rect x="0" y="222" width="270" height="110" fill="#5b4380" />
      <rect x="0" y="222" width="270" height="8" fill="#7a5ea3" />
      <path d="M44 240 L100 236 L100 262 L40 266 Z" fill="#fff" stroke="#2a2550" strokeWidth="2" />
      <path
        d="M100 236 L156 240 L160 266 L100 262 Z"
        fill="#fff"
        stroke="#2a2550"
        strokeWidth="2"
      />
      <line x1="52" y1="248" x2="92" y2="245" stroke="#c9c6e0" strokeWidth="2" />
      <line x1="52" y1="255" x2="86" y2="253" stroke="#c9c6e0" strokeWidth="2" />
      <line x1="108" y1="245" x2="148" y2="248" stroke="#c9c6e0" strokeWidth="2" />
      <line
        x1="120"
        y1="262"
        x2="150"
        y2="250"
        stroke="#ffae1f"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <rect
        x="186"
        y="170"
        width="50"
        height="58"
        rx="12"
        fill="rgba(255,255,255,.28)"
        stroke="#2a2550"
        strokeWidth="2"
      />
      <rect
        x="190"
        y="162"
        width="42"
        height="10"
        rx="4"
        fill="#7e7cc9"
        stroke="#2a2550"
        strokeWidth="2"
      />
      <circle cx="200" cy="216" r="8" fill="#5fdc9f" stroke="#2a2550" strokeWidth="1.5" />
      <circle cx="217" cy="217" r="8" fill="#ffae1f" stroke="#2a2550" strokeWidth="1.5" />
      <circle cx="208" cy="202" r="8" fill="#5ab4ff" stroke="#2a2550" strokeWidth="1.5" />
      <circle cx="225" cy="203" r="7" fill="#ff8db7" stroke="#2a2550" strokeWidth="1.5" />
      {cheer ? (
        <circle
          className="cs-art-drop"
          cx="211"
          cy="186"
          r="7"
          fill="#ffd45a"
          stroke="#2a2550"
          strokeWidth="1.5"
        />
      ) : null}
      <rect x="192" y="176" width="5" height="40" rx="2.5" fill="#fff" opacity=".55" />
      {cheer ? (
        <g fill="#ffd45a">
          <path d="M30 170 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
          <path d="M170 160 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" />
        </g>
      ) : null}
    </svg>
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
}: {
  standing: NativeClassStanding;
  period: StandingPeriod;
  onPeriod: (period: StandingPeriod) => void;
  onChase?: () => void;
  chaseTitle?: string | null;
  previousRank?: number | null;
  onCollapse?: () => void;
}) {
  const improved = previousRank != null && previousRank > standing.rank;
  const mood = artMood(standing, improved);
  const [title, sub] =
    mood === 'cheer' && standing.rank === 1 && !improved
      ? ['这周的第一是你。', '下周它还会是你的吗']
      : CAPTIONS[mood];
  const hintCount = standing.hint?.problemIds.length ?? 0;
  return (
    <section className="cs-card" aria-label="和同班比">
      <div className="cs-art">
        <StudyGirlArt mood={mood} />
        <p className="cs-art-caption">
          {title}
          <small>{sub}</small>
        </p>
      </div>
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
