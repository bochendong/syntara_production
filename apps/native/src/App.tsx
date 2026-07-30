import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { CourseWorkspace } from './components/CourseWorkspace';
import { LearnHome } from './components/LearnHome';
import { NativeAuthGate } from './components/NativeAccountControl';
import { NotebookLibraryPage } from './components/NotebookLibraryPage';
import { ProblemBankPage, type ProblemBankLaunch } from './components/ProblemBankPage';
import { ProblemPracticePage } from './components/ProblemPracticePage';
import { parseSyntaraArchive } from './data/archive';
import { getLocalRepository, type LocalBackendKind } from './data/repository';
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
  const [courses, setCourses] = useState<LocalCourseSummary[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<LocalCourseWorkspace | null>(null);
  const [surface, setSurface] = useState<AppSurface>('learn');
  const [practiceLaunch, setPracticeLaunch] = useState<ProblemBankLaunch | null>(null);
  const [backendKind, setBackendKind] = useState<LocalBackendKind>('indexeddb');
  const [loadDuration, setLoadDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingCourse, setSwitchingCourse] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  const loadCourses = useCallback(async (preferredCourseId?: string) => {
    const repository = await getLocalRepository();
    const startedAt = performance.now();
    await repository.bootstrap();
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
    setLoadDuration(performance.now() - startedAt);
  }, []);

  const loadWorkspace = useCallback(async (courseId: string | null) => {
    if (!courseId) {
      setWorkspace(null);
      return;
    }
    const repository = await getLocalRepository();
    const startedAt = performance.now();
    const loadedWorkspace = await repository.loadCourseWorkspace(courseId);
    setWorkspace(loadedWorkspace);
    setLoadDuration(performance.now() - startedAt);
  }, []);

  useEffect(() => {
    void loadCourses()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, [loadCourses]);

  useEffect(() => {
    if (surface === 'learn') {
      setWorkspace(null);
      setPracticeLaunch(null);
      setSwitchingCourse(false);
      return;
    }
    setSwitchingCourse(true);
    void loadWorkspace(selectedCourseId)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSwitchingCourse(false));
  }, [loadWorkspace, selectedCourseId, surface]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const createCourse = useCallback(async () => {
    try {
      const repository = await getLocalRepository();
      const course = await repository.createCourse({
        name: `本地课程 ${courses.length + 1}`,
        description: '这门课程只保存在当前设备。',
      });
      await loadCourses(course.id);
      setToast(`已在本机创建“${course.name}”`);
    } catch (cause) {
      setToast(`创建失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [courses.length, loadCourses]);

  const openCourse = useCallback((courseId: string) => {
    updateWithPlatformTransition(() => {
      setSelectedCourseId(courseId);
      setPracticeLaunch(null);
      setSurface('course');
    });
  }, []);

  const openLearnHome = useCallback(() => {
    updateWithPlatformTransition(() => {
      setSurface('learn');
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

  const openNotebookLibrary = useCallback(() => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(null);
      setSurface('notebook-library');
    });
  }, []);

  const openPractice = useCallback((launch: ProblemBankLaunch) => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(launch);
      setSurface('problem-practice');
    });
  }, []);

  const backFromPractice = useCallback(() => {
    updateWithPlatformTransition(() => {
      setPracticeLaunch(null);
      setSurface('problem-bank');
    });
  }, []);

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

  const importArchive = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || migrationBusy) return;

      setMigrationBusy(true);
      try {
        const archive = parseSyntaraArchive(await file.text());
        if (archive.courses.length === 0) {
          throw new Error('迁移文件中没有可导入的课程。');
        }
        const repository = await getLocalRepository();
        const summary = await repository.importArchive(archive);
        await loadCourses(summary.courseIds[0]);
        setSurface('learn');
        setPracticeLaunch(null);
        setToast(
          `已迁移 ${summary.courses} 门课程、${summary.notebooks} 个笔记本、${summary.problems} 道题、${summary.messages} 条消息和 ${summary.assets} 个离线资源${summary.missingAssets ? `；${summary.missingAssets} 个资源缺失` : ''}`,
        );
      } catch (cause) {
        setToast(`迁移失败：${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        setMigrationBusy(false);
      }
    },
    [loadCourses, migrationBusy],
  );

  const backendLabel = backendKind === 'sqlite' ? '本机 SQLite' : '本机预览库';

  if (loading) {
    return (
      <div className="launch-state">
        <span className="launch-orb">
          <Loader2 size={23} />
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
    content = (
      <LearnHome
        courses={courses}
        activeCourseId={selectedCourseId}
        backendLabel={backendLabel}
        loadDuration={loadDuration}
        migrationBusy={migrationBusy}
        onCreateCourse={() => void createCourse()}
        onImportArchive={() => archiveInputRef.current?.click()}
        onOpenCourse={openCourse}
      />
    );
  } else if (!workspace) {
    content = (
      <div className="launch-state launch-state-light">
        <span className="launch-orb">
          <Loader2 size={23} />
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
        onBack={openLearnHome}
        onOpenProblemBank={openProblemBank}
        onOpenNotebookLibrary={openNotebookLibrary}
        onOpenPractice={openPractice}
        onWorkspaceChanged={refreshWorkspace}
      />
    );
  }

  return (
    <main className="syntara-native-shell">
      {content}

      {surface !== 'learn' && switchingCourse && workspace ? (
        <div className="course-switch-progress" role="status">
          <Loader2 size={14} />
          正在切换课程
        </div>
      ) : null}

      <input
        ref={archiveInputRef}
        className="archive-file-input"
        type="file"
        accept=".json,.syntara.json,application/json"
        onChange={(event) => void importArchive(event)}
      />

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
    <NativeAuthGate>
      <AuthenticatedApp />
    </NativeAuthGate>
  );
}

export default App;
