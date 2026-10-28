import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import {
  MAX_PHOTO_SOURCE_BYTES,
  preparePhotoAnswer,
} from '../../../../../lib/problem-bank/photo-answer';
import type { PhotoAnswerImage } from '../../data/local-problem-grading';

type Props = {
  disabled: boolean;
  maxImageBytes?: number;
  onSubmit: (images: PhotoAnswerImage[]) => Promise<void>;
  onError: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
};

export function PhotoAnswerInput({
  disabled,
  maxImageBytes,
  onSubmit,
  onError,
  onBusyChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting'>('idle');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  return (
    <div className="pp-photo-answer">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label="选择作答图片"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || disabled || phase !== 'idle') return;
          setPhase('preparing');
          onBusyChange(true);
          onError(null);
          try {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
              throw new Error('请选择 JPG、PNG 或 WebP 图片。');
            if (file.size > MAX_PHOTO_SOURCE_BYTES) throw new Error('原图不能超过 12 MB。');
            const image = await preparePhotoAnswer(file, maxImageBytes);
            if (!alive.current) return;
            setPhase('submitting');
            // Submit the prepared image itself, without waiting for a React state update.
            await onSubmit([image]);
          } catch (cause) {
            if (alive.current) onError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            if (alive.current) {
              setPhase('idle');
              onBusyChange(false);
            }
          }
        }}
      />
      <button
        type="button"
        className="pp-run-button pp-photo-upload"
        disabled={disabled || phase !== 'idle'}
        title="选择一张图片，直接提交评分"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={14} />
        {phase === 'preparing' ? '处理图片…' : phase === 'submitting' ? '评分中…' : '图片'}
      </button>
    </div>
  );
}
