import { AppNavigationRail } from './components/AppNavigationRail';
import { AppNavigationContext, type AppNavigation } from './components/app-navigation-context';
import { browserApp } from './data/browser-runtime';
import { CreateCourseDialog } from './components/CreateCourseDialog';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { CourseWorkspace } from './components/CourseWorkspace';
import { ChatWorkspaceShell } from './components/ChatWorkspaceShell';
import { LearningEmptyState } from './components/LearningEmptyState';
import { GeneralChatWorkspace } from './components/GeneralChatWorkspace';
import { GlassSpinner } from './components/GlassLoadMore';
import { NativeAuthGate } from './components/NativeAccountControl';
import { NotebookLibraryPage } from './components/NotebookLibraryPage';
import { ProblemBankPage, type ProblemBankLaunch } from './components/ProblemBankPage';
import { ProblemPracticePage } from './components/ProblemPracticePage';
import { syncPlatformCourses } from './data/chat-sync';
import { getLocalRepository, type LocalBackendKind } from './data/repository';
import {
  accessibleChatCourses,
  selectChatCourse,
  type CourseOpenTarget,
} from './lib/native-launch';
import { readPhoneLastChat } from './lib/phone-last-chat';
import { GlobalCalendarApp } from './components/GlobalCalendarApp';
import { PhoneProfilePage } from './components/PhonePages';
import { StorePage } from './components/StorePage';
import { OnboardingCoach } from './components/OnboardingCoach';
import { completeOnboardingStep } from './lib/onboarding';
import { resolveNativeCourseAvatar } from './assets';
import { marbleImages } from './lib/learning-action-marbles';
import type { LocalCourseEvent } from './domain/learning-experiences';
import type { ChatResponseStrength } from './data/ai-client';
import './components/global-calendar.css';
import { useBackDismiss } from './lib/use-back-dismiss';
import { useCompactLayout, usePhoneLayout } from './lib/use-phone-layout';
import { useAvatarTheme } from './lib/use-avatar-theme';
import type { LocalCourseSummary, LocalCourseWorkspace } from './domain/models';

type AppSurface =
  | 'general'
  | 'launch'
  | 'course'
  | 'problem-bank'
  | 'notebook-library'
  | 'problem-practice';

function updateWithPlatformTransition(update: () => void) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('__TAURI_INTERNALS__' in window) && !reduceMotion && document.startViewTransition) {
    const transition = document.startViewTransition(update);
    // Rapid navigation may skip an animation while still applying the update.
    void transition.ready.catch(() => undefined);
    void transition.finished.catch((cause) => console.error('[navigation] update failed', cause));
    return;
  }
  update();
}

function AuthenticatedApp() {
  const avatarTheme = useAvatarTheme();
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [chatDraft, setChatDraft] = useState({ text: '', revision: 0 });
  const [courses, setCourses] = useState<LocalCourseSummary[]>([]);
  const [platformCourseIds, setPlatformCourseIds] = useState<string[] | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [initialGeneralConversationId, setInitialGeneralConversationId] = useState<string | null>(
    null,
  );
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<LocalCourseWorkspace | null>(null);
  const [surface, setSurface] = useState<AppSurface>('launch');
  const [practiceLaunch, setPracticeLaunch] = useState<ProblemBankLaunch | null>(null);
  const [backendKind, setBackendKind] = useState<LocalBackendKind>('indexeddb');
  const [loading, setLoading] = useState(true);
  const [settledCourseId, setSettledCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const phoneLayout = usePhoneLayout();
  const compactLayout = useCompactLayout();
  const [globalPage, setGlobalPage] = useState<'calendar' | 'profile' | 'store' | null>(null);
  const [globalEvents, setGlobalEvents] = useState<LocalCourseEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [launchRevision, setLaunchRevision] = useState(0);
  const navigationRequest = useRef(0);
  const cancelPendingNavigation = useCallback(() => {
    navigationRequest.current += 1;
  }, []);
  const [responseStrength, setResponseStrength] = useState<ChatResponseStrength>(() => {
    try {
      const stored = localStorage.getItem('syntara.phone.response-strength.v1');
      return stored === 'low' || stored === 'high' ? stored : 'medium';
    } catch {
      return 'medium';
    }
  });
  const [initialPage, setInitialPage] = useState<CourseOpenTarget['page'] | undefined>();
  const [newEventDate, setNewEventDate] = useState<string | undefined>();
  const [calendarDate, setCalendarDate] = useState<string | undefined>();
  const switchingCourse = surface !== 'launch' && settledCourseId !== selectedCourseId;

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
    if (surface === 'launch' || !selectedCourseId) return;
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

  const openCourse = useCallback(
    (courseId: string, conversationId?: string, target?: CourseOpenTarget, draft = '') => {
      navigationRequest.current += 1;
      // Chat navigation must commit together with its loaded workspace, without a page transition.
      setGlobalPage(null);
      setChatDraft((current) => ({ text: draft, revision: current.revision + 1 }));
      setLaunchRevision((revision) => revision + 1);
      setSelectedCourseId(courseId);
      setInitialConversationId(conversationId ?? null);
      setInitialPage(target?.page);
      setCalendarDate(target?.date);
      setNewEventDate(target?.createEvent ? target.date : undefined);
      setPracticeLaunch(null);
      setSurface('course');
    },
    [],
  );

  // Native courses remain account-scoped. The isolated browser preview may use bundled courses.
  const launchCourses = useMemo(
    () =>
      accessibleChatCourses(
        courses,
        platformCourseIds,
        !browserApp && !('__TAURI_INTERNALS__' in window),
      ),
    [courses, platformCourseIds],
  );
  const openRecentCourse = useCallback(
    async (courseId: string, target?: CourseOpenTarget) => {
      const request = ++navigationRequest.current;
      try {
        const latest = await (await getLocalRepository()).latestCourseConversation(courseId);
        const last = readPhoneLastChat();
        const conversationId =
          last?.courseId === courseId && last.conversationId ? last.conversationId : latest?.id;
        if (request === navigationRequest.current) openCourse(courseId, conversationId, target);
      } catch (cause) {
        if (request === navigationRequest.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [openCourse],
  );

  useEffect(() => {
    if (loading || surface !== 'launch') return;
    const entry = browserApp ? new URLSearchParams(window.location.search) : null;
    const requested = launchCourses.find((course) => course.id === entry?.get('courseId'));
    const course = requested ?? selectChatCourse(launchCourses, readPhoneLastChat());
    if (course)
      void openRecentCourse(
        course.id,
        requested && entry?.get('page') === 'notes' ? { page: 'notes' } : undefined,
      );
    else if (browserApp) setSurface('general');
  }, [loading, surface, launchCourses, openRecentCourse]);

  const openGeneralChat = useCallback((draft = '', conversationId: string | null = null) => {
    setInitialGeneralConversationId(conversationId);
    navigationRequest.current += 1;
    setChatDraft((current) => ({ text: draft, revision: current.revision + 1 }));
    setGlobalPage(null);
    setSurface('general');
    setSelectedCourseId(null);
    setWorkspace(null);
  }, []);

  const openRecentChat = async (courseId: string | null, conversationId: string) => {
    if (!courseId) {
      if (browserApp) openGeneralChat('', conversationId);
      return;
    }
    if (!launchCourses.some((course) => course.id === courseId)) return;
    const request = ++navigationRequest.current;
    try {
      // A newly synced chat may not be in the already-open course snapshot yet.
      const next = await (await getLocalRepository()).loadCourseWorkspace(courseId);
      if (request !== navigationRequest.current) return;
      if (!next) throw new Error('未找到这门课程');
      setWorkspace(next);
      setSettledCourseId(courseId);
      openCourse(courseId, conversationId);
    } catch (cause) {
      if (request === navigationRequest.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const changeChatScope = useCallback(
    async (courseId: string | null, draft: string) => {
      if (courseId) {
        if (!launchCourses.some((course) => course.id === courseId)) return;
        const request = ++navigationRequest.current;
        try {
          const next = await (await getLocalRepository()).loadCourseWorkspace(courseId);
          if (request !== navigationRequest.current) return;
          if (!next) throw new Error('未找到这门课程');
          setWorkspace(next);
          setSettledCourseId(courseId);
          openCourse(courseId, undefined, undefined, draft);
        } catch (cause) {
          if (request === navigationRequest.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      } else openGeneralChat(draft);
    },
    [launchCourses, openCourse, openGeneralChat],
  );

  const openChat = useCallback(() => {
    setGlobalPage(null);
    setSurface('course');
  }, []);
  useBackDismiss(globalPage !== null, () => setGlobalPage(null));
  useBackDismiss(
    ['problem-bank', 'notebook-library', 'problem-practice'].includes(surface),
    openChat,
    0,
  );

  useEffect(() => {
    if (globalPage !== 'calendar') return;
    let cancelled = false;
    setCalendarLoading(true);
    setCalendarError(null);
    void getLocalRepository()
      .then(async (repository) => {
        const groups = await Promise.all(
          launchCourses.map((course) => repository.listCourseEvents(course.id)),
        );
        if (!cancelled) setGlobalEvents(groups.flat());
      })
      .catch((cause) => {
        if (!cancelled)
          setCalendarError(cause instanceof Error ? cause.message : '暂时无法读取课程安排');
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [globalPage, launchCourses, calendarRevision]);

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

  const backendLabel =
    backendKind === 'sqlite' ? '本机 SQLite' : browserApp ? '浏览器缓存' : '本机预览库';

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
  if (surface === 'launch') {
    content = (
      <div className="launch-state launch-state-light">
        {launchCourses.length ? (
          <>
            <GlassSpinner size={23} />
            <strong>正在打开聊天</strong>
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" onClick={() => window.location.reload()}>
              重新载入
            </button>
          </>
        ) : (
          <div className="launch-empty">
            <LearningEmptyState
              title="还没有课程"
              action={
                browserApp
                  ? {
                      label: '新建课程',
                      icon: <img src={marbleImages.purple} alt="" />,
                      onClick: () => setCreatingCourse(true),
                    }
                  : {
                      label: '去商城挑一门',
                      icon: <img src={marbleImages.blue} alt="" />,
                      onClick: () => setGlobalPage('store'),
                    }
              }
            />
            <div className="launch-empty-links">
              {browserApp ? (
                <button type="button" onClick={() => setGlobalPage('store')}>
                  商城
                </button>
              ) : null}
              <button type="button" onClick={() => setGlobalPage('profile')}>
                我的
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                重新载入
              </button>
            </div>
          </div>
        )}
      </div>
    );
  } else if (surface === 'general') {
    content = (
      <GeneralChatWorkspace
        initialConversationId={initialGeneralConversationId}
        onOpenRecentChat={openRecentChat}
        key={chatDraft.revision}
        initialDraft={chatDraft.text}
        onChangeChatScope={changeChatScope}
        courses={launchCourses}
        onCreateCourse={() => setCreatingCourse(true)}
        onCreateCourseChat={(id) => openCourse(id)}
        onOpenCourseTool={(id, page) => void openRecentCourse(id, { page })}
        responseStrength={responseStrength}
      />
    );
  } else if (!workspace || workspace.course.id !== selectedCourseId) {
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
        onOpenRecentChat={openRecentChat}
        key={`${workspace.course.id}:${launchRevision}`}
        initialDraft={chatDraft.text}
        onChangeChatScope={changeChatScope}
        workspace={workspace}
        backendLabel={backendLabel}
        courses={launchCourses}
        onBack={openChat}
        onCreateCourse={browserApp ? () => setCreatingCourse(true) : undefined}
        onNewChat={browserApp ? () => openGeneralChat() : undefined}
        onSwitchCourse={(courseId) => void openRecentCourse(courseId)}
        onCreateCourseChat={(id) => openCourse(id)}
        onOpenCourseTool={(id, page) => void openRecentCourse(id, { page })}
        initialConversationId={initialConversationId}
        initialPage={initialPage}
        newEventDate={newEventDate}
        calendarDate={calendarDate}
        onOpenProblemBank={openProblemBank}
        onOpenPractice={openPractice}
        onWorkspaceChanged={refreshWorkspace}
      />
    );
  }

  const navigation: AppNavigation = {
    active:
      globalPage === 'calendar'
        ? 'calendar'
        : globalPage === 'profile'
          ? 'settings'
          : globalPage === 'store'
            ? 'store'
            : 'chat',
    avatarUrl: avatarTheme.avatarUrl,
    onOpenCalendar: () => setGlobalPage('calendar'),
    onOpenStore: () => {
      completeOnboardingStep('store');
      setGlobalPage('store');
    },
    onOpenSettings: () => setGlobalPage('profile'),
  };

  return (
    <AppNavigationContext.Provider value={navigation}>
      <main
        className={`syntara-native-shell${compactLayout ? '' : ' has-global-navigation'}${avatarTheme.themed ? ' has-avatar-theme' : ''}`}
        style={avatarTheme.style}
      >
        {compactLayout ? null : (
          <AppNavigationRail
            {...navigation}
            onOpenChat={() => {
              if (surface === 'general' || surface === 'launch') setGlobalPage(null);
              else openChat();
            }}
          />
        )}
        <div className="app-chat-surface" inert={globalPage !== null}>
          <ChatWorkspaceShell enabled={!phoneLayout} onLocalNavigation={cancelPendingNavigation}>
            {content}
          </ChatWorkspaceShell>
        </div>
        {creatingCourse ? (
          <CreateCourseDialog
            onCancel={() => setCreatingCourse(false)}
            onCreated={async (id) => {
              completeOnboardingStep('course');
              await loadCourses(id);
              setCreatingCourse(false);
              openCourse(id);
            }}
          />
        ) : null}

        {surface !== 'launch' && switchingCourse && workspace ? (
          <div className="course-switch-progress" role="status">
            <GlassSpinner size={14} />
            正在切换课程
          </div>
        ) : null}

        {globalPage ? (
          <div className="native-global-page">
            {globalPage === 'calendar' ? (
              <>
                <GlobalCalendarApp
                  courses={launchCourses}
                  events={globalEvents}
                  onOpenCourse={(id, date, createEvent) =>
                    void openRecentCourse(id, { page: 'calendar', date, createEvent })
                  }
                  onBack={() => setGlobalPage(null)}
                />
                {calendarLoading ? (
                  <div className="native-global-status" role="status">
                    正在读取课程安排…
                  </div>
                ) : calendarError ? (
                  <div className="native-global-status" role="alert">
                    {calendarError}
                    <button
                      type="button"
                      onClick={() => setCalendarRevision((revision) => revision + 1)}
                    >
                      重试
                    </button>
                  </div>
                ) : null}
              </>
            ) : globalPage === 'store' ? (
              <StorePage
                onBack={() => setGlobalPage(null)}
                onJoined={(id) => loadCourses(id)}
                onOpenCourse={(id) => {
                  setGlobalPage(null);
                  void openRecentCourse(id);
                }}
              />
            ) : (
              <PhoneProfilePage
                courses={launchCourses}
                currentCourseId={selectedCourseId ?? ''}
                currentCourseAvatarUrl={
                  workspace
                    ? resolveNativeCourseAvatar(workspace.course.id, workspace.course.courseCode)
                    : ''
                }
                conversationCount={launchCourses.reduce(
                  (sum, course) => sum + course.conversationCount,
                  0,
                )}
                responseStrength={responseStrength}
                onResponseStrengthChange={(strength) => {
                  setResponseStrength(strength);
                  try {
                    localStorage.setItem('syntara.phone.response-strength.v1', strength);
                  } catch {
                    /* Retain the session preference. */
                  }
                }}
                onOpenCourseJar={(id) => void openRecentCourse(id, { page: 'memory' })}
                onBack={() => setGlobalPage(null)}
              />
            )}
          </div>
        ) : null}

        <OnboardingCoach />

        {toast ? (
          <div className="native-toast" role="status">
            {toast}
          </div>
        ) : null}
      </main>
    </AppNavigationContext.Provider>
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
