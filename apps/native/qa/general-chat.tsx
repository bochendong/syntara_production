/** Isolated zero-course UI fixture. No authentication, database or model calls. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GeneralChatWorkspace } from '../src/components/GeneralChatWorkspace';
import { CreateCourseDialog } from '../src/components/CreateCourseDialog';
import type {
  GeneralChatClient,
  GeneralConversation,
  GeneralMessage,
} from '../src/data/general-chat';
import type { LocalCourseSummary } from '../src/domain/models';
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
function Preview() {
  const [courses, setCourses] = useState<LocalCourseSummary[]>([]),
    [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <div className="syntara-native-shell">
      <GeneralChatWorkspace
        client={client}
        courses={courses}
        responseStrength="medium"
        onCreateCourse={() => setCreating(true)}
        onSwitchCourse={(id) =>
          setNotice(`已选择课程：${courses.find((course) => course.id === id)?.name}`)
        }
        onOpenCalendar={() => setNotice('总日历入口已触发')}
        onOpenProfile={() => setNotice('我的入口已触发')}
      />
      {creating ? (
        <CreateCourseDialog
          onCancel={() => setCreating(false)}
          createCourse={async (name, description) => {
            const id = crypto.randomUUID(),
              now = Date.now();
            setCourses((current) => [
              ...current,
              {
                id,
                name,
                description,
                language: 'zh-CN',
                tags: [],
                purpose: 'daily',
                university: null,
                courseCode: null,
                createdAt: now,
                updatedAt: now,
                notebookCount: 0,
                problemCount: 0,
                conversationCount: 0,
              },
            ]);
            return { id };
          }}
          onCreated={async () => setCreating(false)}
        />
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
