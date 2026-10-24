import { Check, ChevronDown, MessageCircle } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveNativeCourseAvatar } from '../assets';
import type { LocalCourseSummary } from '../domain/models';

/** A new chat chooses its destination before the first message is sent. */
export function ChatScopePicker({
  courses,
  courseId,
  courseAvatarUrl,
  allowGeneralChat = true,
  locked,
  onChange,
}: {
  courses: LocalCourseSummary[];
  courseId: string | null;
  courseAvatarUrl?: string;
  allowGeneralChat?: boolean;
  locked: boolean;
  onChange?: (courseId: string | null) => void;
}) {
  const course = courses.find((item) => item.id === courseId);
  const label = course ? course.courseCode || course.name : '不在课程中添加';
  const disabled = locked || !onChange;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 300, maxHeight: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = open && !disabled;
  const options = [
    ...(allowGeneralChat ? [{ id: null, label: '不在课程中添加', avatar: null }] : []),
    ...courses.map((item) => ({
      id: item.id,
      label: item.courseCode || item.name,
      avatar:
        (item.id === courseId && courseAvatarUrl) ||
        resolveNativeCourseAvatar(item.id, item.courseCode),
    })),
  ];

  useLayoutEffect(() => {
    if (!visible) return;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(300, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        bottom: window.innerHeight - rect.top + 10,
        width,
        maxHeight: Math.max(80, Math.min(360, rect.top - 22)),
      });
    };
    reposition();
    menuRef.current?.focus();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [visible]);

  const choose = (id: string | null) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (!disabled && id !== courseId) onChange?.(id);
  };
  const contents = (
    <>
      {course ? (
        <img
          src={courseAvatarUrl || resolveNativeCourseAvatar(course.id, course.courseCode)}
          alt=""
          aria-hidden
        />
      ) : (
        <MessageCircle size={20} strokeWidth={1.6} aria-hidden />
      )}
      <span>{label}</span>
      {!disabled ? <ChevronDown className="chat-scope-chevron" size={13} aria-hidden /> : null}
    </>
  );

  return (
    <>
      {disabled ? (
        <span
          className="composer-course-label chat-scope-picker is-locked"
          title={`${label} · 第一条消息发送后不能更改归属`}
        >
          {contents}
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="composer-course-label chat-scope-picker"
          aria-label={`聊天归属：${label}`}
          aria-haspopup="listbox"
          aria-expanded={visible}
          aria-controls={visible ? menuId : undefined}
          onClick={() => {
            setActiveIndex(
              Math.max(
                0,
                options.findIndex((item) => item.id === courseId),
              ),
            );
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(
                Math.max(
                  0,
                  options.findIndex((item) => item.id === courseId),
                ),
              );
              setOpen(true);
            }
          }}
        >
          {contents}
        </button>
      )}
      {visible &&
        createPortal(
          <div className="chat-scope-popover" style={position}>
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label="选择聊天归属"
              aria-activedescendant={`${menuId}-${activeIndex}`}
              tabIndex={0}
              className="chat-scope-options"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.focus();
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(options[activeIndex].id);
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? options.length - 1
                        : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                          options.length;
                  setActiveIndex(next);
                  document
                    .getElementById(`${menuId}-${next}`)
                    ?.scrollIntoView({ block: 'nearest' });
                } else if (event.key === 'Tab') {
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
            >
              {options.map((item, index) => (
                <div
                  key={item.id ?? 'general'}
                  id={`${menuId}-${index}`}
                  role="option"
                  aria-selected={item.id === courseId}
                  className={`chat-scope-option${index === activeIndex ? ' is-active' : ''}`}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(item.id)}
                >
                  <span className="chat-scope-avatar">
                    {item.avatar ? <img src={item.avatar} alt="" /> : <MessageCircle size={19} />}
                  </span>
                  <span className="chat-scope-option-copy">
                    <span>{item.label}</span>
                  </span>
                  {item.id === courseId ? <Check size={16} className="chat-scope-check" /> : null}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
