import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Layers3,
  Search,
  Sparkles,
  Star,
  Ticket,
  X,
} from 'lucide-react';
import {
  CARD_RULES,
  CARD_FINISHES,
  CARD_SERIES,
  STUDY_CARDS,
  cardLevel,
  collectorLevel,
  type CardCollection,
  type CardDrawResponse,
  type CardRarity,
  type CardSeries,
  type StudyCard,
} from '../../../../../lib/study-cards/catalog';
import { getStudyCards, drawStudyCard, favoriteStudyCard } from '../../data/platform-api-client';
import { accountStorageKey } from '../../data/browser-runtime';
import { StudyCardFace } from './StudyCardFace';
import './study-cards.css';

export type CardCollectionApi = {
  load: () => Promise<CardCollection>;
  draw: (id: string) => Promise<CardDrawResponse>;
  favorite: (id: string, value: boolean) => Promise<CardCollection>;
};
const productionApi: CardCollectionApi = {
  load: getStudyCards,
  draw: drawStudyCard,
  favorite: favoriteStudyCard,
};
const pendingKey = 'syntara.study-card.pending-draw.v1';
function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    element.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={element}
      className={`sc-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sc-dialog-inner">
        <h2 id={id} className="sc-sr-only">
          {title}
        </h2>
        <button className="sc-icon-button sc-dialog-close" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
export function CardCollectionPage({
  onBack,
  api = productionApi,
}: {
  onBack: () => void;
  api?: CardCollectionApi;
}) {
  const [collection, setCollection] = useState<CardCollection | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<CardSeries | 'all'>('all');
  const [rarity, setRarity] = useState<CardRarity | 'all'>('all');
  const [tab, setTab] = useState<'owned' | 'catalog' | 'favorites'>('owned');
  const [search, setSearch] = useState('');
  const [rules, setRules] = useState(false);
  const [detail, setDetail] = useState<StudyCard | null>(null);
  const [draw, setDraw] = useState<CardDrawResponse['draw'] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const drawBusy = useRef(false);
  const pending = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      pending.current ??= localStorage.getItem(accountStorageKey(pendingKey));
      setCollection(await api.load());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '暂时无法打开收藏册，请重试。');
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const owned = collection?.owned ?? {};
  const unique = Object.keys(owned).filter((id) => owned[id] > 0).length;
  const rank = collectorLevel(unique);
  const heroCards = ['zodiac-ssr-02', 'mbti-ssr-02', 'dream-ssr-01'].map(
    (id) => STUDY_CARDS.find((c) => c.id === id)!,
  );
  const visible = useMemo(
    () =>
      STUDY_CARDS.filter(
        (card) =>
          (series === 'all' || card.series === series) &&
          (rarity === 'all' || card.rarity === rarity) &&
          (!search ||
            `${card.name} ${card.caption}`.toLowerCase().includes(search.toLowerCase())) &&
          (tab === 'catalog' ||
            (tab === 'favorites'
              ? collection?.favorites.includes(card.id)
              : (collection?.owned[card.id] ?? 0) > 0)),
      ).sort((a, b) => ({ SSR: 0, SR: 1, R: 2 })[a.rarity] - { SSR: 0, SR: 1, R: 2 }[b.rarity]),
    [series, rarity, search, tab, collection],
  );
  const performDraw = async () => {
    if (drawBusy.current || !collection) return;
    drawBusy.current = true;
    setDrawing(true);
    setError('');
    try {
      // Persist before sending. Retrying after a timeout or reload uses the same receipt id.
      pending.current ??=
        localStorage.getItem(accountStorageKey(pendingKey)) || crypto.randomUUID();
      localStorage.setItem(accountStorageKey(pendingKey), pending.current);
      const result = await api.draw(pending.current);
      setCollection(result.collection);
      setDraw(result.draw);
      setRevealed(false);
      localStorage.removeItem(accountStorageKey(pendingKey));
      pending.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : '抽卡未完成，请重试；不会重复扣除次数。');
    } finally {
      drawBusy.current = false;
      setDrawing(false);
    }
  };
  const toggleFavorite = async (card: StudyCard) => {
    if (saving || !collection) return;
    setSaving(true);
    try {
      setCollection(await api.favorite(card.id, !collection.favorites.includes(card.id)));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '展柜更新失败。');
    } finally {
      setSaving(false);
    }
  };
  const drawn = draw ? STUDY_CARDS.find((card) => card.id === draw.cardId) : null;
  return (
    <section className="sc-page" aria-label="我的卡片收藏">
      <header className="sc-topbar">
        <button className="sc-icon-button" onClick={onBack} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="sc-brand">
          <Sparkles size={17} /> SYNTARA <i>/</i> 收藏室
        </span>
        <button className="sc-rule-button" onClick={() => setRules(true)}>
          收集规则 <ChevronRight size={14} />
        </button>
      </header>
      <main className="sc-main">
        <section className="sc-hero">
          <div className="sc-hero-copy">
            <span className="sc-eyebrow">A LITTLE WONDER, EARNED.</span>
            <h1>
              把努力，
              <br />
              收藏成<span>闪光。</span>
            </h1>
            <p>
              每一张卡，都是认真学过的证明。
              <br />
              下一次相遇，会是哪一个宇宙？
            </p>
            <div className="sc-hero-actions">
              <button
                className="sc-primary"
                onClick={() => void performDraw()}
                disabled={
                  drawing ||
                  loading ||
                  !collection ||
                  (!collection.availableDraws && !pending.current)
                }
              >
                <Sparkles size={18} />
                {drawing ? '正在打开星光…' : `开启一张 · ${collection?.availableDraws ?? 0} 次机会`}
                <ArrowRight size={17} />
              </button>
              <span className="sc-hero-hint">做题获得 · 永久收藏</span>
            </div>
            <div className="sc-next">
              <span>
                <Ticket size={13} />
                再通过 {5 - (collection?.nextDrawProgress ?? 0)} 道新题，获得一抽
              </span>
              <div className="sc-five-dots">
                {[0, 1, 2, 3, 4].map((n) => (
                  <i key={n} className={n < (collection?.nextDrawProgress ?? 0) ? 'is-full' : ''} />
                ))}
              </div>
            </div>
          </div>
          <div className="sc-hero-art" aria-label="可收集的 SSR 卡片预览">
            <div className="sc-orbit" />
            {heroCards.map((card, index) => (
              <div key={card.id} className={`sc-hero-card sc-hero-card-${index}`}>
                <StudyCardFace card={card} compact />
              </div>
            ))}
            <span className="sc-float-label">
              <Sparkles size={12} /> SSR · 等待与你相遇
            </span>
          </div>
        </section>
        <div className="sc-stats">
          <div className="sc-collector">
            <span className="sc-level-mark">{rank.level}</span>
            <span>
              <small>COLLECTOR LEVEL {rank.level}</small>
              <strong>{rank.name}</strong>
            </span>
          </div>
          <div>
            <strong>
              {unique}
              <small> / {STUDY_CARDS.length}</small>
            </strong>
            <span>已收集卡面</span>
          </div>
          <div>
            <strong>{Object.values(owned).reduce((a, b) => a + b, 0)}</strong>
            <span>卡片总张数</span>
          </div>
          <div>
            <strong>
              {STUDY_CARDS.filter((c) => c.rarity === 'SSR' && owned[c.id]).length}
              <small> SSR</small>
            </strong>
            <span>典藏闪卡</span>
          </div>
        </div>
        {error && (
          <div className="sc-error" role="alert">
            {error}
            <button onClick={() => void refresh()}>重新加载</button>
          </div>
        )}
        <section className="sc-series-section">
          <div className="sc-section-head">
            <div>
              <span className="sc-eyebrow">FIND YOUR UNIVERSE</span>
              <h2>总有一个系列，让你心动。</h2>
            </div>
            <button
              className={`sc-text-button ${series === 'all' ? 'is-active' : ''}`}
              onClick={() => setSeries('all')}
            >
              全部系列 <ArrowRight size={14} />
            </button>
          </div>
          <div className="sc-series-list">
            {CARD_SERIES.map((s, i) => {
              const cards = STUDY_CARDS.filter((c) => c.series === s.id);
              const count = cards.filter((c) => owned[c.id]).length;
              return (
                <button
                  key={s.id}
                  className={`sc-series-tile sc-series-${s.id}${series === s.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSeries(s.id);
                  }}
                >
                  <span className="sc-series-index">0{i + 1}</span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.id === 'mbti'
                      ? 'MBTI · 16 人格'
                      : s.id === 'zodiac'
                        ? '十二星座'
                        : s.description}
                  </small>
                  <span className="sc-series-tiers">R · SR · SSR</span>
                  <span className="sc-series-progress">
                    <i style={{ width: `${(count / cards.length) * 100}%` }} />
                  </span>
                  <span className="sc-series-count">
                    {count} / {cards.length} <ChevronRight size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="sc-library">
          <div className="sc-library-head">
            <div className="sc-tabs" role="group" aria-label="卡片范围">
              {(
                [
                  ['owned', '我的收藏'],
                  ['catalog', '全卡图鉴'],
                  ['favorites', '心动展柜'],
                ] as const
              ).map(([key, label]) => (
                <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
                  {label}
                  {key === 'owned' && <span>{unique}</span>}
                </button>
              ))}
            </div>
            <label className="sc-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="寻找一张卡…"
                aria-label="搜索卡片"
              />
            </label>
          </div>
          <div className="sc-filter-row">
            <span>
              {series === 'all' ? '所有系列' : CARD_SERIES.find((s) => s.id === series)?.name}{' '}
              <i>/</i> {visible.length} 张卡面
            </span>
            <div role="group" aria-label="稀有度筛选">
              {(['all', 'SSR', 'SR', 'R'] as const).map((r) => (
                <button key={r} aria-pressed={rarity === r} onClick={() => setRarity(r)}>
                  {r === 'all' ? '全部' : r}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="sc-loading" role="status">
              正在整理你的收藏册…
            </div>
          ) : !visible.length ? (
            <div className="sc-empty">
              <Layers3 size={34} />
              <h3>
                {tab === 'favorites'
                  ? '把心动的卡，放在这里。'
                  : unique === 0 && tab === 'owned'
                    ? '你的第一张卡，正在路上。'
                    : '这个角落，还没有卡片。'}
              </h3>
              <p>
                {tab === 'favorites'
                  ? '打开已拥有的卡片，点击「放入展柜」。'
                  : '每通过 5 道不同的新题，获得一次抽卡机会。'}
              </p>
              <button
                className="sc-text-button"
                onClick={() => {
                  setTab('catalog');
                  setSeries('all');
                  setRarity('all');
                  setSearch('');
                }}
              >
                先逛逛全卡图鉴 <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="sc-card-grid">
              {visible.map((card) => (
                <button
                  key={card.id}
                  className="sc-card-button"
                  onClick={() => setDetail(card)}
                  aria-label={`${card.name}，${card.rarity}，${owned[card.id] ? `已拥有 ${owned[card.id]} 张` : '尚未收集'}`}
                >
                  <StudyCardFace
                    card={card}
                    copies={owned[card.id] ?? 0}
                    locked={!owned[card.id]}
                  />
                  {collection?.favorites.includes(card.id) && (
                    <span className="sc-favorite-dot">
                      <Star size={12} fill="currentColor" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
        <footer className="sc-footer">
          <Sparkles size={13} />
          学习有迹可循，成长值得珍藏。<span>THE STUDY COLLECTION · VOL. 01</span>
        </footer>
      </main>
      {rules && (
        <Dialog title="收集规则" onClose={() => setRules(false)} className="sc-rules-dialog">
          <div className="sc-rules">
            <span className="sc-eyebrow">HOW IT WORKS</span>
            <h2>一点努力，一点惊喜。</h2>
            <p>每个系列，都有 R、SR、SSR 三种卡面等级。</p>
            <div className="sc-tier-compare" aria-label="三个卡面等级对比">
              {(['R', 'SR', 'SSR'] as const).map((r) => {
                const card = STUDY_CARDS.find(
                  (c) => c.series === (series === 'all' ? 'mbti' : series) && c.rarity === r,
                )!;
                return (
                  <div key={r}>
                    <StudyCardFace card={card} compact />
                    <strong>
                      {r} · {CARD_FINISHES[r].name}
                    </strong>
                    <small>{CARD_FINISHES[r].description}</small>
                  </div>
                );
              })}
            </div>
            <p>
              每累计通过 5
              道不同题目，获得一次抽卡机会。已通过的题重复提交不重复计数，已有的通过记录也会计入。
            </p>
            <div className="sc-odds">
              {(['R', 'SR', 'SSR'] as const).map((r) => (
                <div key={r}>
                  <b>{r}</b>
                  <strong>{CARD_RULES.rates[r]}%</strong>
                  <small>{CARD_FINISHES[r].name}</small>
                </div>
              ))}
            </div>
            <p>
              基础概率：R 75%、SR 22%、SSR 3%。连续 9 抽未获得 SR 或 SSR，第 10 抽至少 SR；连续 29
              抽未获得 SSR，第 30 抽必得 SSR。触发保底时，实际概率会改变。
            </p>
            <p>
              可以抽到重复卡，重复卡永久保留。累计 1 / 2 / 4 / 7 / 11 张同名卡，对应 1–5
              星。收藏不同卡面达到 5 / 15 / 30 / 60 张，提升收藏家等级。
            </p>
            <p>卡片只作为学习纪念，不影响成绩。MBTI 与星座系列是创意主题。</p>
            <div className="sc-pity">
              <span>
                距离 SR 或以上保底<b>最多 {10 - (collection?.sinceSR ?? 0)} 抽</b>
              </span>
              <span>
                距离 SSR 保底<b>最多 {30 - (collection?.sinceSSR ?? 0)} 抽</b>
              </span>
            </div>
          </div>
        </Dialog>
      )}
      {detail && (
        <Dialog title={detail.name} onClose={() => setDetail(null)} className="sc-detail">
          <StudyCardFace card={detail} copies={owned[detail.id] ?? 0} />
          <div className="sc-detail-copy">
            <span className="sc-eyebrow">
              {CARD_SERIES.find((s) => s.id === detail.series)?.name} / {detail.rarity}
            </span>
            <h2>{detail.name}</h2>
            <span className="sc-finish-label">{CARD_FINISHES[detail.rarity].description}</span>
            <p>{detail.caption}</p>
            {detail.credit && <small>{detail.credit}</small>}
            <div className="sc-detail-count">
              <strong>
                {owned[detail.id] ?? 0}
                <small> 张</small>
              </strong>
              <span>
                {owned[detail.id]
                  ? `${cardLevel(owned[detail.id])} 星收藏 · 重复卡会累积`
                  : '尚未收集 · 先与画面相遇'}
              </span>
            </div>
            {owned[detail.id] ? (
              <button
                className="sc-primary"
                disabled={saving}
                onClick={() => void toggleFavorite(detail)}
              >
                <Star
                  size={16}
                  fill={collection?.favorites.includes(detail.id) ? 'currentColor' : 'none'}
                />
                {collection?.favorites.includes(detail.id) ? '从展柜取下' : '放入心动展柜'}
              </button>
            ) : (
              <button className="sc-secondary" onClick={() => setDetail(null)}>
                继续逛逛
              </button>
            )}
            {error && (
              <p role="alert" className="sc-error">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {draw && drawn && (
        <Dialog
          title={revealed ? `获得 ${drawn.name}` : '打开你的新卡片'}
          onClose={() => {
            setDraw(null);
            setRevealed(false);
          }}
          className={`sc-reveal sc-reveal-${drawn.rarity.toLowerCase()}`}
        >
          <div className="sc-reveal-content">
            <span className="sc-eyebrow">
              {revealed ? 'A NEW CHAPTER IN YOUR COLLECTION' : 'A LITTLE WONDER IS WAITING'}
            </span>
            <h2>
              {revealed
                ? draw.isNew
                  ? '新的相遇。'
                  : '熟悉的心动，再来一次。'
                : '这一刻，属于你。'}
            </h2>
            {!revealed ? (
              <button
                className="sc-sealed-card"
                onClick={() => setRevealed(true)}
                aria-label="翻开卡片"
              >
                <div className="sc-seal-orbit" />
                <Sparkles size={54} />
                <span>SYNTARA</span>
                <small>轻触，翻开惊喜</small>
              </button>
            ) : (
              <div className="sc-revealed-card">
                <StudyCardFace card={drawn} copies={draw.copies} />
              </div>
            )}
            <p aria-live="polite">
              {revealed
                ? `${drawn.rarity} · ${drawn.name}${draw.isNew ? ' · 首次收集' : ` · 现有 ${draw.copies} 张`}`
                : '卡片已经收好，随时可以在收藏册里找到。'}
            </p>
            {revealed && (
              <button
                className="sc-primary"
                onClick={() => {
                  setDraw(null);
                  setTab('owned');
                  setSeries('all');
                  setRarity('all');
                  setSearch('');
                }}
              >
                <Check size={17} />
                收入收藏册
              </button>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
