import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { marbleImages } from '../lib/learning-action-marbles';
import './glass-load-more.css';

/** 每次在本机多显示的行数；和网页分页一样是 30。 */
export const LIST_WINDOW_SIZE = 30;

/**
 * 长列表只渲染前面一段，滚到底再多显示一段。resetKey 变了（换课程、换搜索词）就回到第一段。
 */
export function useListWindow(total: number, resetKey: unknown, size = LIST_WINDOW_SIZE) {
  const [windowState, setWindowState] = useState({ key: resetKey, count: size });
  let count = windowState.count;
  if (!Object.is(windowState.key, resetKey)) {
    count = size;
    setWindowState({ key: resetKey, count });
  }
  const showMore = useCallback(
    () => setWindowState((current) => ({ ...current, count: current.count + size })),
    [size],
  );
  /** 列表里第 index 行还没显示出来时，多显示几段直到它出现（比如从星图点了一颗珠子）。 */
  const reveal = useCallback(
    (index: number) =>
      setWindowState((current) =>
        index < current.count
          ? current
          : { ...current, count: Math.ceil((index + 1) / size) * size },
      ),
    [size],
  );
  return { count, hasHidden: count < total, showMore, reveal };
}

export type LoadMoreState = 'idle' | 'loading' | 'error';

/**
 * 列表末尾（或聊天顶部）的哨兵：离可见区还有一屏左右就触发 onLoadMore。
 * 加载时是一颗转动的小玻璃弹珠，失败时弹珠变成磨砂灰，点一下重试。没有文字。
 */
export function GlassLoadMore({
  onLoadMore,
  state = 'idle',
  rootMargin = '0px 0px 480px 0px',
  placement = 'end',
  watchKey,
}: {
  onLoadMore: () => void | Promise<void>;
  state?: LoadMoreState;
  rootMargin?: string;
  placement?: 'start' | 'end';
  /** 列表长度之类的值：变了就重新检查一次哨兵是否还在可见区。 */
  watchKey?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    onLoadMoreRef.current = onLoadMore;
    stateRef.current = state;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let root: Element | null = element.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) {
      root = root.parentElement;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && stateRef.current === 'idle') void onLoadMoreRef.current();
      },
      { root, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // 加载完成回到 idle、或列表变长后重新观察一次：哨兵仍在可见区就接着加载下一段。
  }, [rootMargin, state, watchKey]);

  return (
    <div
      ref={ref}
      className={`glass-load-more glass-load-more-${placement} is-${state}`}
      aria-live="polite"
    >
      {state === 'loading' ? (
        <img src={marbleImages.blue} alt="" aria-label="正在加载" />
      ) : state === 'error' ? (
        <button type="button" onClick={() => void onLoadMore()} aria-label="重新加载">
          <img src={marbleImages.blue} alt="" />
        </button>
      ) : null}
    </div>
  );
}

/** 原地转动的一颗小玻璃弹珠：所有「正在处理」的地方都用它，不再用转圈图标。 */
export function GlassSpinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <img
      className={`glass-spinner${className ? ` ${className}` : ''}`}
      src={marbleImages.blue}
      width={size}
      height={size}
      alt=""
      aria-hidden
    />
  );
}

/** 首屏还没有数据时的玻璃骨架条，和真实行一样高。 */
export function GlassSkeletonRows({ rows = 4, height = 40 }: { rows?: number; height?: number }) {
  return (
    <div className="glass-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} style={{ height, animationDelay: `${index * 120}ms` }} />
      ))}
    </div>
  );
}
