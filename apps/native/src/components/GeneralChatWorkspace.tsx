import type { CourseLearningPage } from '../lib/native-launch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, PanelLeft, SquarePen, X } from 'lucide-react';
import { ChatScopePicker } from './ChatScopePicker';
import { VoiceInputButton } from './VoiceInputButton';
import { useChatWorkspaceShell, usePublishChatSidebar } from './ChatWorkspaceShell';
import { PhoneChatDrawer } from './CourseWorkspace';
import { ChatRichText } from './chat-rich/ChatRichText';
import {
  generalChatClient,
  type GeneralChatClient,
  type GeneralConversation,
  type GeneralMessage,
} from '../data/general-chat';
import { detectChatSurface } from '../ai/chat';
import type { ChatResponseStrength } from '../data/ai-client';
import type { LocalCourseSummary } from '../domain/models';
import { usePhoneLayout } from '../lib/use-phone-layout';
import { useBackDismiss } from '../lib/use-back-dismiss';
import { usePhoneKeyboardInset } from '../lib/use-phone-keyboard';
import './general-chat.css';

export function GeneralChatWorkspace({
  homeHref,
  initialConversationId,
  onOpenRecentChat,
  initialDraft = '',
  onChangeChatScope,
  courses,
  onCreateCourse,
  onCreateCourseChat,
  onOpenCourseTool,
  responseStrength,
  client = generalChatClient,
}: {
  homeHref?: string;
  initialConversationId?: string | null;
  onOpenRecentChat?: (courseId: string | null, conversationId: string) => void;
  initialDraft?: string;
  onChangeChatScope?: (courseId: string | null, draft: string) => void;
  courses: LocalCourseSummary[];
  onCreateCourse: () => void;
  onCreateCourseChat: (id: string) => void;
  onOpenCourseTool: (courseId: string, page: CourseLearningPage) => void;
  responseStrength: ChatResponseStrength;
  client?: GeneralChatClient;
}) {
  const phone = usePhoneLayout();
  const chatShell = useChatWorkspaceShell();
  const [sidebarOpen, setSidebarOpen] = useState(!phone);
  const sidebarVisible = chatShell ? !chatShell.collapsed : sidebarOpen;
  const [conversations, setConversations] = useState<GeneralConversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<GeneralMessage[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<{ id: string; message: GeneralMessage } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const pinnedToBottom = useRef(true);
  const sidebarRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useBackDismiss(phone && sidebarOpen, () => setSidebarOpen(false));
  const scrollToBottom = useCallback(() => {
    const element = contentRef.current;
    if (element && pinnedToBottom.current) element.scrollTop = element.scrollHeight;
  }, []);
  usePhoneKeyboardInset(true, workspaceRef, scrollToBottom);

  const invalidateRequests = useCallback(() => {
    request.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const startupRequest = ++request.current;
    void client
      .list()
      .then(async (rows) => {
        if (!cancelled) setConversations(rows);
        if (initialConversationId && rows.some((row) => row.id === initialConversationId)) {
          const history = await client.load(initialConversationId);
          if (!cancelled && startupRequest === request.current) {
            setSelected(initialConversationId);
            setMessages(history);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '聊天记录暂时无法加载');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      controller.current?.abort();
      invalidateRequests();
    };
  }, [client, invalidateRequests, initialConversationId]);
  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);
  useEffect(() => {
    setSidebarOpen(!phone);
  }, [phone]);
  useEffect(() => {
    if (!phone || !sidebarOpen) return;
    const previous = document.activeElement;
    const panel = sidebarRef.current;
    const buttons = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, summary, [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
    buttons()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
      if (event.key === 'Tab') {
        const items = buttons();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [phone, sidebarOpen]);

  const updateSummary = (row: GeneralConversation) =>
    setConversations((current) => [row, ...current.filter((item) => item.id !== row.id)]);
  const newChat = () => {
    if (busy || pendingSave) return;
    request.current++;
    setLoading(false);
    pinnedToBottom.current = true;
    setSelected(null);
    setMessages([]);
    setDraft('');
    setStreaming('');
    setError(null);
    if (phone) setSidebarOpen(false);
    textareaRef.current?.focus();
  };
  const selectChat = async (id: string) => {
    if (busy || pendingSave) return;
    if (id === selected) {
      if (phone) setSidebarOpen(false);
      return;
    }
    const generation = ++request.current;
    setLoading(true);
    setError(null);
    if (phone) setSidebarOpen(false);
    try {
      const rows = await client.load(id);
      if (mounted.current && generation === request.current) {
        setSelected(id);
        pinnedToBottom.current = true;
        setMessages(rows);
        setStreaming('');
        setDraft('');
      }
    } catch (cause) {
      if (mounted.current && generation === request.current)
        setError(cause instanceof Error ? cause.message : '聊天暂时无法打开');
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  };
  const deleteChat = async (conversation: GeneralConversation) => {
    if (busy || pendingSave) return;
    try {
      await client.remove(conversation.id);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (selected === conversation.id) newChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试');
    }
  };
  const respond = async (id: string, history: GeneralMessage[]) => {
    if (!mounted.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setStreaming('');
    const text = await client.reply(
      history,
      detectChatSurface(phone),
      responseStrength,
      (delta) => {
        if (mounted.current && !abort.signal.aborted) setStreaming((current) => current + delta);
      },
      abort.signal,
    );
    const message: GeneralMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      createdAt: Date.now(),
    };
    if (mounted.current) {
      setMessages([...history, message]);
      setStreaming('');
      setPendingSave({ id, message });
    }
    const summary = await client.append(id, message);
    if (mounted.current) {
      updateSummary(summary);
      setPendingSave(null);
    }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || text.length > 6000 || busy || loading || pendingSave) return;
    setBusy(true);
    setError(null);
    try {
      let id = selected;
      if (!id) {
        const conversation = await client.create(text.slice(0, 80));
        if (!mounted.current) return;
        id = conversation.id;
        setSelected(id);
        updateSummary(conversation);
      }
      const message: GeneralMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        createdAt: Date.now(),
      };
      const saved = await client.append(id, message);
      if (!mounted.current) return;
      updateSummary(saved);
      const history = [...messages, message];
      pinnedToBottom.current = true;
      setMessages(history);
      setDraft('');
      await respond(id, history);
    } catch (cause) {
      if (mounted.current && !controller.current?.signal.aborted)
        setError(cause instanceof Error ? cause.message : '暂时无法回复，请重试');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const retry = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (pendingSave) {
        updateSummary(await client.append(pendingSave.id, pendingSave.message));
        setPendingSave(null);
      } else await respond(selected, messages);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '请稍后重试');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const open = (action: () => void) => {
    if (phone) setSidebarOpen(false);
    action();
  };
  const drawer = (
    <PhoneChatDrawer
      onOpenRecentChat={onOpenRecentChat}
      generalChatClient={client}
      homeHref={homeHref}
      learningActions={[]}
      courses={courses}
      selectedCourseId=""
      selectedCourseAvatarUrl=""
      conversations={conversations}
      selectedConversationId={selected}
      onCreateCourse={() => open(onCreateCourse)}
      onNewChat={newChat}
      onCreateCourseChat={(id) => open(() => onCreateCourseChat(id))}
      onOpenCourseTool={(id, page) => open(() => onOpenCourseTool(id, page))}
      newChatDisabled={busy || Boolean(pendingSave)}
      onSelectConversation={(id) => void selectChat(id)}
      onDeleteConversation={(conversation) => void deleteChat(conversation)}
    />
  );
  usePublishChatSidebar(drawer);
  const title = conversations.find((row) => row.id === selected)?.title || '新聊天';

  return (
    <section
      ref={workspaceRef}
      className={`course-workspace is-split general-chat-workspace${chatShell ? ' has-persistent-sidebar' : ''}${sidebarVisible ? ' general-sidebar-open' : ' general-sidebar-collapsed'}`}
      aria-label="普通聊天工作台"
    >
      <main className="conversation-workspace">
        <header className="phone-chat-header">
          <button
            type="button"
            className="phone-glass-button"
            aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
            aria-expanded={sidebarVisible}
            data-onboarding={sidebarVisible ? undefined : 'drawer'}
            onClick={() =>
              chatShell ? chatShell.toggleSidebar() : setSidebarOpen((value) => !value)
            }
          >
            <PanelLeft size={20} />
          </button>
          <div className="phone-chat-title">
            <span>
              <strong>Syntara</strong>
              <small>{title}</small>
            </span>
          </div>
          <button
            type="button"
            className="phone-chat-new"
            aria-label="新聊天"
            onClick={newChat}
            disabled={busy || Boolean(pendingSave)}
          >
            <SquarePen size={18} aria-hidden />
            <span>新聊天</span>
          </button>
        </header>
        <div
          className="conversation-content"
          ref={contentRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            pinnedToBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
          aria-busy={busy || loading}
        >
          {!messages.length && !streaming ? (
            <div className="general-chat-welcome">
              <span className="general-chat-orb">
                <MessageCircle size={26} strokeWidth={1.5} />
              </span>
              <h1>今天想聊些什么？</h1>
              <p>直接开始聊天，或在侧边栏新建课程。</p>
              <span>这里的聊天不会归档到任何课程。</span>
            </div>
          ) : (
            <div className="message-stream general-message-stream">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`general-message general-message-${message.role}`}
                >
                  <span className="general-message-author">
                    {message.role === 'user' ? '你' : 'Syntara'}
                  </span>
                  <ChatRichText text={message.text} />
                </article>
              ))}
              {busy || streaming ? (
                <article
                  className="general-message general-message-assistant"
                  aria-label="Syntara 正在回复"
                >
                  <span className="general-message-author">Syntara</span>
                  {streaming ? (
                    <ChatRichText text={streaming} />
                  ) : (
                    <span role="status">正在思考…</span>
                  )}
                </article>
              ) : null}
            </div>
          )}
        </div>
        <footer className="conversation-composer-footer">
          {error ? (
            <div className="general-chat-error" role="alert">
              {error}
              {pendingSave ? '（回复尚未保存）' : ''}
              <button
                type="button"
                onClick={() => {
                  if (selected && (pendingSave || messages.at(-1)?.role === 'user')) void retry();
                  else {
                    setError(null);
                    void client
                      .list()
                      .then(setConversations)
                      .catch((cause) => setError(String(cause)));
                  }
                }}
                disabled={busy}
              >
                重试
              </button>
            </div>
          ) : null}
          {!error && !busy && messages.at(-1)?.role === 'user' ? (
            <button className="general-retry" type="button" onClick={() => void retry()}>
              重新生成回复
            </button>
          ) : null}
          <form
            className="conversation-composer general-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={6000}
              rows={2}
              aria-label="聊天消息"
              placeholder="给 Syntara 发消息"
              disabled={busy || Boolean(pendingSave)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <ChatScopePicker
              courses={courses}
              courseId={null}
              locked={loading || busy || Boolean(pendingSave) || messages.length > 0}
              onChange={onChangeChatScope ? (id) => onChangeChatScope(id, draft) : undefined}
            />
            <VoiceInputButton
              disabled={busy || Boolean(pendingSave)}
              onText={(text) => {
                setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
                textareaRef.current?.focus();
              }}
            />
            <button
              type="submit"
              className="composer-send-button"
              aria-label="发送消息"
              disabled={busy || loading || !draft.trim() || Boolean(pendingSave)}
            >
              <ArrowUp size={20} />
            </button>
          </form>
        </footer>
      </main>
      {phone && sidebarOpen ? (
        <button
          type="button"
          className="general-sidebar-backdrop"
          aria-label="关闭侧边栏"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      {!chatShell ? (
        <aside
          className="workspace-sidebar workspace-sidebar-left general-chat-sidebar"
          ref={sidebarRef}
          role={phone ? 'dialog' : undefined}
          aria-modal={phone && sidebarOpen ? true : undefined}
          aria-label="聊天与课程侧边栏"
          inert={!sidebarOpen}
        >
          {phone ? (
            <button
              type="button"
              className="general-sidebar-close phone-glass-button"
              aria-label="关闭侧边栏"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={20} />
            </button>
          ) : null}
          {drawer}
        </aside>
      ) : null}
    </section>
  );
}
