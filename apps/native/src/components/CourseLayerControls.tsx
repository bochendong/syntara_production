import { useState, type ReactNode } from 'react';
import { Copy, Ellipsis, RotateCcw, Trash2, X } from 'lucide-react';

import { releaseNativeCourseVersion } from '../data/platform-api-client';
import type { NativeHiddenCourseContent } from '../data/platform-api-contracts';
import { marbleImages } from '../lib/learning-action-marbles';
import { GlassSpinner } from './GlassLoadMore';
import './course-layers.css';

/** 题目 / 笔记名字旁的小标记：新发布的蓝弹珠、做过后又改过、自己加的。 */
export function LayerBadges({
  fresh,
  updated,
  mine,
}: {
  fresh?: boolean;
  updated?: boolean;
  mine?: boolean;
}) {
  if (!fresh && !updated && !mine) return null;
  return (
    <span className="lay-badges">
      {fresh ? (
        <span className="lay-new" title="新发布">
          <img src={marbleImages.blue} alt="" />新
        </span>
      ) : null}
      {updated ? <span className="lay-tag is-updated">题目已更新</span> : null}
      {mine ? <span className="lay-tag is-mine">我的</span> : null}
    </span>
  );
}

/** 列表项右侧的「…」，打开删除 / 复制。 */
export function LayerItem({
  children,
  label,
  onMore,
}: {
  children: ReactNode;
  label: string;
  onMore?: () => void;
}) {
  if (!onMore) return <>{children}</>;
  return (
    <div className="lay-item">
      {children}
      <button
        type="button"
        className="lay-more"
        aria-label={`${label}：更多`}
        onClick={(event) => {
          event.stopPropagation();
          onMore();
        }}
      >
        <Ellipsis size={16} />
      </button>
    </div>
  );
}

export type LayerMenuTarget = {
  targetType: 'notebook' | 'problem';
  targetId: string;
  title: string;
  mine: boolean;
};

/**
 * 加入的课里一项内容的操作：公有的可以复制到我的、删除（只对自己隐藏）；自己的直接删除。
 */
export function LayerActionMenu({
  target,
  onCopy,
  onRemove,
  onClose,
}: {
  target: LayerMenuTarget;
  onCopy: () => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<'copy' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: 'copy' | 'remove', action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    void action()
      .then(onClose)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null));
  };
  return (
    <div className="phone-confirm-layer" role="presentation">
      <button
        type="button"
        className="phone-confirm-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <section
        className="phone-confirm lay-menu"
        role="dialog"
        aria-modal="true"
        aria-label={target.title}
      >
        <span className="lay-menu-orb" aria-hidden>
          <img src={marbleImages[target.mine ? 'green' : 'blue']} alt="" />
        </span>
        <strong className="phone-confirm-title lay-menu-title">{target.title}</strong>
        <div className="lay-menu-actions">
          {target.mine ? null : (
            <button
              type="button"
              className="phone-confirm-button"
              disabled={busy !== null}
              onClick={() => run('copy', onCopy)}
            >
              {busy === 'copy' ? <GlassSpinner size={16} /> : <Copy size={16} />}
              复制到我的
            </button>
          )}
          <button
            type="button"
            className="phone-confirm-button is-destructive"
            disabled={busy !== null}
            onClick={() => run('remove', onRemove)}
          >
            {busy === 'remove' ? <GlassSpinner size={16} /> : <Trash2 size={16} />}
            删除
          </button>
        </div>
        {/* 公有内容删了只是对自己收起，发布者那份不动。 */}
        <p className="lay-menu-note">
          {error ?? (target.mine ? '删除后不能恢复' : '只对你隐藏，可以恢复')}
        </p>
      </section>
    </div>
  );
}

/** 列表底部的「已隐藏 N」小玻璃珠，点开可恢复。 */
export function HiddenContentShelf({
  items,
  onRestore,
}: {
  items: NativeHiddenCourseContent[];
  onRestore: (item: NativeHiddenCourseContent) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <>
      <button type="button" className="lay-hidden-pill" onClick={() => setOpen(true)}>
        <span className="lay-hidden-stack" aria-hidden>
          {items.slice(0, 3).map((item) => (
            <img key={item.targetId} src={marbleImages.purple} alt="" />
          ))}
        </span>
        已隐藏 {items.length}
      </button>
      {open ? (
        <div className="phone-confirm-layer" role="presentation">
          <button
            type="button"
            className="phone-confirm-backdrop"
            aria-label="关闭"
            onClick={() => setOpen(false)}
          />
          <section className="phone-confirm lay-hidden-sheet" role="dialog" aria-label="已隐藏">
            <header className="lay-hidden-head">
              <strong className="phone-confirm-title">已隐藏</strong>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </header>
            <ul className="lay-hidden-list">
              {items.map((item) => (
                <li key={`${item.targetType}:${item.targetId}`}>
                  <img src={marbleImages.purple} alt="" aria-hidden />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.targetType === 'notebook' ? '笔记' : '题目'}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`恢复：${item.title}`}
                    disabled={busyId !== null}
                    onClick={() => {
                      setBusyId(item.targetId);
                      void onRestore(item)
                        .then(() => {
                          if (items.length <= 1) setOpen(false);
                        })
                        .catch((cause) => console.warn('[course-layers] restore failed', cause))
                        .finally(() => setBusyId(null));
                    }}
                  >
                    {busyId === item.targetId ? (
                      <GlassSpinner size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  );
}

/** 打开加入的课时，机构发了新版就在聊天上方亮一下：「有更新 · +3 题，改了 1 篇笔记」。 */
export function CourseUpdateCard({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="lay-update" role="status">
      <img src={marbleImages.amber} alt="" aria-hidden />
      <span>
        <strong>有更新</strong>
        <small>{text}</small>
      </span>
      <button type="button" aria-label="知道了" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}

/** 机构发布者在当前网页和 App 题库中发布公有内容的版本。 */
export function CourseReleaseButton({ courseId }: { courseId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="lay-release">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage(null);
          void releaseNativeCourseVersion(courseId)
            .then((release) => setMessage(`已发布第 ${release.version} 版：${release.text}`))
            .catch((cause) =>
              setMessage(cause instanceof Error ? cause.message : '发布失败，请重试。'),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <GlassSpinner size={14} /> : null}
        {busy ? '正在发布…' : '发布新版本'}
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
