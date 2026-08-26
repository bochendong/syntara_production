import type { CSSProperties } from 'react';
import { getLearnBackground, type LearnBackgroundId } from '@/lib/learn/learn-backgrounds';
import { cn } from '@/lib/utils';

type LearnBackgroundVisualProps = {
  backgroundId: LearnBackgroundId;
  className?: string;
  preview?: boolean;
};

export function LearnBackgroundVisual({
  backgroundId,
  className,
  preview = false,
}: LearnBackgroundVisualProps) {
  const background = getLearnBackground(backgroundId);
  const style: CSSProperties = {
    backgroundColor: '#e8eef5',
    backgroundImage: `url("${preview ? background.previewUrl : background.imageUrl}")`,
  };
  return (
    <div
      className={cn('bg-cover bg-center', className)}
      style={style}
      data-learn-background={background.id}
      aria-hidden="true"
    />
  );
}
