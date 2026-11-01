import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, MessageCircle } from 'lucide-react';
import type { CourseLearningPage } from '../lib/native-launch';
import { LearningToolIcon } from './LearningToolIcon';

/** Each tab carries its marble colour from marble-tokens.css. */
const tools = {
  problems: { label: '题库', tone: 'blue' },
  notes: { label: '笔记', tone: 'amber' },
  progress: { label: '进度', tone: 'green' },
  memory: { label: '记忆', tone: 'purple' },
  classroom: { label: '课堂', tone: 'pink' },
  materials: { label: '上传', tone: 'blue' },
};

/**
 * 聊天是第一个标签，学习页是它后面的标签；同一时间只看一个，
 * 选中的标签占满整个主区域，不和聊天左右分栏。
 * activePage 为 null 时停在聊天标签上。
 * compact（手机和窄窗口）时没有标签条：左边是返回，中间是页名，点它换别的学习页。
 */
export function LearningWorkspaceTabs({
  compact = false,
  onBack,
  onOpenMenu,
  pages,
  activePage,
  onSelect,
  onChat,
  renderPage,
}: {
  compact?: boolean;
  onBack?: () => void;
  onOpenMenu?: (anchor: HTMLButtonElement) => void;
  pages: CourseLearningPage[];
  activePage: CourseLearningPage | null;
  onSelect: (page: CourseLearningPage) => void;
  onChat: () => void;
  renderPage: (page: CourseLearningPage) => ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef(new Map<CourseLearningPage | 'chat', HTMLButtonElement>());
  const visiblePages = compact ? pages : (Object.keys(tools) as CourseLearningPage[]);
  const order: (CourseLearningPage | 'chat')[] = ['chat', ...visiblePages];
  const current = activePage ?? 'chat';
  useEffect(() => {
    tabRefs.current.get(current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  const select = (tab: CourseLearningPage | 'chat') => {
    if (tab === 'chat') onChat();
    else onSelect(tab);
  };
  const tabProps = (tab: CourseLearningPage | 'chat', index: number) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) tabRefs.current.set(tab, element);
      else tabRefs.current.delete(tab);
    },
    type: 'button' as const,
    role: 'tab',
    id: id + '-tab-' + tab,
    'aria-controls': tab === 'chat' || !pages.includes(tab) ? undefined : id + '-panel-' + tab,
    'aria-selected': tab === current,
    tabIndex: tab === current ? 0 : -1,
    onClick: () => select(tab),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      let next: CourseLearningPage | 'chat' | undefined;
      if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
      if (event.key === 'ArrowLeft') next = order[(index + order.length - 1) % order.length];
      if (event.key === 'Home') next = order[0];
      if (event.key === 'End') next = order.at(-1);
      if (next) {
        event.preventDefault();
        select(next);
        tabRefs.current.get(next)?.focus();
      }
    },
  });

  return (
    <aside
      className={activePage ? 'learning-workspace is-page' : 'learning-workspace is-chat'}
      aria-label="学习工作区"
    >
      {compact ? (
        activePage ? (
          <div className="learning-workspace-bar is-compact">
            <button
              type="button"
              className="phone-glass-button learning-workspace-back"
              onClick={onBack ?? onChat}
              aria-label="返回聊天"
              data-onboarding="page-back"
            >
              <ChevronLeft size={22} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="learning-workspace-title"
              aria-haspopup="menu"
              data-tone={tools[activePage].tone}
              onClick={(event) => onOpenMenu?.(event.currentTarget)}
            >
              <LearningToolIcon tool={activePage} />
              <span>{tools[activePage].label}</span>
              <ChevronDown size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : null
      ) : (
        <div className="learning-workspace-bar">
          <div className="learning-workspace-tabs" role="tablist" aria-label="学习标签页">
            <div
              className={
                current === 'chat'
                  ? 'learning-workspace-tab learning-workspace-tab-chat is-active'
                  : 'learning-workspace-tab learning-workspace-tab-chat'
              }
              data-tone="chat"
            >
              <button
                {...tabProps('chat', 0)}
                title="聊天"
                aria-label="聊天"
                data-onboarding="chat-tab"
              >
                <i className="learning-workspace-marble" aria-hidden>
                  <MessageCircle size={14} strokeWidth={1.9} />
                </i>
                <span>聊天</span>
              </button>
            </div>
            {visiblePages.map((page, index) => {
              const { label, tone } = tools[page];
              return (
                <div
                  key={page}
                  className={
                    page === current ? 'learning-workspace-tab is-active' : 'learning-workspace-tab'
                  }
                  data-tone={tone}
                >
                  <button
                    {...tabProps(page, index + 1)}
                    title={label}
                    data-onboarding={`learning-tab-${page}`}
                  >
                    <LearningToolIcon tool={page} />
                    <span>{label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="learning-workspace-body">
        {pages.map((page) => (
          <div
            key={page}
            className="learning-workspace-panel"
            role={compact ? undefined : 'tabpanel'}
            id={id + '-panel-' + page}
            aria-labelledby={compact ? undefined : id + '-tab-' + page}
            aria-label={compact ? tools[page].label : undefined}
            hidden={page !== activePage}
            inert={page !== activePage}
          >
            {renderPage(page)}
          </div>
        ))}
      </div>
    </aside>
  );
}
