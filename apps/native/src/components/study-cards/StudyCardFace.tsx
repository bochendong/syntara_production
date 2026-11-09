import type { CSSProperties } from 'react';
import { Sparkles, Lock, Star } from 'lucide-react';
import { CARD_SERIES, cardLevel, type StudyCard } from '../../../../../lib/study-cards/catalog';
const originals = import.meta.glob<string>('../../assets/class-standing/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const atlases = import.meta.glob<string>('../../assets/study-cards/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function StudyCardFace({
  card,
  copies = 0,
  locked = false,
  compact = false,
}: {
  card: StudyCard;
  copies?: number;
  locked?: boolean;
  compact?: boolean;
}) {
  const cols = card.artColumns ?? 1;
  const rows = card.artRows ?? 1;
  const style: CSSProperties = !card.artColumns
    ? { backgroundImage: `url("${originals[`../../assets/class-standing/${card.art}.webp`]}")` }
    : {
        backgroundImage: `url("${atlases[`../../assets/study-cards/${card.art}.png`]}")`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${((card.index % cols) / (cols - 1)) * 100}% ${(Math.floor(card.index / cols) / (rows - 1)) * 100}%`,
      };
  return (
    <div
      className={`sc-card sc-card-${card.rarity.toLowerCase()}${locked ? ' is-locked' : ''}${compact ? ' is-compact' : ''}`}
    >
      <div className="sc-card-image" style={style} role="img" aria-label={card.name} />
      <div className="sc-card-shade" />
      <div className="sc-card-top">
        <span className="sc-rarity">
          {card.rarity === 'SSR' ? <Sparkles size={12} /> : null}
          {card.rarity}
        </span>
        <span className="sc-card-number">{String(card.index + 1).padStart(2, '0')}</span>
      </div>
      {locked ? (
        <span className="sc-card-lock">
          <Lock size={16} /> 尚未收集
        </span>
      ) : null}
      <div className="sc-card-bottom">
        <span className="sc-card-series">{CARD_SERIES.find((s) => s.id === card.series)?.en}</span>
        <strong>{card.name}</strong>
        {!compact && (
          <div className="sc-card-meta">
            <span>
              {copies
                ? Array.from({ length: cardLevel(copies) }, (_, i) => (
                    <Star key={i} size={10} fill="currentColor" />
                  ))
                : '等待一次相遇'}
            </span>
            {copies > 0 && <b>×{copies}</b>}
          </div>
        )}
      </div>
      {card.rarity !== 'R' && !locked ? <span className="sc-card-foil" aria-hidden /> : null}
    </div>
  );
}
