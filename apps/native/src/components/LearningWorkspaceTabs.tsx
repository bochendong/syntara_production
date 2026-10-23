import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  FileQuestion,
  MessageCircle,
  Presentation,
  Target,
  X,
} from 'lucide-react';
import type { CourseLearningPage } from '../lib/native-launch';

const tools = {
  notes: { label: '笔记', icon: BookOpen },
  progress: { label: '学习进度', icon: Target },
  memory: { label: '学习记忆', icon: Brain },
  classroom: { label: '课堂', icon: Presentation },
  problems: { label: '题库', icon: FileQuestion },
};

export function LearningWorkspaceTabs({
  pages,
  activePage,
  onSelect,
  onClose,
  onChat,
  renderPage,
}: {
  pages: CourseLearningPage[];
  activePage: CourseLearningPage;
  onSelect: (page: CourseLearningPage) => void;
  onClose: (page: CourseLearningPage) => void;
  onChat: () => void;
  renderPage: (page: CourseLearningPage) => ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef(new Map<CourseLearningPage, HTMLButtonElement>());
  useEffect(() => {
    tabRefs.current.get(activePage)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePage]);
  return (
    <aside className="learning-workspace" aria-label="学习工作区">
      <div className="learning-workspace-bar">
        <button
          className="learning-workspace-chat"
          type="button"
          onClick={onChat}
          aria-label="返回聊天"
        >
          <MessageCircle size={16} />
          <span>聊天</span>
        </button>
        <div className="learning-workspace-tabs" role="tablist" aria-label="学习标签页">
          {pages.map((page, index) => {
            const { label, icon: Icon } = tools[page];
            return (
              <div
                key={page}
                className={
                  page === activePage
                    ? 'learning-workspace-tab is-active'
                    : 'learning-workspace-tab'
                }
              >
                <button
                  ref={(element) => {
                    if (element) tabRefs.current.set(page, element);
                    else tabRefs.current.delete(page);
                  }}
                  type="button"
                  role="tab"
                  id={id + '-tab-' + page}
                  aria-controls={id + '-panel-' + page}
                  aria-selected={page === activePage}
                  tabIndex={page === activePage ? 0 : -1}
                  onClick={() => onSelect(page)}
                  onKeyDown={(event) => {
                    let next: CourseLearningPage | undefined;
                    if (event.key === 'ArrowRight') next = pages[(index + 1) % pages.length];
                    if (event.key === 'ArrowLeft')
                      next = pages[(index + pages.length - 1) % pages.length];
                    if (event.key === 'Home') next = pages[0];
                    if (event.key === 'End') next = pages.at(-1);
                    if (event.key === 'Delete') {
                      event.preventDefault();
                      onClose(page);
                    }
                    if (next) {
                      event.preventDefault();
                      onSelect(next);
                      tabRefs.current.get(next)?.focus();
                    }
                  }}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="learning-workspace-close"
                  aria-label={'关闭' + label}
                  onClick={() => {
                    onClose(page);
                    tabRefs.current.get(pages[index + 1] ?? pages[index - 1])?.focus();
                  }}
                >
                  <X size={13} />
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
