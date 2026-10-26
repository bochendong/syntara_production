'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './problem-image-preview.css';

type ProblemImage = {
  id: string;
  src: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
};

function ImagePreview({
  image,
  onDismiss,
  trigger,
}: {
  image: ProblemImage;
  onDismiss: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = dialog.current;
    const thumbnail = trigger.current;
    element?.showModal();
    return () => {
      element?.close();
      thumbnail?.focus();
    };
  }, [trigger]);

  return createPortal(
    <dialog
      ref={dialog}
      className="problem-image-preview"
      aria-label="题目图片放大预览"
      onClose={onDismiss}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      // The underlying practice overlay also handles Tab/Escape; only this modal should receive them.
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <header className="problem-image-preview-toolbar">
        <span>图片预览</span>
        <div className="problem-image-preview-actions">
          <button
            type="button"
            aria-label="缩小图片"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            −
          </button>
          <output aria-live="polite" aria-label="图片缩放比例">
            {Math.round(zoom * 100)}%
          </output>
          <button
            type="button"
            aria-label="放大图片"
            disabled={zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
          >
            +
          </button>
          <button type="button" onClick={() => setZoom(1)}>
            适应窗口
          </button>
          <button
            type="button"
            aria-label="关闭题目图片预览"
            className="problem-image-preview-close"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      </header>
      <div
        className="problem-image-preview-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) onDismiss();
        }}
      >
        <div
          className="problem-image-preview-canvas"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onDismiss();
          }}
        >
          <img src={image.src} alt={image.alt || image.caption || '题目图片'} draggable={false} />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/** The same preview works in the web renderer and the native/browser practice app. */
export function ZoomableProblemImage({ image }: { image: ProblemImage }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="problem-image-thumbnail"
        aria-label={`放大图片：${image.alt || image.caption || '题目配图'}`}
        aria-haspopup="dialog"
        title="点击放大"
        onClick={() => setOpen(true)}
      >
        <img
          src={image.src}
          alt={image.alt || image.caption || image.id}
          width={image.width || undefined}
          height={image.height || undefined}
          loading="lazy"
          decoding="async"
          className="problem-image-thumbnail-img"
        />
      </button>
      {open ? (
        <ImagePreview image={image} trigger={trigger} onDismiss={() => setOpen(false)} />
      ) : null}
    </>
  );
}
