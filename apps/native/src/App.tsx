import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { CourseWorkspace } from './components/CourseWorkspace';
import { GlassSpinner } from './components/GlassLoadMore';
import { NativeAuthGate } from './components/NativeAccountControl';
import { NotebookLibraryPage } from './components/NotebookLibraryPage';
import { ProblemBankPage, type ProblemBankLaunch } from './components/ProblemBankPage';
import { ProblemPracticePage } from './components/ProblemPracticePage';
import { syncPlatformCourses } from './data/chat-sync';
import { getLocalRepository, type LocalBackendKind } from './data/repository';
import { readPhoneLastChat } from './lib/phone-last-chat';
import { usePhoneLayout } from './lib/use-phone-layout';
import { useAvatarTheme } from './lib/use-avatar-theme';
import type { LocalCourseSummary, LocalCourseWorkspace } from './domain/models';

type AppSurface = 'learn' | 'course' | 'problem-bank' | 'notebook-library' | 'problem-practice';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function updateWithPlatformTransition(update: () => void) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewTransitionDocument = document as ViewTransitionDocument;
  if (!reduceMotion && viewTransitionDocument.startViewTransition) {
    viewTransitionDocument.startViewTransition(update);
    return;
  }
  update();
}

function AuthenticatedApp() {
  const avatarTheme = useAvatarTheme();
  const [courses, setCourses] = useState<LocalCourseSummary[]>([]);
  const [platformCourseIds, setPlatformCourseIds] = useState<string[] | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<LocalCourseWorkspace | null>(null);
  const [surface, setSurface] = useState<AppSurface>('learn');
  const [practiceLaunch, setPracticeLaunch] = useState<ProblemBankLaunch | null>(null);
  const [backendKind, setBackendKind] = useState<LocalBackendKind>('indexeddb');
  const [loading, setLoading] = useState(true);
  const [settledCourseId, setSettledCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const phoneLayout = usePhoneLayout();
  const [autoOpened, setAutoOpened] = useState(false);
  const [lastChat] = useState(readPhoneLastChat);
  const switchingCourse = surface !== 'learn' && settledCourseId !== selectedCourseId;

  const loadCourses = useCallback(async (preferredCourseId?: string) => {
    const repository = await getLocalRepository();
    await repository.bootstrap();
    setPlatformCourseIds(await syncPlatformCourses(repository));
    const loadedCourses = await repository.listCourseSummaries();
    setBackendKind(repository.kind);
    setCourses(loadedCourses);
    setSelectedCourseId((currentCourseId) => {
      if (preferredCourseId && loadedCourses.some((course) => course.id === preferredCourseId)) {
        return preferredCourseId;
      }
      return currentCourseId && loadedCourses.some((course) => course.id === currentCourseId)
        ? currentCourseId
        : null;
    });
  }, []);

  const loadWorkspace = useCallback(async (courseId: string | null) => {
    if (!courseId) {
      setWorkspace(null);
      return;
    }
    const repository = await getLocalRepository();
    const loadedWorkspace = await repository.loadCourseWorkspace(courseId);
    setWorkspace(loadedWorkspace);
  }, []);

  useEffect(() => {
    async function initialize() {
      try {
        await loadCourses();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    }
    void initialize();
  }, [loadCourses]);

  useEffect(() => {
    if (surface === 'learn' || !selectedCourseId) return;
    let cancelled = false;
    void getLocalRepository()
      .then((repository) => repository.loadCourseWorkspace(selectedCourseId))
      .then((loadedWorkspace) => {
        if (!cancelled) setWorkspace(loadedWorkspace);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setSettledCourseId(selectedCourseId);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId, surface]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openCourse = useCallback((courseId: string, conversationId?: string) => {
    updateWithPlatformTransition(() => {
      setSelectedCourseId(courseId);
      setInitialConversationId(conversationId ?? null);
      setPracticeLaunch(null);
      setSurface('course');
    });
  }, []);

  // 手机上只显示网页账号下的课程；还没同步过账号时一门也不显示。
  const accountCourses = useMemo(
    () =>
      platformCourseIds ? courses.filter((course) => platformCourseIds.includes(course.id)) : [],
    [courses, platformCourseIds],
  );

  // 没有主页（手机、iPad、桌面都一样）：载入后直接打开上次用的课程和聊天，没有记录就打开第一门课。
  // 手机只认网页账号下的课程；大屏上账号还没有课程时，退回本机课程。
  const launchCourses = accountCourses.length || phoneLayout ? accountCourses : courses;
  if (!loading && surface === 'learn' && !autoOpened && launchCourses.length) {
    const lastCourse = launchCourses.find((course) => course.id === lastChat?.courseId);
    const course = lastCourse ?? [...launchCourses].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setAutoOpened(true);
    setSelectedCourseId(course.id);
    setInitialConversationId(lastCourse ? (lastChat?.conversationId ?? null) : null);
    setSurface('course');
  }

  const openLearnHome = useCallback(() => {
    updateWithPlatformTransition(() => {
      setSurface('learn');
      setInitialConversationId(null);
      setPracticeLaunch(null);
      setWorkspace(null);
    });
  }, []);

  const openProblemBank = useCallback(() => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(null);
      setSurface('problem-bank');
    });
  }, []);

  const openPractice = useCallback((launch: ProblemBankLaunch) => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(launch);
      setSurface('problem-practice');
    });
  }, []);

  // iPad 和桌面的题库在课程工作台右侧，做完题回到那里。
  const backFromPractice = useCallback(() => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(null);
      setSurface(phoneLayout ? 'problem-bank' : 'course');
    });
  }, [phoneLayout]);

  const backFromProblemBank = useCallback(() => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(null);
      setSurface('course');
    });
  }, []);

  const backFromNotebookLibrary = useCallback(() => {
    updateWithPlatformTransition(() => {
      setSurface('course');
    });
  }, []);

  const refreshWorkspace = useCallback(async () => {
    await Promise.all([
      loadWorkspace(selectedCourseId),
      loadCourses(selectedCourseId ?? undefined),
    ]);
  }, [loadCourses, loadWorkspace, selectedCourseId]);

  const backendLabel = backendKind === 'sqlite' ? '本机 SQLite' : '本机预览库';

  if (loading) {
    return (
      <div className="launch-state">
        <span className="launch-orb">
          <GlassSpinner size={23} />
        </span>
        <strong>正在载入 Learn</strong>
        <span>正在恢复本地课程、笔记本与会话…</span>
      </div>
    );
  }

  if (error && courses.length === 0) {
    return (
      <div className="launch-state launch-state-error">
        <span className="launch-orb">
          <AlertTriangle size={23} />
        </span>
        <strong>本地资料库无法打开</strong>
        <span>{error}</span>
        <button type="button" onClick={() => window.location.reload()}>
          重新打开
        </button>
      </div>
    );
  }

  let content: ReactNode = null;
  if (surface === 'learn') {
    // 没有主页：有课程就直接打开聊天，一门都没有就提示去网页上加入（手机、iPad、桌面一样）。
    const waiting = launchCourses.length > 0;
    content = (
      <div className="launch-state launch-state-light">
        <span className="launch-orb">
          {waiting ? <GlassSpinner size={23} /> : <AlertTriangle size={23} />}
        </span>
        <strong>{waiting ? '正在打开聊天' : '账号下还没有课程'}</strong>
        {waiting ? null : <span>请先在网页上创建或加入课程，再回到这里。</span>}
      </div>
    );
  } else if (!workspace) {
    content = (
      <div className="launch-state launch-state-light">
        <span className="launch-orb">
          <GlassSpinner size={23} />
        </span>
        <strong>正在打开课程</strong>
      </div>
    );
  } else if (surface === 'problem-bank') {
    content = (
      <div className="native-course-subview">
        <ProblemBankPage
          workspace={workspace}
          onBack={backFromProblemBank}
          onPractice={openPractice}
        />
      </div>
    );
  } else if (surface === 'notebook-library') {
    content = (
      <div className="native-course-subview">
        <NotebookLibraryPage workspace={workspace} onBack={backFromNotebookLibrary} />
      </div>
    );
  } else if (surface === 'problem-practice' && practiceLaunch) {
    content = (
      <div className="native-course-subview">
        <ProblemPracticePage
          problems={workspace.problems}
          launch={practiceLaunch}
          onBack={backFromPractice}
        />
      </div>
    );
  } else {
    content = (
      <CourseWorkspace
        key={workspace.course.id}
        workspace={workspace}
        backendLabel={backendLabel}
        courses={accountCourses}
        onBack={openLearnHome}
        onSwitchCourse={(courseId) => openCourse(courseId)}
        initialConversationId={initialConversationId}
        onOpenProblemBank={openProblemBank}
        onOpenPractice={openPractice}
        onWorkspaceChanged={refreshWorkspace}
      />
    );
  }

  return (
    <main
      className={`syntara-native-shell${avatarTheme.themed ? ' has-avatar-theme' : ''}`}
      style={avatarTheme.style}
    >
      {content}

      {surface !== 'learn' && switchingCourse && workspace ? (
        <div className="course-switch-progress" role="status">
          <GlassSpinner size={14} />
          正在切换课程
        </div>
      ) : null}

      {toast ? (
        <div className="native-toast" role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function App() {
  return (
    <>
      <div className="native-window-drag-region" data-tauri-drag-region aria-hidden />
      <NativeAuthGate>
        <AuthenticatedApp />
      </NativeAuthGate>
    </>
  );
}

export default App;
