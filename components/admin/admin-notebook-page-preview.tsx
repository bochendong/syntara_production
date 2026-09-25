'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import type { SlideContent } from '@/lib/types/stage';

const ThumbnailSlide = dynamic(
  () =>
    import('@/components/slide-renderer/components/ThumbnailSlide').then(
      (module) => module.ThumbnailSlide,
    ),
  { ssr: false },
);

export function AdminNotebookPagePreview({ content }: { content: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(240, Math.floor(node.clientWidth))),
    );
    observer.observe(node);
    setWidth(Math.max(240, Math.floor(node.clientWidth)));
    return () => observer.disconnect();
  }, []);

  const value =
    content && typeof content === 'object' ? (content as Record<string, unknown>) : null;
  const canvas = value?.canvas;
  if (value?.type === 'markdown' && typeof value.markdown === 'string') {
    return <MessageResponse>{value.markdown}</MessageResponse>;
  }
  if (
    value?.type === 'slide' &&
    canvas &&
    typeof canvas === 'object' &&
    Array.isArray((canvas as Record<string, unknown>).elements)
  ) {
    const slide = (value as unknown as SlideContent).canvas;
    return (
      <div ref={container} className="w-full overflow-hidden rounded-lg border bg-white">
        <ThumbnailSlide
          slide={slide}
          size={width}
          viewportSize={slide.viewportSize || 1000}
          viewportRatio={slide.viewportRatio || 9 / 16}
        />
      </div>
    );
  }
  return <p className="text-sm text-slate-500">此页为互动内容，暂不提供静态预览。</p>;
}
