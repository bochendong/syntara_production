import { useEffect, useState } from 'react';

export const PHONE_LAYOUT_QUERY = '(max-width: 600px)';
/** 手机和窄窗口：没有左侧细导航栏和学习标签，学习页一次一页、带返回。 */
export const COMPACT_LAYOUT_QUERY = '(max-width: 1099px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** iPhone 宽度判断：手机端收起独立题库入口，并改用纵向布局。 */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_LAYOUT_QUERY);
}

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}
