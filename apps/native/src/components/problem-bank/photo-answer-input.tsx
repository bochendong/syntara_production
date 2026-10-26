import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Replace, X } from 'lucide-react';
import {
  MAX_PHOTO_SOURCE_BYTES,
  preparePhotoAnswer,
} from '../../../../../lib/problem-bank/photo-answer';
import type { PhotoAnswerImage } from '../../data/local-problem-grading';

type Props = {
  containerId: string;
  images: PhotoAnswerImage[];
  disabled: boolean;
  onChange: (images: PhotoAnswerImage[]) => void;
  onBusyChange: (busy: boolean) => void;
};

export function PhotoAnswerInput({ containerId, images, disabled, onChange, onBusyChange }: Props) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.getElementById(containerId));
  }, [containerId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<string | null>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<PhotoAnswerImage | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  useEffect(() => {
    if (view) dialogRef.current?.showModal();
  }, [view]);

  return (
    <div className="pp-photo-answer">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        aria-label="选择作答图片"
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (!files.length) return;
          const replaceId = replaceRef.current;
          const picked = replaceId ? files.slice(0, 1) : files;
          if (!replaceId && images.length + picked.length > 4) {
            setError('最多上传 4 张作答图片。');
            return;
          }
          setError('');
          setBusy(true);
          onBusyChange(true);
          try {
            const prepared: PhotoAnswerImage[] = [];
            for (const file of picked) {
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
                throw new Error('请选择 JPG、PNG 或 WebP 图片。');
              if (file.size > MAX_PHOTO_SOURCE_BYTES) throw new Error('单张原图不能超过 12 MB。');
              prepared.push(await preparePhotoAnswer(file));
            }
            if (alive.current)
              onChange(
                replaceId
                  ? images.map((image) => (image.id === replaceId ? prepared[0] : image))
                  : [...images, ...prepared],
              );
          } catch (cause) {
            if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            if (alive.current) {
              setBusy(false);
              onBusyChange(false);
            }
          }
        }}
      />
      <button
        type="button"
        className="pp-run-button pp-photo-upload"
        disabled={disabled || busy || images.length >= 4}
        onClick={() => {
          replaceRef.current = null;
          inputRef.current?.click();
        }}
      >
        <ImagePlus size={14} />
        {busy ? '处理图片…' : '上传作答'}
      </button>
      {container && images.length
        ? createPortal(
            <div className="pp-photo-thumbnails" aria-label="作答图片">
              {images.map((image, index) => (
                <div className="pp-photo-item" key={image.id}>
                  <button
                    type="button"
                    className="pp-photo-preview"
                    aria-label={`查看作答图片 ${index + 1}`}
                    onClick={() => setView(image)}
                  >
                    <img src={image.dataUrl} alt={`作答图片 ${index + 1}`} />
                  </button>
                  <span title={image.name}>{image.name}</span>
                  <button
                    type="button"
                    aria-label={`替换作答图片 ${index + 1}`}
                    disabled={disabled || busy}
                    onClick={() => {
                      replaceRef.current = image.id;
                      inputRef.current?.click();
                    }}
                  >
                    <Replace size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除作答图片 ${index + 1}`}
                    disabled={disabled || busy}
                    onClick={() => onChange(images.filter((item) => item.id !== image.id))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>,
            container,
          )
        : null}
      {container && error
        ? createPortal(
            <p role="alert" className="native-problem-practice-error">
              {error}
            </p>,
            container,
          )
        : null}
      {view ? (
        <dialog
          ref={dialogRef}
          className="pp-photo-dialog"
          aria-label="作答图片预览"
          onKeyDown={(event) => event.stopPropagation()}
          onClose={() => setView(null)}
        >
          <button
            type="button"
            aria-label="关闭图片预览"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={20} />
          </button>
          <img src={view.dataUrl} alt={view.name} />
        </dialog>
      ) : null}
    </div>
  );
}
