import { useState, type ReactNode } from 'react';
import { marbleImages } from '../lib/learning-action-marbles';
import './learning-empty-state.css';

type EmptyAction = { label: string; icon?: ReactNode; onClick: () => void };

/** Shared empty content state, with a compact layout for cards and dialogs. */
export function LearningEmptyState({
  title,
  hint,
  compact = false,
  action,
}: {
  title: string;
  hint?: string;
  compact?: boolean;
  /** 页面级空状态的下一步：一颗玻璃药丸按钮。 */
  action?: EmptyAction;
}) {
  // 点一下弹珠会跳一下；什么都没有的时候也有点东西可玩。
  const [hop, setHop] = useState(0);
  const marbles = (
    <>
      <img src={marbleImages.green} alt="" />
      <img src={marbleImages.amber} alt="" />
      <img src={marbleImages.pink} alt="" />
    </>
  );
  return (
    <div className={`learning-empty-state${compact ? ' is-compact' : ''}`}>
      {compact ? (
        <span className="learning-empty-marbles" aria-hidden>
          {marbles}
        </span>
      ) : (
        <button
          type="button"
          className="learning-empty-marbles"
          aria-label="让弹珠跳一下"
          key={hop}
          data-hop={hop ? '1' : undefined}
          onClick={() => setHop((value) => value + 1)}
        >
          {marbles}
        </button>
      )}
      <strong>{title}</strong>
      {hint ? <small>{hint}</small> : null}
      {action ? (
        <button type="button" className="learning-empty-action" onClick={action.onClick}>
          {action.icon}
          <span>{action.label}</span>
        </button>
      ) : null}
    </div>
  );
}
