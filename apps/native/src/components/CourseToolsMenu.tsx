import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CourseLearningPage } from '../lib/native-launch';
import { usePhoneLayout } from '../lib/use-phone-layout';
import { useBackDismiss } from '../lib/use-back-dismiss';
import { LearningToolIcon } from './LearningToolIcon';

const tools = [
  { page: 'materials', label: '资料' },
  { page: 'notes', label: '笔记' },
  { page: 'progress', label: '学习进度' },
  { page: 'memory', label: '学习记忆' },
  { page: 'classroom', label: '课堂' },
  { page: 'problems', label: '题库' },
] as const;

function menuPosition(anchor: HTMLButtonElement, count: number, align: 'end' | 'center') {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(216, window.innerWidth - 24);
  const height = count * 44 + 12;
  const left = align === 'center' ? rect.left + rect.width / 2 - width / 2 : rect.right - width;
  return {
    width,
    left: Math.max(12, Math.min(left, window.innerWidth - width - 12)),
    top:
      rect.bottom + 8 + height <= window.innerHeight - 12
        ? rect.bottom + 8
        : Math.max(12, rect.top - height - 8),
    maxHeight: window.innerHeight - 24,
  };
}

export function CourseToolsMenu({
  anchor,
  courseName,
  onSelect,
  onClose,
  align = 'end',
}: {
  anchor: HTMLButtonElement;
  courseName: string;
  onSelect: (page: CourseLearningPage) => void;
  onClose: () => void;
  /** 'center'：从聊天顶栏中间的标题往下展开。 */
  align?: 'end' | 'center';
}) {
  const phone = usePhoneLayout();
  const items = phone ? tools.filter((tool) => tool.page !== 'problems') : tools;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => menuPosition(anchor, items.length, align));
  useBackDismiss(true, onClose, 30);
  useLayoutEffect(() => {
    const reposition = () => setPosition(menuPosition(anchor, items.length, align));
    reposition();
    menuRef.current?.querySelector('button')?.focus();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [align, anchor, items.length]);
  useEffect(() => {
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={menuRef}
      className={align === 'center' ? 'course-tools-menu is-centered' : 'course-tools-menu'}
      style={position}
      role="menu"
      aria-label={`${courseName}学习工具`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchor.focus();
        } else if (event.key === 'Tab') {
          onClose();
          anchor.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...(menuRef.current?.querySelectorAll('button') ?? [])];
          const index = buttons.findIndex((button) => button === document.activeElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      {items.map(({ page, label }) => (
        <button
          type="button"
          role="menuitem"
          key={page}
          data-onboarding={page === 'materials' ? 'tool-materials' : undefined}
          onClick={() => onSelect(page)}
        >
          <LearningToolIcon tool={page} />
          <span>{label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
