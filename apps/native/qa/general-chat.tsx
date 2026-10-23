import type { CourseLearningPage } from '../src/lib/native-launch';
/** Isolated zero-course UI fixture. No authentication, database or model calls. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppNavigationRail } from '../src/components/AppNavigationRail';
import { GlobalCalendarApp } from '../src/components/GlobalCalendarApp';
import { PhoneProfilePage } from '../src/components/PhonePages';
import { useBackDismiss } from '../src/lib/use-back-dismiss';
import { useAvatarTheme } from '../src/lib/use-avatar-theme';
import { resolveNativeCourseAvatar } from '../src/assets';
import type { LocalCourseEvent } from '../src/domain/learning-experiences';
import type { ChatResponseStrength } from '../src/data/ai-client';
import { CourseWorkspace } from '../src/components/CourseWorkspace';
import { getLocalRepository } from '../src/data/repository';
import { GeneralChatWorkspace } from '../src/components/GeneralChatWorkspace';
import { CreateCourseDialog } from '../src/components/CreateCourseDialog';
import type {
  GeneralChatClient,
  GeneralConversation,
  GeneralMessage,
} from '../src/data/general-chat';
import type { LocalCourseSummary, LocalCourseWorkspace } from '../src/domain/models';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/avatar-theme.css';
if (
  !import.meta.env.DEV ||
  '__TAURI_INTERNALS__' in window ||
  !['127.0.0.1', 'localhost'].includes(location.hostname)
)
  throw new Error('Loopback development fixture only.');
const key = 'syntara.qa.general-chat.v1';
const read = (): {
  conversations: GeneralConversation[];
  messages: Record<string, GeneralMessage[]>;
} => JSON.parse(localStorage.getItem(key) || '{"conversations":[],"messages":{}}');
const save = (state: ReturnType<typeof read>) => localStorage.setItem(key, JSON.stringify(state));
const client: GeneralChatClient = {
  async list() {
    return read().conversations;
  },
  async load(id) {
    return read().messages[id] || [];
  },
  async create(title) {
    const state = read(),
      now = Date.now(),
      conversation = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now };
    state.conversations.unshift(conversation);
    state.messages[conversation.id] = [];
    save(state);
    return conversation;
  },
  async append(id, message) {
    const state = read();
    const conversation = state.conversations.find((row) => row.id === id)!;
    conversation.updatedAt = Date.now();
    state.messages[id] = [
      ...(state.messages[id] || []).filter((row) => row.id !== message.id),
      message,
    ];
    save(state);
    return conversation;
  },
  async remove(id) {
    const state = read();
    state.conversations = state.conversations.filter((row) => row.id !== id);
    delete state.messages[id];
    save(state);
  },
  async reply(messages, _surface, _strength, onDelta, signal) {
    if (signal.aborted) throw new Error('Cancelled');
    const text = `已收到：${messages.at(-1)?.text}。这是隔离预览回复，这段聊天不属于任何课程。`;
    onDelta(text);
    return text;
  },
};
const courseKey = 'syntara.qa.general-chat.courses.v1';
function Preview() {
  const { avatarUrl } = useAvatarTheme();
  const [courses, setCourses] = useState<LocalCourseSummary[]>(() =>
      new URLSearchParams(location.search).get('empty') === '1'
        ? []
        : JSON.parse(localStorage.getItem(courseKey) || '[]'),
    ),
    [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [globalPage, setGlobalPage] = useState<'calendar' | 'settings' | null>(null);
  const [events, setEvents] = useState<LocalCourseEvent[]>([]);
  const [responseStrength, setResponseStrength] = useState<ChatResponseStrength>('medium');
  const [learningLaunch, setLearningLaunch] = useState<CourseLearningPage>();
  const [calendarLaunch, setCalendarLaunch] = useState<{ date?: string; create?: boolean }>();
  useBackDismiss(globalPage !== null, () => setGlobalPage(null));
  useEffect(() => {
    if (globalPage !== 'calendar') return;
    let cancelled = false;
    void getLocalRepository()
      .then(async (repository) => {
        const groups = await Promise.all(
          courses.map((course) => repository.listCourseEvents(course.id)),
        );
        if (!cancelled) setEvents(groups.flat());
      })
      .catch((cause) => {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : '日历暂时无法读取');
      });
    return () => {
      cancelled = true;
    };
  }, [globalPage, courses]);
  const [workspace, setWorkspace] = useState<LocalCourseWorkspace | null>(null);
  const request = useRef(0);
  const [draftLaunch, setDraftLaunch] = useState({ text: '', revision: 0 });
  const [initialGeneralConversationId, setInitialGeneralConversationId] = useState<string | null>(
    null,
  );
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null);
  const openCourse = async (
    id: string,
    draft = '',
    fresh = false,
    calendar?: { date?: string; create?: boolean },
    conversationId?: string,
    learningPage?: CourseLearningPage,
  ) => {
    const revision = ++request.current;
    try {
      const repository = await getLocalRepository();
      const next = await repository.loadCourseWorkspace(id);
      if (!next) throw new Error('未找到这门预览课程，请重新创建。');
      if (revision === request.current) {
        setGlobalPage(null);
        setCalendarLaunch(calendar);
        setLearningLaunch(learningPage);
        setWorkspace(next);
        setInitialConversationId(
          conversationId ?? (fresh ? null : (next.conversations[0]?.id ?? null)),
        );
        setDraftLaunch((current) => ({ text: draft, revision: current.revision + 1 }));
        setNotice('');
      }
    } catch (cause) {
      if (revision === request.current)
        setNotice(cause instanceof Error ? cause.message : '课程暂时无法打开');
    }
  };
  const openGeneral = (draft = '', conversationId: string | null = null) => {
    setInitialGeneralConversationId(conversationId);
    setDraftLaunch((current) => ({ text: draft, revision: current.revision + 1 }));
    request.current += 1;
    setWorkspace(null);
    setGlobalPage(null);
  };
  const openRecentChat = (courseId: string | null, conversationId: string) => {
    if (courseId) void openCourse(courseId, '', false, undefined, conversationId);
    else openGeneral('', conversationId);
  };
  const changeScope = (id: string | null, draft: string) => {
    if (id) void openCourse(id, draft, true);
    else openGeneral(draft);
  };
  const refreshWorkspace = async () => {
    if (!workspace) return;
    const revision = request.current;
    const next = await (await getLocalRepository()).loadCourseWorkspace(workspace.course.id);
    if (revision === request.current && next) setWorkspace(next);
  };
  return (
    <div className="syntara-native-shell has-global-navigation">
      <AppNavigationRail
        avatarUrl={avatarUrl}
        active={globalPage ?? 'chat'}
        onOpenChat={() => setGlobalPage(null)}
        onOpenCalendar={() => setGlobalPage('calendar')}
        onOpenSettings={() => setGlobalPage('settings')}
      />
      <div className="app-chat-surface" inert={globalPage !== null}>
        {workspace ? (
          <CourseWorkspace
            generalChatClient={client}
            onOpenRecentChat={openRecentChat}
            key={`${workspace.course.id}:${draftLaunch.revision}`}
            initialDraft={draftLaunch.text}
            initialConversationId={initialConversationId}
            initialPage={calendarLaunch ? 'calendar' : learningLaunch}
            calendarDate={calendarLaunch?.date}
            newEventDate={calendarLaunch?.create ? calendarLaunch.date : undefined}
            onChangeChatScope={changeScope}
            homeHref="http://127.0.0.1:3001/"
            workspace={workspace}
            courses={courses}
            backendLabel="本地预览库"
            onBack={() => openGeneral()}
            onSwitchCourse={(id) => void openCourse(id)}
            onCreateCourseChat={(id) => void openCourse(id, '', true)}
            onOpenCourseTool={(id, page) =>
              void openCourse(id, '', false, undefined, undefined, page)
            }
            onCreateCourse={() => setCreating(true)}
            onNewChat={() => openGeneral()}
            onOpenProblemBank={() => setNotice('题库入口已触发')}
            onOpenPractice={() => setNotice('练习入口已触发')}
            onWorkspaceChanged={refreshWorkspace}
          />
        ) : (
          <GeneralChatWorkspace
            initialConversationId={initialGeneralConversationId}
            onOpenRecentChat={openRecentChat}
            key={draftLaunch.revision}
            initialDraft={draftLaunch.text}
            onChangeChatScope={changeScope}
            homeHref="http://127.0.0.1:3001/"
            client={client}
            courses={courses}
            responseStrength={responseStrength}
            onCreateCourse={() => setCreating(true)}
            onCreateCourseChat={(id) => void openCourse(id, '', true)}
            onOpenCourseTool={(id, page) =>
              void openCourse(id, '', false, undefined, undefined, page)
            }
          />
        )}
      </div>
      {creating ? (
        <CreateCourseDialog
          onCancel={() => setCreating(false)}
          createCourse={async (name, description) => {
            const repository = await getLocalRepository();
            const course = await repository.createCourse({ name, description });
            const summary: LocalCourseSummary = {
              ...course,
              notebookCount: 0,
              problemCount: 0,
              conversationCount: 0,
            };
            const nextCourses = [...courses, summary];
            localStorage.setItem(courseKey, JSON.stringify(nextCourses));
            setCourses(nextCourses);
            return { id: course.id };
          }}
          onCreated={async (id) => {
            setCreating(false);
            await openCourse(id);
          }}
        />
      ) : null}
      {globalPage ? (
        <div className="native-global-page">
          {globalPage === 'calendar' ? (
            <GlobalCalendarApp
              courses={courses}
              events={events}
              onOpenCourse={(id, date, create) => void openCourse(id, '', false, { date, create })}
              onBack={() => setGlobalPage(null)}
            />
          ) : (
            <PhoneProfilePage
              courses={courses}
              currentCourseId={workspace?.course.id ?? ''}
              currentCourseAvatarUrl={
                workspace
                  ? resolveNativeCourseAvatar(workspace.course.id, workspace.course.courseCode)
                  : ''
              }
              conversationCount={courses.reduce((sum, course) => sum + course.conversationCount, 0)}
              responseStrength={responseStrength}
              onResponseStrengthChange={setResponseStrength}
              onOpenCourseJar={(id) => void openCourse(id)}
              onBack={() => setGlobalPage(null)}
            />
          )}
        </div>
      ) : null}
      {notice ? (
        <div className="native-toast" role="status" onClick={() => setNotice('')}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
