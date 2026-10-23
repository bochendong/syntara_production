import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  FileQuestion,
  FolderUp,
  MessageCircle,
  Presentation,
  Target,
  X,
} from 'lucide-react';
import type { CourseLearningPage } from '../lib/native-launch';

/** Each tab carries its marble colour from marble-tokens.css. */
const tools = {
  materials: { label: '资料', icon: FolderUp, tone: 'clear' },
  notes: { label: '笔记', icon: BookOpen, tone: 'blue' },
  progress: { label: '学习进度', icon: Target, tone: 'amber' },
  memory: { label: '学习记忆', icon: Brain, tone: 'purple' },
  classroom: { label: '课堂', icon: Presentation, tone: 'green' },
  problems: { label: '题库', icon: FileQuestion, tone: 'pink' },
};

/**
 * 聊天是第一个标签，学习页是它后面的标签；同一时间只看一个，
 * 选中的标签占满整个主区域，不和聊天左右分栏。
 * activePage 为 null 时停在聊天标签上。
 */
export function LearningWorkspaceTabs({
  pages,
  activePage,
  chatTitle,
  onSelect,
  onClose,
  onChat,
  renderPage,
}: {
  pages: CourseLearningPage[];
  activePage: CourseLearningPage | null;
  chatTitle: string;
  onSelect: (page: CourseLearningPage) => void;
  onClose: (page: CourseLearningPage) => void;
  onChat: () => void;
  renderPage: (page: CourseLearningPage) => ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef(new Map<CourseLearningPage | 'chat', HTMLButtonElement>());
  const order: (CourseLearningPage | 'chat')[] = ['chat', ...pages];
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
    'aria-controls': tab === 'chat' ? undefined : id + '-panel-' + tab,
    'aria-selected': tab === current,
    tabIndex: tab === current ? 0 : -1,
    onClick: () => select(tab),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      let next: CourseLearningPage | 'chat' | undefined;
      if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
      if (event.key === 'ArrowLeft') next = order[(index + order.length - 1) % order.length];
      if (event.key === 'Home') next = order[0];
      if (event.key === 'End') next = order.at(-1);
      if (event.key === 'Delete' && tab !== 'chat') {
        event.preventDefault();
        onClose(tab);
      }
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
            <button {...tabProps('chat', 0)} title={chatTitle} aria-label={'聊天：' + chatTitle}>
              <i className="learning-workspace-marble" aria-hidden>
                <MessageCircle size={14} strokeWidth={1.9} />
              </i>
              <span>{chatTitle}</span>
            </button>
          </div>
          {pages.map((page, index) => {
            const { label, icon: Icon, tone } = tools[page];
            return (
              <div
                key={page}
                className={
                  page === current ? 'learning-workspace-tab is-active' : 'learning-workspace-tab'
                }
                data-tone={tone}
              >
                <button {...tabProps(page, index + 1)} title={label}>
                  <i className="learning-workspace-marble" aria-hidden>
                    <Icon size={14} strokeWidth={1.9} />
                  </i>
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="learning-workspace-close"
                  aria-label={'关闭' + label}
                  onClick={() => {
                    onClose(page);
                    tabRefs.current.get(order[index + 2] ?? order[index])?.focus();
                  }}
                >
                  <X size={12} strokeWidth={2.2} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="learning-workspace-body">
        {pages.map((page) => (
          <div
            key={page}
            className="learning-workspace-panel"
            role="tabpanel"
            id={id + '-panel-' + page}
            aria-labelledby={id + '-tab-' + page}
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
