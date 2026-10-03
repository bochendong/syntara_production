'use client';

import { useId, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { NotebookProblemImageAsset } from '@/lib/problem-bank';
import { MAX_PHOTO_SOURCE_BYTES, preparePhotoAnswer } from '@/lib/problem-bank/photo-answer';
import { Button } from '@/components/ui/button';
import { ProblemImageAssets } from './problem-rich-text';

export function ProblemImageEditor({
  images,
  locale,
  disabled,
  onChange,
  onBusyChange,
}: {
  images: NotebookProblemImageAsset[];
  locale: 'zh-CN' | 'en-US';
  disabled?: boolean;
  onChange: (images: NotebookProblemImageAsset[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const zh = locale === 'zh-CN';

  const addImages = async (files: File[]) => {
    if (processing.current || disabled || !files.length) return;
    setError('');
    if (images.length + files.length > 8) {
      setError(zh ? '每道题最多添加 8 张图片。' : 'Up to 8 images per problem.');
      return;
    }
    if (
      files.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > MAX_PHOTO_SOURCE_BYTES,
      )
    ) {
      setError(
        zh
          ? '请选择 JPG、PNG 或 WebP 图片，每张不超过 12 MB。'
          : 'Choose JPG, PNG or WebP images, up to 12 MB each.',
      );
      return;
    }
    processing.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const next = [...images];
      for (const file of files) {
        const photo = await preparePhotoAnswer(file);
        next.push({
          id: photo.id,
          src: photo.dataUrl,
          alt: photo.name,
          mimeType: photo.mimeType,
          role: 'question',
        });
      }
      // Leave room for the statement and grading data within the request budget.
      if (next.reduce((size, image) => size + image.src.length, 0) > 3_500_000) {
        throw new Error(
          zh
            ? '图片总量过大，请裁剪题图或减少图片数量。'
            : 'Images are too large in total. Crop them or select fewer images.',
        );
      }
      onChange(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : zh
            ? '图片处理失败。'
            : 'Could not process images.',
      );
    } finally {
      processing.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          {zh ? '题目图片' : 'Problem images'} ({images.length}/8)
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || images.length >= 8}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          {busy ? (zh ? '处理中…' : 'Processing...') : zh ? '添加图片' : 'Add images'}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {zh
          ? '支持 JPG、PNG、WebP，每张不超过 12 MB。保存后显示在题面下方，点击缩略图查看大图。'
          : 'JPG, PNG or WebP, up to 12 MB each. Saved images appear below the statement; click to enlarge.'}
      </p>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        disabled={disabled || busy}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          void addImages(files);
        }}
      />
      <ProblemImageAssets images={images} locale={locale} />
      {images.length ? (
        <ul className="space-y-1">
          {images.map((image, index) => (
            <li key={image.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {image.caption || image.alt || `${zh ? '题图' : 'Figure'} ${index + 1}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                aria-label={`${zh ? '删除' : 'Remove'} ${image.caption || image.alt || `${zh ? '题图' : 'Figure'} ${index + 1}`}`}
                onClick={() => onChange(images.filter((_, position) => position !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
