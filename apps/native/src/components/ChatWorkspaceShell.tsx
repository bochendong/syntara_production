import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import './chat-workspace-shell.css';

type ChatShell = {
  collapsed: boolean;
  toggleSidebar: () => void;
  publishSidebar: (content: ReactNode) => void;
  onLocalNavigation: () => void;
};

const ChatShellContext = createContext<ChatShell | null>(null);

/** The navigation tree stays mounted while the course-specific content changes. */
export function ChatWorkspaceShell({
  enabled,
  children,
  onLocalNavigation,
}: {
  enabled: boolean;
  children: ReactNode;
  onLocalNavigation: () => void;
}) {
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const [collapsed, setCollapsed] = useState(false);
  const publishSidebar = useCallback((content: ReactNode) => setSidebar(content), []);
  const toggleSidebar = useCallback(() => setCollapsed((value) => !value), []);
  const shell = useMemo(
    () => ({ collapsed, toggleSidebar, publishSidebar, onLocalNavigation }),
    [collapsed, toggleSidebar, publishSidebar, onLocalNavigation],
  );

  return (
    <ChatShellContext.Provider value={enabled ? shell : null}>
      {enabled ? (
        <section
          className={`course-workspace is-split persistent-chat-workspace${collapsed ? ' is-sidebar-collapsed' : ''}`}
          aria-label="聊天工作台"
        >
          <aside
            className="workspace-sidebar workspace-sidebar-left"
            aria-label="聊天与课程侧边栏"
            inert={collapsed}
          >
            {sidebar}
          </aside>
          <div className="persistent-chat-content">{children}</div>
        </section>
      ) : (
        children
      )}
    </ChatShellContext.Provider>
  );
}

export function useChatWorkspaceShell() {
  return useContext(ChatShellContext);
}

/** Update handlers and selection without changing the sidebar's React identity. */
export function usePublishChatSidebar(content: ReactNode) {
  const shell = useChatWorkspaceShell();
  const publish = shell?.publishSidebar;
  useLayoutEffect(() => {
    if (publish) publish(content);
    // Keep the last sidebar during asynchronous content loading, until its replacement is ready.
  }, [publish, content]);
}
