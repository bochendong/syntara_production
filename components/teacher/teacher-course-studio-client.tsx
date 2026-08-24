'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Eye,
  FileText,
  GripVertical,
  Home,
  Library,
  ListChecks,
  ListOrdered,
  Loader2,
  MessageCircleMore,
  MessagesSquare,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  School,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  StudioItemIcon,
  StudioItemTag,
  StudioList,
  StudioListItem,
  StudioPagination,
  StudioStatusBadge,
} from '@/components/teacher/studio-list';
import {
  academicTermLabel,
  generateOnlineMindMap,
  getOnlineTeacherSourcePreview,
  loadOnlineTeacherStudio,
  resolveCourseSourceCategory,
  orderCourseContentNotebooks,
  permanentlyDeleteOnlineContent,
  processOnlineSource,
  renameOnlineNotebook,
  setOnlineContentRemoved,
  updateOnlineNotebookOrder,
  uploadOnlineTeacherSources,
  type CourseContentType,
  type CourseSourceCategory,
  type TeacherStudioContentItem as CourseContentItem,
  type TeacherStudioCourse,
  type TeacherStudioSourcePreview,
  type TeacherStudioTask,
} from '@/lib/teacher/online-course-studio';
import { BackendApiError, backendFetch, backendJson } from '@/lib/utils/backend-api';
import { isLocalDemoUserId } from '@/lib/auth/local-demo';
import {
  getLocalDemoCourseHardRules,
  getLocalDemoTeacherStudio,
} from '@/lib/teacher/local-demo-fixtures';

const CourseProblemBankView = dynamic(
  () =>
    import('@/components/problem-bank/course-problem-bank-view').then(
      (module) => module.CourseProblemBankView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-80 flex-1 place-items-center text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在加载题库…
        </span>
      </div>
    ),
  },
);

type StudioTab = 'notebooks' | 'problem_banks' | 'hard_rules' | 'sources' | 'queue' | 'removed';
type ResourceLibraryKind = 'notebook' | 'problem_bank';
type CourseHardRuleRecord = {
  id: string;
  courseId: string;
  ownerId: string;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};
const STUDIO_PAGE_SIZE = 8;
const NOTEBOOK_GRID_CAPACITY = 8;

const SOURCE_CATEGORIES: Array<{
  value: CourseSourceCategory;
  label: string;
  description: string;
  Icon: typeof FileText;
}> = [
  {
    value: 'school_teacher_notes',
    label: '学校老师讲义',
    description: '课程大纲、课堂讲义与学校教师提供的资料',
    Icon: School,
  },
  {
    value: 'crash_course_teacher_notes',
    label: '速成老师讲义',
    description: '冲刺课、速成班和考前复习资料',
    Icon: Rocket,
  },
  {
    value: 'problem_bank',
    label: '题库',
    description: '习题集、历年试题与题库原始文件',
    Icon: ListChecks,
  },
];

const SOURCE_CATEGORY_META = Object.fromEntries(
  SOURCE_CATEGORIES.map((category) => [category.value, category]),
) as Record<CourseSourceCategory, (typeof SOURCE_CATEGORIES)[number]>;
const STUDIO_SECTION_CLASS =
  'mt-6 flex min-h-[min(706px,72dvh)] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/[0.055] sm:mt-8';

function teacherCourseAccessWasRevoked(error: unknown): error is BackendApiError {
  return error instanceof BackendApiError && (error.status === 403 || error.status === 404);
}
const STUDIO_PANEL_BODY_CLASS =
  'flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/80 p-4 dark:bg-slate-950 sm:p-5';

function StudioEmptyPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center bg-transparent text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

const TYPE_META: Record<CourseContentType, { label: string; icon: typeof FileText }> = {
  notebook: { label: '笔记本', icon: BookOpenText },
  problem_bank: { label: '题库', icon: Library },
  source: { label: '源文件', icon: FileText },
};

function queueStageLabel(job: TeacherStudioTask): string {
  if (job.kind === 'mind_map') {
    if (job.stage === 'extracting') return '解析思维导图素材';
    if (job.stage === 'generating_mind_map') return '生成思维导图';
    if (job.stage === 'generating_image') return '绘制思维导图';
    if (job.stage === 'persisting_mind_map') return '保存思维导图';
    if (job.stage === 'completed') return '思维导图已完成';
    if (job.stage === 'failed') return '思维导图生成失败';
    return '等待生成思维导图';
  }
  if (job.stage === 'extracting') return '解析源文件';
  if (job.stage === 'writing_knowledge') return '写入课程知识';
  if (job.stage === 'generating_notebook') return '生成 Markdown 笔记本';
  if (job.stage === 'creating_notebook_reference') return '创建笔记本引用';
  if (job.stage === 'completed') return '已加入 AI 知识库';
  if (job.stage === 'failed') return '处理失败';
  return '等待处理';
}

function queueFileTypeLabel(fileName: string): string {
  const extension = fileName.split('.').pop()?.trim().toUpperCase();
  return extension && extension !== fileName.toUpperCase() ? extension : '资料';
}

function queueErrorLabel(errorReason: string): string {
  if (/API key required for provider/i.test(errorReason)) {
    return 'AI 服务配置缺失；管理员修复后可重新处理';
  }
  return errorReason;
}

function latestJobsByAsset(jobs: TeacherStudioTask[]) {
  const map = new Map<string, TeacherStudioTask>();
  for (const job of jobs) {
    if (!map.has(job.sourceAssetId)) map.set(job.sourceAssetId, job);
  }
  return map;
}

export function TeacherCourseStudioClient({
  courseId,
  mockMode = false,
}: {
  courseId: string;
  mockMode?: boolean;
}) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = mockMode || sessionStatus !== 'loading';
  const isLoggedIn = mockMode || sessionStatus === 'authenticated';
  const role =
    mockMode || session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN'
      ? 'TEACHER'
      : 'STUDENT';
  const teacherId = mockMode ? 'local-demo-teacher-ui-mock' : session?.user?.id || '';
  const localDemo = mockMode || isLocalDemoUserId(teacherId);
  const [course, setCourse] = useState<TeacherStudioCourse | null>(null);
  const [content, setContent] = useState<CourseContentItem[]>([]);
  const [removedContent, setRemovedContent] = useState<CourseContentItem[]>([]);
  const [jobs, setJobs] = useState<TeacherStudioTask[]>([]);
  const [persistenceTasks, setPersistenceTasks] = useState<TeacherStudioTask[]>([]);
  const [hardRules, setHardRules] = useState<CourseHardRuleRecord[]>([]);
  const [hardRuleDrafts, setHardRuleDrafts] = useState<Record<string, string>>({});
  const [newHardRule, setNewHardRule] = useState('');
  const [hardRulesLoaded, setHardRulesLoaded] = useState(false);
  const [hardRulesLoading, setHardRulesLoading] = useState(false);
  const [savingHardRuleId, setSavingHardRuleId] = useState('');
  const [tab, setTab] = useState<StudioTab>('sources');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [unresolvedForumCount, setUnresolvedForumCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [processingSourceIds, setProcessingSourceIds] = useState<Set<string>>(() => new Set());
  const [mindMapSourceAssetId, setMindMapSourceAssetId] = useState('');
  const [actionReferenceId, setActionReferenceId] = useState('');
  const [permanentDeleteReferenceId, setPermanentDeleteReferenceId] = useState('');
  const [pendingPermanentDeleteItem, setPendingPermanentDeleteItem] =
    useState<CourseContentItem | null>(null);
  const [editingNotebookOrder, setEditingNotebookOrder] = useState(false);
  const [notebookOrderDraft, setNotebookOrderDraft] = useState<string[]>([]);
  const [savingNotebookOrder, setSavingNotebookOrder] = useState(false);
  const [renamingNotebook, setRenamingNotebook] = useState<CourseContentItem | null>(null);
  const [notebookNameDraft, setNotebookNameDraft] = useState('');
  const [savingNotebookName, setSavingNotebookName] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [sourceCategory, setSourceCategory] =
    useState<CourseSourceCategory>('school_teacher_notes');
  const [selectedResourceReferenceId, setSelectedResourceReferenceId] = useState('');
  const [selectedNotebookSectionId, setSelectedNotebookSectionId] = useState('');
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [hardRuleDialogOpen, setHardRuleDialogOpen] = useState(false);
  const [editingHardRuleId, setEditingHardRuleId] = useState('');
  const [mindMapImageUrl, setMindMapImageUrl] = useState('');
  const [mindMapImageLoading, setMindMapImageLoading] = useState(false);
  const [mindMapImageError, setMindMapImageError] = useState('');
  const [mindMapImageReloadKey, setMindMapImageReloadKey] = useState(0);
  const [notebookFallbackText, setNotebookFallbackText] = useState('');
  const [notebookFallbackLoading, setNotebookFallbackLoading] = useState(false);
  const [notebookFallbackError, setNotebookFallbackError] = useState('');
  const [previewSource, setPreviewSource] = useState<CourseContentItem | null>(null);
  const [sourcePreview, setSourcePreview] = useState<TeacherStudioSourcePreview | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState('');
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false);
  const [sourcePreviewError, setSourcePreviewError] = useState('');
  const persistenceRefreshRef = useRef(false);
  const sharedContentRefreshRef = useRef(false);
  const hardRuleRefreshRef = useRef(false);
  const hardRulesLoadedRef = useRef(false);
  const dirtyHardRuleIdsRef = useRef(new Set<string>());

  const loadStudio = useCallback(async () => {
    if (!teacherId) return;
    try {
      const snapshot = localDemo
        ? getLocalDemoTeacherStudio(courseId, teacherId)
        : await loadOnlineTeacherStudio({ teacherId, courseId });
      setCourse(snapshot.course);
      setContent(snapshot.content);
      setRemovedContent(snapshot.removedContent);
      setJobs(snapshot.tasks);
      setPersistenceTasks(snapshot.tasks);
      setAccessRevoked(false);
    } catch (loadError) {
      if (teacherCourseAccessWasRevoked(loadError)) {
        setCourse(null);
        setAccessRevoked(true);
        setError(loadError.backendMessage || '机构已关闭这门课程的 AI 访问权限。');
      }
      throw loadError;
    }
  }, [courseId, localDemo, teacherId]);

  const loadHardRules = useCallback(
    async (showError = false) => {
      if (!teacherId || hardRuleRefreshRef.current) return;
      if (localDemo) {
        const rules = getLocalDemoCourseHardRules(courseId, teacherId);
        setHardRules(rules);
        setHardRuleDrafts(Object.fromEntries(rules.map((rule) => [rule.id, rule.content])));
        setHardRulesLoaded(true);
        hardRulesLoadedRef.current = true;
        return;
      }
      hardRuleRefreshRef.current = true;
      setHardRulesLoading(true);
      try {
        const response = await backendFetch(
          `/api/teacher/courses/${encodeURIComponent(courseId)}/hard-rules`,
          { method: 'GET', timeoutMs: 20_000 },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          rules?: CourseHardRuleRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || '读取 Hard Rule 失败');
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        if (dirtyHardRuleIdsRef.current.size > 0) return;
        setHardRules(rules);
        setHardRuleDrafts(Object.fromEntries(rules.map((rule) => [rule.id, rule.content])));
        dirtyHardRuleIdsRef.current.clear();
        setHardRulesLoaded(true);
        hardRulesLoadedRef.current = true;
      } catch (loadError) {
        if (showError) {
          setError(loadError instanceof Error ? loadError.message : '读取 Hard Rule 失败');
        }
      } finally {
        setHardRulesLoading(false);
        hardRuleRefreshRef.current = false;
      }
    },
    [courseId, localDemo, teacherId],
  );

  const hasUnsavedHardRuleChanges = useMemo(
    () =>
      hardRules.some(
        (rule) => (hardRuleDrafts[rule.id] ?? rule.content).trim() !== rule.content.trim(),
      ),
    [hardRuleDrafts, hardRules],
  );

  const refreshPersistenceTasks = useCallback(async () => {
    if (!teacherId || persistenceRefreshRef.current) return;
    if (localDemo) return;
    persistenceRefreshRef.current = true;
    try {
      const snapshot = await loadOnlineTeacherStudio({ teacherId, courseId });
      setPersistenceTasks(snapshot.tasks);
      setJobs(snapshot.tasks);
    } catch {
      // The notebook/source records below remain the fallback source of persistence truth.
    } finally {
      persistenceRefreshRef.current = false;
    }
  }, [courseId, localDemo, teacherId]);

  const refreshSharedCourseContent = useCallback(async () => {
    if (!teacherId || accessRevoked || sharedContentRefreshRef.current) return;
    if (localDemo) return;
    sharedContentRefreshRef.current = true;
    try {
      await loadStudio();
      setError((current) =>
        /Prisma|connection pool|数据库连接|读取共享课程/i.test(current) ? '' : current,
      );
    } catch {
      // The next visibility/focus refresh retries the PostgreSQL snapshot automatically.
    } finally {
      sharedContentRefreshRef.current = false;
    }
  }, [accessRevoked, loadStudio, localDemo, teacherId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!mockMode && (!isLoggedIn || role !== 'TEACHER')) {
      router.replace('/speedup/signed-out?role=teacher');
      return;
    }
    setLoading(true);
    void loadStudio()
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : '课程读取失败'),
      )
      .finally(() => {
        if (mockMode) setUnresolvedForumCount(3);
        setLoading(false);
      });
  }, [hydrated, isLoggedIn, loadStudio, mockMode, role, router]);

  useEffect(() => {
    if (mockMode || !hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || localDemo)
      return;
    let cancelled = false;
    void backendJson<{ unresolvedCount: number }>(
      `/api/course-forum/${encodeURIComponent(courseId)}/summary`,
      { timeoutMs: 12_000 },
    )
      .then((result) => {
        if (!cancelled) setUnresolvedForumCount(Math.max(0, result.unresolvedCount || 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId, hydrated, isLoggedIn, localDemo, mockMode, role, teacherId]);

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || localDemo || accessRevoked)
      return;
    void refreshPersistenceTasks();
  }, [accessRevoked, hydrated, isLoggedIn, localDemo, refreshPersistenceTasks, role, teacherId]);

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || localDemo) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSharedCourseContent();
    };
    void refreshSharedCourseContent();
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [accessRevoked, hydrated, isLoggedIn, localDemo, refreshSharedCourseContent, role, teacherId]);

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || tab !== 'hard_rules') {
      return;
    }
    if (!hasUnsavedHardRuleChanges) {
      void loadHardRules(!hardRulesLoadedRef.current);
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && !hasUnsavedHardRuleChanges) {
        void loadHardRules(false);
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [hasUnsavedHardRuleChanges, hydrated, isLoggedIn, loadHardRules, role, tab, teacherId]);

  const hasActivePersistenceTask = persistenceTasks.some(
    (task) => task.status === 'queued' || task.status === 'running',
  );

  useEffect(() => {
    if (
      !hydrated ||
      !isLoggedIn ||
      role !== 'TEACHER' ||
      !teacherId ||
      localDemo ||
      !hasActivePersistenceTask
    ) {
      return;
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSharedCourseContent();
    };
    void refreshSharedCourseContent();
    const interval = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [
    hasActivePersistenceTask,
    hydrated,
    isLoggedIn,
    localDemo,
    refreshSharedCourseContent,
    role,
    teacherId,
  ]);

  const sources = useMemo(() => content.filter((item) => item.type === 'source'), [content]);
  const resources = useMemo(() => content.filter((item) => item.type !== 'source'), [content]);
  const notebooks = useMemo(
    () => resources.filter((item) => item.type === 'notebook'),
    [resources],
  );
  const orderedNotebooks = useMemo(() => orderCourseContentNotebooks(notebooks), [notebooks]);
  const visibleNotebookOrder = useMemo(() => {
    if (!editingNotebookOrder) return orderedNotebooks;
    const notebookById = new Map(notebooks.map((notebook) => [notebook.id, notebook] as const));
    const orderedDraft = notebookOrderDraft.flatMap((id) => {
      const notebook = notebookById.get(id);
      return notebook ? [notebook] : [];
    });
    const draftIds = new Set(orderedDraft.map((notebook) => notebook.id));
    return [...orderedDraft, ...orderedNotebooks.filter((notebook) => !draftIds.has(notebook.id))];
  }, [editingNotebookOrder, notebookOrderDraft, notebooks, orderedNotebooks]);
  const problemBanks = useMemo(
    () => resources.filter((item) => item.type === 'problem_bank'),
    [resources],
  );
  const resourceLibraryKind: ResourceLibraryKind | null =
    tab === 'notebooks' ? 'notebook' : tab === 'problem_banks' ? 'problem_bank' : null;
  const libraryResources = resourceLibraryKind === 'notebook' ? visibleNotebookOrder : problemBanks;
  const selectedLibraryResource =
    resources.find((item) => item.reference.id === selectedResourceReferenceId) ?? null;
  const selectedMindMapAssetUrl =
    selectedLibraryResource?.mindMap?.imageUrl ||
    (selectedLibraryResource?.type === 'notebook'
      ? `/api/teacher/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(selectedLibraryResource.id)}/mind-map`
      : '');
  const selectedNotebookSection =
    selectedLibraryResource?.notebookSections?.find(
      (section) => section.id === selectedNotebookSectionId,
    ) ?? selectedLibraryResource?.notebookSections?.[0];
  const selectedNotebookSource =
    selectedLibraryResource?.type === 'notebook' && selectedLibraryResource.sourceFileId
      ? (sources.find((source) => source.sourceFileId === selectedLibraryResource.sourceFileId) ??
        null)
      : null;
  const knowledgeJobsByAsset = useMemo(
    () => latestJobsByAsset(jobs.filter((job) => job.kind !== 'mind_map')),
    [jobs],
  );
  const mindMapJobsByAsset = useMemo(
    () => latestJobsByAsset(jobs.filter((job) => job.kind === 'mind_map')),
    [jobs],
  );
  const persistenceTasksById = useMemo(
    () => new Map(persistenceTasks.map((task) => [task.id, task])),
    [persistenceTasks],
  );
  const persistedNotebookIds = useMemo(() => {
    const notebookIds = persistenceTasks
      .filter((task) => task.persistenceStatus === 'complete' && task.notebookId)
      .map((task) => task.notebookId as string);

    for (const item of content) if (item.type === 'notebook') notebookIds.push(item.id);

    return new Set(notebookIds);
  }, [content, persistenceTasks]);
  const queueJobs = useMemo(() => {
    return jobs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }, [jobs]);
  const counts = useMemo(
    () => ({
      queued: queueJobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    }),
    [queueJobs],
  );
  const sourceCategoryCounts = useMemo(
    () =>
      SOURCE_CATEGORIES.reduce<Record<CourseSourceCategory, number>>(
        (countsByCategory, category) => {
          countsByCategory[category.value] = sources.filter(
            (source) => resolveCourseSourceCategory(source) === category.value,
          ).length;
          return countsByCategory;
        },
        {
          school_teacher_notes: 0,
          crash_course_teacher_notes: 0,
          problem_bank: 0,
        },
      ),
    [sources],
  );
  const categorySources = useMemo(
    () => sources.filter((source) => resolveCourseSourceCategory(source) === sourceCategory),
    [sourceCategory, sources],
  );
  const listTotal =
    tab === 'notebooks'
      ? notebooks.length
      : tab === 'problem_banks'
        ? problemBanks.length
        : tab === 'sources'
          ? categorySources.length
          : tab === 'hard_rules'
            ? hardRules.length
            : tab === 'queue'
              ? queueJobs.length
              : removedContent.length;
  const listPageCount = Math.max(1, Math.ceil(listTotal / STUDIO_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listPageCount);
  const listOffset = (safeListPage - 1) * STUDIO_PAGE_SIZE;
  const pagedLibraryResources = libraryResources.slice(listOffset, listOffset + STUDIO_PAGE_SIZE);
  const visibleSources = categorySources.slice(listOffset, listOffset + STUDIO_PAGE_SIZE);
  const pagedHardRules = hardRules.slice(listOffset, listOffset + STUDIO_PAGE_SIZE);
  const pagedJobs = queueJobs.slice(listOffset, listOffset + STUDIO_PAGE_SIZE);
  const pagedRemovedContent = removedContent.slice(listOffset, listOffset + STUDIO_PAGE_SIZE);

  const handleUpload = async (files: File[]) => {
    if (!teacherId || files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      await uploadOnlineTeacherSources({ courseId, sourceCategory, files });
      setUploading(false);
      setListPage(1);
      await loadStudio().catch(() => {
        setError('文件已经保存到共享数据库，但列表刷新失败；页面会自动重试。');
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '源文件上传失败');
    } finally {
      setUploading(false);
    }
  };

  const closeHardRuleDialog = () => {
    if (
      savingHardRuleId === 'new' ||
      (editingHardRuleId && savingHardRuleId === editingHardRuleId)
    ) {
      return;
    }
    if (editingHardRuleId) {
      const original = hardRules.find((rule) => rule.id === editingHardRuleId)?.content ?? '';
      setHardRuleDrafts((current) => ({ ...current, [editingHardRuleId]: original }));
      dirtyHardRuleIdsRef.current.delete(editingHardRuleId);
    }
    setHardRuleDialogOpen(false);
    setEditingHardRuleId('');
    setNewHardRule('');
  };

  const openCreateHardRuleDialog = () => {
    setEditingHardRuleId('');
    setNewHardRule('');
    setHardRuleDialogOpen(true);
  };

  const openEditHardRuleDialog = (rule: CourseHardRuleRecord) => {
    setEditingHardRuleId(rule.id);
    setHardRuleDrafts((current) => ({
      ...current,
      [rule.id]: current[rule.id] ?? rule.content,
    }));
    setHardRuleDialogOpen(true);
  };

  const handleCreateHardRule = async () => {
    const content = newHardRule.trim();
    if (!content || savingHardRuleId) return;
    setSavingHardRuleId('new');
    setError('');
    try {
      if (localDemo) {
        const now = new Date().toISOString();
        const rule: CourseHardRuleRecord = {
          id: `${courseId}-hard-rule-${Date.now()}`,
          courseId,
          ownerId: teacherId,
          content,
          position: hardRules.length,
          createdAt: now,
          updatedAt: now,
        };
        setHardRules((current) => [...current, rule]);
        setHardRuleDrafts((current) => ({ ...current, [rule.id]: rule.content }));
        setNewHardRule('');
        setHardRuleDialogOpen(false);
        setEditingHardRuleId('');
        setHardRulesLoaded(true);
        hardRulesLoadedRef.current = true;
        return;
      }
      const response = await backendFetch(
        `/api/teacher/courses/${encodeURIComponent(courseId)}/hard-rules`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
          timeoutMs: 20_000,
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        rule?: CourseHardRuleRecord;
        error?: string;
      };
      if (!response.ok || !payload.rule) {
        throw new Error(payload.error || '添加 Hard Rule 失败');
      }
      setHardRules((current) => [...current, payload.rule as CourseHardRuleRecord]);
      setHardRuleDrafts((current) => ({
        ...current,
        [payload.rule!.id]: payload.rule!.content,
      }));
      setNewHardRule('');
      setHardRuleDialogOpen(false);
      setEditingHardRuleId('');
      setHardRulesLoaded(true);
      hardRulesLoadedRef.current = true;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '添加 Hard Rule 失败');
    } finally {
      setSavingHardRuleId('');
    }
  };

  const handleUpdateHardRule = async (rule: CourseHardRuleRecord) => {
    const content = (hardRuleDrafts[rule.id] ?? rule.content).trim();
    if (!content || savingHardRuleId) return;
    setSavingHardRuleId(rule.id);
    setError('');
    try {
      if (localDemo) {
        const savedRule: CourseHardRuleRecord = {
          ...rule,
          content,
          updatedAt: new Date().toISOString(),
        };
        setHardRules((current) =>
          current.map((candidate) => (candidate.id === savedRule.id ? savedRule : candidate)),
        );
        setHardRuleDrafts((current) => ({ ...current, [savedRule.id]: savedRule.content }));
        dirtyHardRuleIdsRef.current.delete(savedRule.id);
        setHardRuleDialogOpen(false);
        setEditingHardRuleId('');
        return;
      }
      const response = await backendFetch(
        `/api/teacher/courses/${encodeURIComponent(courseId)}/hard-rules/${encodeURIComponent(rule.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
          timeoutMs: 20_000,
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        rule?: CourseHardRuleRecord;
        error?: string;
      };
      if (!response.ok || !payload.rule) {
        throw new Error(payload.error || '保存 Hard Rule 失败');
      }
      const savedRule = payload.rule;
      setHardRules((current) =>
        current.map((candidate) => (candidate.id === savedRule.id ? savedRule : candidate)),
      );
      setHardRuleDrafts((current) => ({ ...current, [savedRule.id]: savedRule.content }));
      dirtyHardRuleIdsRef.current.delete(savedRule.id);
      setHardRuleDialogOpen(false);
      setEditingHardRuleId('');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '保存 Hard Rule 失败');
    } finally {
      setSavingHardRuleId('');
    }
  };

  const beginNotebookOrderAdjustment = () => {
    setNotebookOrderDraft(orderedNotebooks.map((notebook) => notebook.id));
    setEditingNotebookOrder(true);
  };

  const cancelNotebookOrderAdjustment = () => {
    if (savingNotebookOrder) return;
    setEditingNotebookOrder(false);
    setNotebookOrderDraft([]);
  };

  const moveNotebookOrderItem = (notebookId: string, direction: -1 | 1) => {
    setNotebookOrderDraft((current) => {
      const index = current.indexOf(notebookId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = current.slice();
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const saveNotebookOrder = async () => {
    if (!teacherId || savingNotebookOrder) return;
    setSavingNotebookOrder(true);
    setError('');
    try {
      await updateOnlineNotebookOrder(courseId, notebookOrderDraft);
      setEditingNotebookOrder(false);
      setNotebookOrderDraft([]);
      setListPage(1);
      await loadStudio();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存课程顺序失败');
    } finally {
      setSavingNotebookOrder(false);
    }
  };

  const openNotebookRename = (item: CourseContentItem) => {
    if (item.type !== 'notebook') return;
    setRenamingNotebook(item);
    setNotebookNameDraft(item.title);
  };

  const closeNotebookRename = () => {
    if (savingNotebookName) return;
    setRenamingNotebook(null);
    setNotebookNameDraft('');
  };

  const saveNotebookName = async () => {
    const nextName = notebookNameDraft.trim();
    if (
      !teacherId ||
      !renamingNotebook ||
      !nextName ||
      nextName === renamingNotebook.title ||
      savingNotebookName
    ) {
      return;
    }

    setSavingNotebookName(true);
    setError('');
    try {
      if (localDemo) {
        setContent((current) =>
          current.map((item) =>
            item.id === renamingNotebook.id
              ? { ...item, title: nextName, updatedAt: Date.now() }
              : item,
          ),
        );
      } else {
        await renameOnlineNotebook(courseId, renamingNotebook.id, nextName);
        await loadStudio();
      }
      setRenamingNotebook(null);
      setNotebookNameDraft('');
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : '笔记本改名失败');
    } finally {
      setSavingNotebookName(false);
    }
  };

  const handleEnqueue = async (assetId: string) => {
    if (!teacherId) return;
    setProcessingSourceIds((current) => new Set(current).add(assetId));
    setError('');
    try {
      await processOnlineSource(courseId, assetId);
      await loadStudio();
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : '加入队列失败');
    } finally {
      setProcessingSourceIds((current) => {
        const next = new Set(current);
        next.delete(assetId);
        return next;
      });
    }
  };

  const handleGenerateMindMap = async (source: CourseContentItem, job: TeacherStudioTask) => {
    if (!teacherId || job.status !== 'completed' || !job.notebookId) return;
    setMindMapSourceAssetId(source.id);
    setError('');
    try {
      await generateOnlineMindMap({
        courseId,
        sourceId: source.id,
        notebookId: job.notebookId,
      });
      await loadStudio();
    } catch (mindMapError) {
      setError(mindMapError instanceof Error ? mindMapError.message : '思维导图生成失败');
      await loadStudio().catch(() => undefined);
    } finally {
      setMindMapSourceAssetId('');
    }
  };

  const handleRetry = async (jobId: string) => {
    setError('');
    try {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) return;
      if (job.kind === 'mind_map' && job.sourceId && job.notebookId) {
        await generateOnlineMindMap({
          courseId,
          sourceId: job.sourceId,
          notebookId: job.notebookId,
        });
      } else if (job.sourceId) {
        await processOnlineSource(courseId, job.sourceId);
      }
      await loadStudio();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '重试失败');
      await loadStudio().catch(() => undefined);
    }
  };

  const handleHideContent = async (item: CourseContentItem) => {
    if (!teacherId) return;
    const groupLabel = item.type === 'source' ? '源文件' : '资料库';
    const confirmed = window.confirm(
      `确定从本学期${groupLabel}删除“${item.title}”吗？\n\n删除后可在“已移除”中恢复；底层文件、历史版本和往届原版都会保留。`,
    );
    if (!confirmed) return;
    setActionReferenceId(item.reference.id);
    setError('');
    try {
      await setOnlineContentRemoved({
        courseId,
        item,
        removed: true,
      });
      if (previewSource?.reference.id === item.reference.id) {
        setPreviewSource(null);
        setSourcePreview(null);
        setSourcePreviewError('');
        setSourcePreviewLoading(false);
      }
      if (selectedResourceReferenceId === item.reference.id) {
        setSelectedResourceReferenceId('');
        setSelectedNotebookSectionId('');
      }
      await loadStudio();
    } catch (hideError) {
      setError(hideError instanceof Error ? hideError.message : '移除失败');
    } finally {
      setActionReferenceId('');
    }
  };

  const switchTab = (value: StudioTab) => {
    if (value !== tab) {
      setError('');
      setEditingNotebookOrder(false);
      setNotebookOrderDraft([]);
      setSelectedResourceReferenceId('');
      setSelectedNotebookSectionId('');
      setMindMapOpen(false);
      setListPage(1);
    }
    setTab(value);
  };

  const openResourceDetail = (item: CourseContentItem) => {
    setSelectedResourceReferenceId(item.reference.id);
    setSelectedNotebookSectionId(item.notebookSections?.[0]?.id ?? '');
  };

  const handleRestoreContent = async (item: CourseContentItem) => {
    if (!teacherId) return;
    setActionReferenceId(item.reference.id);
    setError('');
    try {
      await setOnlineContentRemoved({
        courseId,
        item,
        removed: false,
      });
      await loadStudio();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '恢复失败');
    } finally {
      setActionReferenceId('');
    }
  };

  const confirmPermanentDeleteContent = async () => {
    const item = pendingPermanentDeleteItem;
    if (!teacherId || !item) return;
    setActionReferenceId(item.reference.id);
    setPermanentDeleteReferenceId(item.reference.id);
    setError('');
    try {
      await permanentlyDeleteOnlineContent({
        courseId,
        item,
      });
      await loadStudio();
      setPendingPermanentDeleteItem(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '彻底删除失败');
    } finally {
      setActionReferenceId('');
      setPermanentDeleteReferenceId('');
    }
  };

  const closeSourcePreview = () => {
    setPreviewSource(null);
    setSourcePreview(null);
    setSourcePreviewError('');
    setSourcePreviewLoading(false);
  };

  const handlePreviewSource = async (source: CourseContentItem) => {
    if (!teacherId) return;
    setPreviewSource(source);
    setSourcePreview(null);
    setSourcePreviewError('');
    setSourcePreviewLoading(true);
    try {
      const preview = await getOnlineTeacherSourcePreview(source);
      setSourcePreview(preview);
    } catch (previewError) {
      setSourcePreviewError(
        previewError instanceof Error ? previewError.message : '源文件预览读取失败',
      );
    } finally {
      setSourcePreviewLoading(false);
    }
  };

  const downloadSourcePreview = () => {
    if (!sourcePreview) return;
    const url = URL.createObjectURL(sourcePreview.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sourcePreview.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const openCourseChat = () => {
    router.push(`/learn?courseId=${encodeURIComponent(courseId)}&from=teacher`);
  };

  useEffect(() => {
    if (sourcePreview?.kind !== 'pdf') {
      setSourcePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(sourcePreview.blob);
    setSourcePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourcePreview]);

  useEffect(() => {
    setNotebookFallbackText('');
    setNotebookFallbackError('');
    setNotebookFallbackLoading(false);
    if (
      !teacherId ||
      !selectedLibraryResource ||
      selectedLibraryResource.type !== 'notebook' ||
      selectedLibraryResource.notebookSections?.length ||
      !selectedNotebookSource
    ) {
      return;
    }

    let cancelled = false;
    setNotebookFallbackLoading(true);
    void getOnlineTeacherSourcePreview(selectedNotebookSource)
      .then((preview) => {
        if (cancelled) return;
        const text = preview.text?.trim() || '';
        setNotebookFallbackText(text);
        if (!text) setNotebookFallbackError('关联源文件暂时没有可读取的文本。');
      })
      .catch((previewError) => {
        if (cancelled) return;
        setNotebookFallbackError(
          previewError instanceof Error ? previewError.message : '关联源文件读取失败',
        );
      })
      .finally(() => {
        if (!cancelled) setNotebookFallbackLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, selectedLibraryResource, selectedNotebookSource, teacherId]);

  useEffect(() => {
    setMindMapImageUrl('');
    setMindMapImageError('');
    setMindMapImageLoading(false);
    if (!mindMapOpen || !selectedMindMapAssetUrl) return;
    let cancelled = false;
    let objectUrl = '';
    const controller = new AbortController();
    setMindMapImageLoading(true);
    void backendFetch(selectedMindMapAssetUrl, {
      method: 'GET',
      signal: controller.signal,
      timeoutMs: 20_000,
    })
      .then(async (response) => {
        if (response.status === 404) throw new Error('思维导图文件不存在，请重新生成。');
        if (!response.ok) throw new Error(`思维导图读取失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMindMapImageUrl(objectUrl);
      })
      .catch((mindMapError) => {
        if (!cancelled) {
          const message = mindMapError instanceof Error ? mindMapError.message : '';
          setMindMapImageError(
            /超时|timeout/i.test(message)
              ? '思维导图读取超时，请重新加载。'
              : message || '思维导图图片读取失败，请重新加载。',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setMindMapImageLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mindMapImageReloadKey, mindMapOpen, selectedMindMapAssetUrl]);

  if (!hydrated || !isLoggedIn || role !== 'TEACHER') return null;

  if (accessRevoked) {
    return <CourseAccessClosedCard returnHref="/teacher" returnLabel="返回教师工作台" />;
  }

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在加载课程工作台…
        </span>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="grid min-h-full place-items-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="max-w-md rounded-2xl border bg-white p-6 text-center dark:bg-white/5">
          <AlertCircle className="mx-auto size-8 text-rose-500" />
          <p className="mt-3 font-semibold">{error || '课程不存在'}</p>
          <Button className="mt-4" onClick={() => router.push('/teacher')}>
            返回教师工作台
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-white px-4 py-4 text-slate-950 dark:bg-slate-950 dark:text-white sm:px-6 sm:py-6 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-[1536px] flex-col">
        <section className="border-b border-slate-200/80 pb-6 dark:border-white/10 sm:pb-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="返回教师桌面"
                title="返回教师桌面"
                className="-ml-1.5 size-9 shrink-0 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                onClick={() => router.push('/teacher')}
              >
                <Home className="size-4.5" strokeWidth={1.9} />
              </Button>
              <h1 className="min-w-0 break-words text-2xl font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[28px] lg:text-[2.75rem]">
                {course.code} · {course.academicYear} {academicTermLabel(course.term)}
              </h1>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 sm:gap-5">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white px-3 text-sm font-semibold shadow-none hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/5 sm:h-11 sm:px-4"
                onClick={() => router.push(`/teacher/courses/${courseId}/students`)}
              >
                <Users className="mr-1.5 size-4" />
                学生管理
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white px-3 text-sm font-semibold shadow-none hover:border-indigo-300 hover:bg-indigo-50 dark:border-white/10 dark:bg-transparent dark:hover:bg-indigo-400/10 sm:h-11 sm:px-4"
                onClick={() => router.push(`/course/${encodeURIComponent(courseId)}/problem-bank`)}
              >
                <Library className="mr-1.5 size-4" />
                课程题库
              </Button>
              <Button
                type="button"
                variant="outline"
                className="relative h-10 rounded-xl border-slate-200 bg-white px-3 text-sm font-semibold shadow-none hover:border-violet-300 hover:bg-violet-50 dark:border-white/10 dark:bg-transparent dark:hover:bg-violet-400/10 sm:h-11 sm:px-4"
                onClick={() => router.push(`/course/${encodeURIComponent(courseId)}/forum`)}
              >
                <MessagesSquare className="mr-1.5 size-4" />
                课程论坛
                <span
                  className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white ${unresolvedForumCount > 0 ? 'bg-rose-500' : 'bg-slate-400'}`}
                >
                  {unresolvedForumCount > 99 ? '99+' : unresolvedForumCount}
                </span>
              </Button>
              <Button
                type="button"
                className="h-10 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-[0_7px_20px_rgba(5,150,105,0.18)] hover:bg-emerald-700 sm:h-11 sm:px-4"
                onClick={openCourseChat}
              >
                <MessageCircleMore className="mr-1.5 size-4" />
                课程聊天
              </Button>
            </div>
          </div>
        </section>

        {localDemo ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-100">
            <Database className="mt-0.5 size-4 shrink-0" />
            本地预览模式：课程与用量数据来自演示夹具，可直接调整和检查教师
            UI；上传、删除等真实写入仍需数据库恢复后验证。
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <nav
          className="mt-5 rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1.5 dark:border-white/10 dark:bg-white/[0.04] sm:mt-6"
          aria-label="课程工作台分区"
        >
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['sources', '源文件', FileText, null],
                ['notebooks', '笔记本库', BookOpenText, null],
                ['hard_rules', 'Hard Rule', ShieldCheck, hardRules.length || null],
                ['queue', 'AI 队列', Brain, counts.queued || null],
                ['problem_banks', '题库', Library, null],
                ['removed', '已移除', Trash2, removedContent.length || null],
              ] as const
            ).map(([value, label, Icon, count]) => {
              const active = tab === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchTab(value)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/35 sm:min-w-[7.5rem] sm:flex-none sm:justify-start sm:px-3.5 ${
                    active
                      ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/80 dark:bg-white/[0.1] dark:text-white dark:ring-white/10'
                      : 'text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`size-4 shrink-0 ${active ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}
                    strokeWidth={1.9}
                  />
                  <span className="truncate">{label}</span>
                  {typeof count === 'number' ? (
                    <span
                      className={`inline-flex min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-4 ${
                        active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200'
                          : 'bg-slate-200/80 text-slate-600 dark:bg-white/10 dark:text-slate-300'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>

        {resourceLibraryKind ? (
          <section
            className={
              selectedLibraryResource && resourceLibraryKind === 'notebook'
                ? 'mt-6 flex flex-col overflow-visible rounded-3xl border border-slate-200/80 bg-white/90 dark:border-white/10 dark:bg-white/[0.055] sm:mt-8'
                : STUDIO_SECTION_CLASS
            }
          >
            {resourceLibraryKind === 'problem_bank' ? (
              localDemo ? (
                <div className={STUDIO_PANEL_BODY_CLASS}>
                  <StudioEmptyPlaceholder>
                    <div className="flex flex-col items-center gap-2 px-4">
                      <span className="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                        <Library className="size-5" />
                      </span>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        本地预览不加载真实题库
                      </p>
                      <p className="max-w-sm text-xs leading-5 text-slate-400 dark:text-slate-500">
                        使用 Speedup 教师身份进入课程后，可以管理、导入和练习数据库中的真实题目。
                      </p>
                    </div>
                  </StudioEmptyPlaceholder>
                </div>
              ) : (
                <div className="flex min-h-[min(706px,72dvh)] flex-1 overflow-hidden p-2">
                  <CourseProblemBankView
                    courseId={courseId}
                    showCourseTitle={false}
                    showChromeBackground={false}
                  />
                </div>
              )
            ) : selectedLibraryResource ? (
              <div className="flex flex-col bg-slate-50/80 dark:bg-slate-950">
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white px-5 py-3 dark:border-white/10 dark:bg-slate-950">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedResourceReferenceId('');
                      setSelectedNotebookSectionId('');
                      setMindMapOpen(false);
                    }}
                  >
                    <ArrowLeft className="mr-1.5 size-3.5" />
                    返回列表
                  </Button>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {TYPE_META[selectedLibraryResource.type].label}
                  </span>
                  {selectedLibraryResource.type === 'notebook' ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${persistedNotebookIds.has(selectedLibraryResource.id) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200'}`}
                    >
                      <Database className="size-3" />
                      {persistedNotebookIds.has(selectedLibraryResource.id)
                        ? '已保存到共享数据库'
                        : '持久化状态未确认'}
                    </span>
                  ) : null}
                  {selectedLibraryResource.reference.inheritedFromCourseId ? (
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
                      历史引用
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {selectedLibraryResource.type === 'notebook' ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openNotebookRename(selectedLibraryResource)}
                        >
                          <Pencil className="mr-1.5 size-3.5" />
                          重命名
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setMindMapOpen(true)}>
                          <Network className="mr-1.5 size-3.5" />
                          查看思维导图
                        </Button>
                      </>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-500 hover:text-rose-600"
                      disabled={actionReferenceId === selectedLibraryResource.reference.id}
                      onClick={() => void handleHideContent(selectedLibraryResource)}
                    >
                      {actionReferenceId === selectedLibraryResource.reference.id ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 size-3.5" />
                      )}
                      删除
                    </Button>
                  </div>
                </div>

                {selectedLibraryResource.type === 'notebook' ? (
                  <div className="p-4 sm:p-6">
                    <div className="w-full">
                      <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                        {selectedLibraryResource.title}
                      </h2>
                      {selectedLibraryResource.description &&
                      selectedLibraryResource.notebookSections?.length ? (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {selectedLibraryResource.description}
                        </p>
                      ) : null}
                      {selectedLibraryResource.generation ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
                          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10">
                            质量 {selectedLibraryResource.generation.qualityScore}/100
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10">
                            {selectedLibraryResource.generation.totalTokens.toLocaleString('zh-CN')}{' '}
                            tokens
                          </span>
                        </div>
                      ) : null}

                      {selectedLibraryResource.notebookSections?.length ? (
                        <div className="mt-5 grid rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900 md:grid-cols-[300px_minmax(0,1fr)] md:items-start">
                          <aside className="border-b border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03] md:border-r md:border-b-0">
                            <p className="px-2 py-1 text-xs font-semibold text-slate-500">章节</p>
                            <div className="mt-1 space-y-1.5">
                              {selectedLibraryResource.notebookSections.map((section) => (
                                <button
                                  key={section.id}
                                  type="button"
                                  onClick={() => setSelectedNotebookSectionId(section.id)}
                                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${selectedNotebookSection?.id === section.id ? 'bg-white text-sky-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-sky-100 dark:ring-white/10' : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white'}`}
                                >
                                  <span className="block text-sm font-semibold leading-5">
                                    {section.title}
                                  </span>
                                  {section.summary ? (
                                    <span className="mt-1.5 block line-clamp-2 text-xs leading-5 text-slate-400">
                                      {section.summary}
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          </aside>
                          <article className="min-w-0 p-5 sm:p-7">
                            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                              {selectedNotebookSection?.title}
                            </h3>
                            {selectedNotebookSection?.sourcePages.length ? (
                              <p className="mt-1 text-xs text-slate-400">
                                来源页码：{selectedNotebookSection.sourcePages.join('、')}
                              </p>
                            ) : null}
                            <MessageResponse className="mt-5 text-sm leading-7">
                              {selectedNotebookSection?.markdown || '该章节没有可预览内容。'}
                            </MessageResponse>
                          </article>
                        </div>
                      ) : (
                        <article className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-slate-900 sm:p-7">
                          {notebookFallbackLoading ? (
                            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
                              <Loader2 className="size-4 animate-spin" />
                              正在读取关联源文件…
                            </div>
                          ) : notebookFallbackText ? (
                            <MessageResponse className="text-sm leading-7">
                              {notebookFallbackText}
                            </MessageResponse>
                          ) : selectedLibraryResource.description ? (
                            <MessageResponse className="text-sm leading-7">
                              {selectedLibraryResource.description}
                            </MessageResponse>
                          ) : (
                            <p className="text-center text-sm text-slate-500">
                              这本笔记本还没有可预览内容。
                            </p>
                          )}
                          {notebookFallbackError ? (
                            <p className="mt-5 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                              {notebookFallbackError}
                            </p>
                          ) : null}
                        </article>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/80 dark:bg-slate-950 lg:flex-row">
                <aside className="flex max-h-72 shrink-0 flex-col border-b border-slate-200/80 bg-white/90 p-3 dark:border-white/10 dark:bg-white/[0.035] sm:p-4 lg:max-h-none lg:w-72 lg:border-r lg:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                        课程顺序
                      </h2>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">
                        AI 与学生进度条按此顺序读取
                      </p>
                    </div>
                    {!editingNotebookOrder ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 rounded-xl px-2.5"
                        disabled={orderedNotebooks.length === 0}
                        onClick={beginNotebookOrderAdjustment}
                      >
                        <ListOrdered className="mr-1.5 size-3.5" />
                        调整顺序
                      </Button>
                    ) : null}
                  </div>

                  {editingNotebookOrder ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl"
                        disabled={savingNotebookOrder}
                        onClick={cancelNotebookOrderAdjustment}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1 rounded-xl"
                        disabled={savingNotebookOrder}
                        onClick={() => void saveNotebookOrder()}
                      >
                        {savingNotebookOrder ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <ListOrdered className="mr-1.5 size-3.5" />
                        )}
                        保存顺序
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                    {visibleNotebookOrder.map((notebook, index) =>
                      editingNotebookOrder ? (
                        <div
                          key={notebook.reference.id}
                          className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-white/5"
                        >
                          <GripVertical className="size-3.5 shrink-0 text-slate-300" />
                          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-white text-[10px] font-bold text-slate-500 ring-1 ring-slate-200/80 dark:bg-white/10 dark:ring-white/10">
                            {index + 1}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200"
                            title={notebook.title}
                          >
                            {notebook.title}
                          </span>
                          <span className="flex shrink-0 gap-0.5">
                            <button
                              type="button"
                              className="grid size-6 place-items-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-white"
                              aria-label={`将 ${notebook.title} 上移`}
                              disabled={index === 0 || savingNotebookOrder}
                              onClick={() => moveNotebookOrderItem(notebook.id, -1)}
                            >
                              <ArrowUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="grid size-6 place-items-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-white"
                              aria-label={`将 ${notebook.title} 下移`}
                              disabled={
                                index === visibleNotebookOrder.length - 1 || savingNotebookOrder
                              }
                              onClick={() => moveNotebookOrderItem(notebook.id, 1)}
                            >
                              <ArrowDown className="size-3.5" />
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          key={notebook.reference.id}
                          type="button"
                          onClick={() => openResourceDetail(notebook)}
                          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                            {index + 1}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-xs font-medium"
                            title={notebook.title}
                          >
                            {notebook.title}
                          </span>
                        </button>
                      ),
                    )}
                    {visibleNotebookOrder.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400 dark:border-white/10">
                        还没有上传笔记本
                      </p>
                    ) : null}
                  </div>
                </aside>

                <div className={`${STUDIO_PANEL_BODY_CLASS} min-w-0`}>
                  <div className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-1 flex-col">
                    {libraryResources.length ? (
                      <div className="grid min-h-0 flex-1 auto-rows-[220px] grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6 xl:h-full xl:auto-rows-auto xl:grid-cols-4 xl:grid-rows-2 xl:gap-x-10 xl:gap-y-8">
                        {Array.from({ length: NOTEBOOK_GRID_CAPACITY }, (_, index) => {
                          const item = pagedLibraryResources[index];
                          if (!item) {
                            return (
                              <div
                                key={`notebook-slot-${index}`}
                                className="hidden min-h-0 rounded-2xl border border-dashed border-slate-200/80 bg-transparent dark:border-white/10 xl:block"
                                aria-hidden
                              />
                            );
                          }
                          return (
                            <article
                              key={item.reference.id}
                              className="group relative mx-auto h-full min-h-0 w-full max-w-[220px]"
                            >
                              <button
                                type="button"
                                aria-label={`打开 ${item.title}`}
                                onClick={() => openResourceDetail(item)}
                                className="block size-full text-left transition duration-150 hover:-translate-y-1 hover:-rotate-[0.6deg] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                              >
                                <TeacherNotebookCardFace
                                  item={item}
                                  persisted={persistedNotebookIds.has(item.id)}
                                />
                              </button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="absolute -right-2 -top-2 z-10 size-8 rounded-full bg-white p-0 text-slate-500 shadow-md hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-900"
                                aria-label={`删除 ${item.title}`}
                                disabled={actionReferenceId === item.reference.id}
                                onClick={() => void handleHideContent(item)}
                              >
                                {actionReferenceId === item.reference.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="absolute -right-2 top-8 z-10 size-8 rounded-full bg-white p-0 text-slate-500 shadow-md hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:bg-slate-900"
                                aria-label={`重命名 ${item.title}`}
                                onClick={() => openNotebookRename(item)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <StudioEmptyPlaceholder>还没有笔记本。</StudioEmptyPlaceholder>
                    )}
                  </div>
                </div>
              </div>
            )}
            {resourceLibraryKind === 'notebook' ? (
              <StudioPagination
                page={safeListPage}
                pageCount={listPageCount}
                total={listTotal}
                onPage={setListPage}
              />
            ) : null}
          </section>
        ) : null}

        {tab === 'hard_rules' ? (
          <section className="flex min-h-[calc(100dvh-300px)] flex-1 flex-col pt-6 sm:pt-8">
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                size="sm"
                className="rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                disabled={hardRules.length >= 30}
                onClick={openCreateHardRuleDialog}
              >
                <Plus className="mr-1.5 size-3.5" />
                添加规则
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {hardRulesLoading && !hardRulesLoaded ? (
                <StudioEmptyPlaceholder>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    正在读取 Hard Rule…
                  </span>
                </StudioEmptyPlaceholder>
              ) : hardRules.length ? (
                <StudioList className="dark:bg-white/[0.02]">
                  {pagedHardRules.map((rule, index) => {
                    const draft = hardRuleDrafts[rule.id] ?? rule.content;
                    const changed = draft.trim() !== rule.content.trim();
                    return (
                      <StudioListItem
                        key={rule.id}
                        density="compact"
                        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4 lg:min-h-[52px] lg:gap-6"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <StudioItemIcon
                            compact
                            round
                            tone={changed ? 'amber' : 'violet'}
                            className="text-xs font-bold"
                          >
                            {listOffset + index + 1}
                          </StudioItemIcon>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950 dark:text-white">
                              {draft || '（空规则）'}
                            </h3>
                            <div className="flex shrink-0 items-center gap-1 overflow-hidden">
                              <StudioItemTag tone="neutral">{draft.length}/1000</StudioItemTag>
                              <StudioItemTag tone="violet">强制规则</StudioItemTag>
                            </div>
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:justify-end">
                          <StudioStatusBadge tone={changed ? 'amber' : 'emerald'}>
                            {changed ? (
                              <Clock3 className="size-3" />
                            ) : (
                              <ShieldCheck className="size-3" />
                            )}
                            {changed ? '未保存' : '已注入 Agent'}
                          </StudioStatusBadge>
                          <StudioStatusBadge tone="indigo">
                            <Database className="size-3" />
                            已持久化
                          </StudioStatusBadge>
                          <p className="shrink-0 text-[10px] text-slate-400 lg:text-right">
                            {new Date(rule.updatedAt).toLocaleString('zh-CN')}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 px-2.5 text-xs"
                            onClick={() => openEditHardRuleDialog(rule)}
                          >
                            <Pencil className="mr-1 size-3" />
                            编辑
                          </Button>
                        </div>
                      </StudioListItem>
                    );
                  })}
                </StudioList>
              ) : (
                <StudioEmptyPlaceholder>
                  还没有 Hard Rule。添加后，下一次课程聊天就会自动遵循。
                </StudioEmptyPlaceholder>
              )}
            </div>
            {hardRules.length ? (
              <StudioPagination
                page={safeListPage}
                pageCount={listPageCount}
                total={listTotal}
                onPage={setListPage}
              />
            ) : null}
          </section>
        ) : null}

        {tab === 'sources' ? (
          <section className={STUDIO_SECTION_CLASS}>
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200/80 p-5 dark:border-white/10 lg:flex-row lg:items-stretch">
              <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
                {SOURCE_CATEGORIES.map((category) => {
                  const selected = sourceCategory === category.value;
                  return (
                    <button
                      key={category.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSourceCategory(category.value);
                        setListPage(1);
                      }}
                      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${selected ? 'border-sky-300 bg-sky-50 shadow-sm dark:border-sky-400/40 dark:bg-sky-400/10' : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'}`}
                    >
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? 'bg-sky-500 text-white' : 'bg-white text-slate-500 shadow-sm dark:bg-white/10'}`}
                      >
                        <category.Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-semibold">
                          {category.label}
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-white/10 dark:text-slate-300">
                            {sourceCategoryCounts[category.value]}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {category.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex shrink-0 flex-col gap-2 lg:min-w-[10.5rem]">
                {sourceCategory === 'problem_bank' ? (
                  <button
                    type="button"
                    onClick={() => switchTab('problem_banks')}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                  >
                    <Library className="size-4" />
                    进入题库管理
                  </button>
                ) : (
                  <label
                    className={`inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {uploading ? '正在保存…' : `上传${SOURCE_CATEGORY_META[sourceCategory].label}`}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.pptx,.docx,.md,.txt,text/plain,text/markdown,application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        void handleUpload(files);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <div className={STUDIO_PANEL_BODY_CLASS}>
              {categorySources.length ? (
                <StudioList>
                  {visibleSources.map((source) => {
                    const job = knowledgeJobsByAsset.get(source.id);
                    const mindMapJob = mindMapJobsByAsset.get(source.id);
                    const pending = job?.status === 'queued' || job?.status === 'running';
                    const categoryMeta = SOURCE_CATEGORY_META[resolveCourseSourceCategory(source)];
                    const CategoryIcon = categoryMeta.Icon;
                    const linkedNotebook = notebooks.find(
                      (notebook) =>
                        notebook.id === job?.notebookId ||
                        notebook.id === `teacher-notebook:${source.id}` ||
                        notebook.sourceFileId === source.id,
                    );
                    const hasMindMap = Boolean(linkedNotebook?.mindMap);
                    const generatingMindMap =
                      !hasMindMap &&
                      (mindMapSourceAssetId === source.id ||
                        mindMapJob?.status === 'queued' ||
                        mindMapJob?.status === 'running');
                    return (
                      <StudioListItem
                        key={source.reference.id}
                        className="flex flex-col gap-3 sm:flex-row sm:items-center"
                      >
                        <StudioItemIcon>
                          <CategoryIcon className="size-4" />
                        </StudioItemIcon>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold">{source.title}</h3>
                            <StudioItemTag className="rounded-full">
                              {categoryMeta.label}
                            </StudioItemTag>
                            <StudioItemTag className="rounded-full" tone="emerald">
                              <Database className="size-3" />
                              已保存到共享数据库
                            </StudioItemTag>
                            {source.reference.inheritedFromCourseId ? (
                              <StudioItemTag tone="sky" className="rounded-full">
                                历史引用
                              </StudioItemTag>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {source.description || '数据库源文件'} ·{' '}
                            {job ? queueStageLabel(job) : '尚未加入 AI'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {resolveCourseSourceCategory(source) !== 'problem_bank' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                job?.status !== 'completed' || generatingMindMap || hasMindMap
                              }
                              title={
                                hasMindMap
                                  ? '思维导图已经生成，请前往笔记本库查看'
                                  : job?.status === 'completed'
                                    ? undefined
                                    : '请先将讲义加入 AI 知识库并生成笔记本'
                              }
                              onClick={() => job && void handleGenerateMindMap(source, job)}
                            >
                              {generatingMindMap ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : hasMindMap ? (
                                <CheckCircle2 className="mr-1.5 size-3.5" />
                              ) : (
                                <Network className="mr-1.5 size-3.5" />
                              )}
                              {generatingMindMap
                                ? '正在生成…'
                                : hasMindMap
                                  ? '已生成思维导图'
                                  : '生成思维导图'}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`在线预览 ${source.title}`}
                            onClick={() => void handlePreviewSource(source)}
                          >
                            <Eye className="mr-1.5 size-3.5" />
                            在线预览
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-slate-500 hover:text-rose-600"
                            disabled={actionReferenceId === source.reference.id}
                            onClick={() => void handleHideContent(source)}
                          >
                            {actionReferenceId === source.reference.id ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1.5 size-3.5" />
                            )}
                            移除
                          </Button>
                          {job?.status === 'completed' ? (
                            <span className="inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                              <CheckCircle2 className="size-4" />
                              已入库
                            </span>
                          ) : job?.status === 'failed' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleRetry(job.id)}
                            >
                              <RefreshCw className="mr-1.5 size-3.5" />
                              重试
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={pending || processingSourceIds.has(source.id)}
                              aria-label={`将 ${source.title} 加入 AI 知识库`}
                              onClick={() => void handleEnqueue(source.id)}
                            >
                              {pending || processingSourceIds.has(source.id) ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <Brain className="mr-1.5 size-3.5" />
                              )}
                              {pending || processingSourceIds.has(source.id)
                                ? '处理中'
                                : '加入 AI 知识库'}
                            </Button>
                          )}
                        </div>
                      </StudioListItem>
                    );
                  })}
                </StudioList>
              ) : (
                <StudioEmptyPlaceholder>
                  还没有{SOURCE_CATEGORY_META[sourceCategory].label}。上传不会自动触发 AI。
                </StudioEmptyPlaceholder>
              )}
            </div>
            <StudioPagination
              page={safeListPage}
              pageCount={listPageCount}
              total={listTotal}
              onPage={setListPage}
            />
          </section>
        ) : null}

        {tab === 'queue' ? (
          <section className="flex min-h-[calc(100dvh-300px)] flex-1 flex-col pt-6 sm:pt-8">
            <div className="min-h-0 flex-1">
              {queueJobs.length ? (
                <StudioList className="dark:bg-white/[0.02]">
                  {pagedJobs.map((job) => {
                    const source = content.find((item) => item.id === job.sourceAssetId);
                    const sourceTitle = source?.title || job.sourceFileId;
                    const persistenceTask = persistenceTasksById.get(job.id);
                    const persistedArtifact =
                      job.persistenceStatus === 'complete' ||
                      Boolean(
                        job.notebookId &&
                        persistedNotebookIds.has(job.notebookId) &&
                        (job.kind !== 'mind_map' ||
                          content.find((item) => item.id === job.notebookId)?.mindMap),
                      );
                    const persistenceStatus =
                      persistenceTask?.persistenceStatus ??
                      (persistedArtifact ? 'complete' : 'unconfirmed');
                    const isCompleted = job.status === 'completed';
                    const isFailed = job.status === 'failed';
                    const isRunning = job.status === 'running';
                    const statusLabel = isCompleted
                      ? '已完成'
                      : isFailed
                        ? '失败'
                        : isRunning
                          ? '处理中'
                          : '等待中';
                    const progress = Math.max(0, Math.min(100, job.progress));
                    return (
                      <StudioListItem
                        key={job.id}
                        density="compact"
                        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4 sm:gap-y-2 lg:min-h-[52px] lg:grid-cols-[minmax(300px,1fr)_minmax(260px,1.15fr)_minmax(345px,0.9fr)] lg:items-center lg:gap-4 xl:gap-6"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <StudioItemIcon
                            compact
                            round
                            tone={isCompleted ? 'emerald' : isFailed ? 'rose' : 'sky'}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="size-4.5" strokeWidth={1.8} />
                            ) : isFailed ? (
                              <AlertCircle className="size-4.5" strokeWidth={1.8} />
                            ) : job.kind === 'mind_map' ? (
                              <Network
                                className={`size-4.5 ${isRunning ? 'animate-pulse' : ''}`}
                                strokeWidth={1.8}
                              />
                            ) : (
                              <Brain
                                className={`size-4.5 ${isRunning ? 'animate-pulse' : ''}`}
                                strokeWidth={1.8}
                              />
                            )}
                          </StudioItemIcon>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950 dark:text-white">
                              {sourceTitle}
                            </h3>
                            <div className="flex shrink-0 items-center gap-1 overflow-hidden">
                              {[
                                queueFileTypeLabel(sourceTitle),
                                job.kind === 'mind_map' ? '思维导图' : '知识库',
                                '自动处理',
                              ].map((label) => (
                                <StudioItemTag key={label} tone="neutral">
                                  {label}
                                </StudioItemTag>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 sm:col-span-2 sm:row-start-2 lg:col-span-1 lg:col-start-auto lg:row-start-auto">
                          <div className="flex items-center justify-between gap-3 text-xs font-medium">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={`shrink-0 ${isFailed ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}
                              >
                                {queueStageLabel(job)}
                              </span>
                              {job.errorReason ? (
                                <span
                                  className="min-w-0 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500"
                                  title={queueErrorLabel(job.errorReason)}
                                >
                                  · {queueErrorLabel(job.errorReason)}
                                </span>
                              ) : null}
                            </div>
                            <span
                              className={`shrink-0 tabular-nums ${isCompleted ? 'text-emerald-700 dark:text-emerald-300' : isFailed ? 'text-rose-700 dark:text-rose-300' : 'text-sky-700 dark:text-sky-300'}`}
                            >
                              {progress}%
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10"
                            aria-label={`处理进度 ${progress}%`}
                          >
                            <div
                              className={`relative h-full rounded-full transition-[width] duration-500 ease-out ${isFailed ? 'bg-rose-500' : isCompleted ? 'bg-emerald-500' : 'bg-sky-500'}`}
                              style={{ width: `${progress}%` }}
                            >
                              {isRunning ? (
                                <span className="absolute inset-0 animate-pulse bg-white/20" />
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:col-start-2 sm:row-start-1 sm:flex-nowrap sm:justify-end lg:col-start-auto lg:row-start-auto">
                          <div className="flex shrink-0 gap-1.5">
                            <StudioStatusBadge
                              tone={isCompleted ? 'emerald' : isFailed ? 'rose' : 'sky'}
                            >
                              {statusLabel}
                            </StudioStatusBadge>
                            <StudioStatusBadge
                              tone={
                                persistenceStatus === 'complete'
                                  ? 'indigo'
                                  : persistenceStatus === 'failed'
                                    ? 'rose'
                                    : persistenceStatus === 'pending'
                                      ? 'amber'
                                      : 'neutral'
                              }
                            >
                              <Database className="size-3" />
                              {persistenceStatus === 'complete'
                                ? '已持久化'
                                : persistenceStatus === 'failed'
                                  ? '持久化失败'
                                  : persistenceStatus === 'pending'
                                    ? '正在持久化'
                                    : '持久化未确认'}
                            </StudioStatusBadge>
                          </div>
                          <p className="shrink-0 text-[10px] text-slate-400 lg:text-right">
                            {job.attemptCount > 1 ? `已尝试 ${job.attemptCount} 次 · ` : ''}
                            {new Date(job.updatedAt).toLocaleString('zh-CN')}
                          </p>
                          {isFailed ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 px-2.5 text-xs"
                              onClick={() => void handleRetry(job.id)}
                            >
                              <RefreshCw className="mr-1 size-3" />
                              重新处理
                            </Button>
                          ) : null}
                        </div>
                      </StudioListItem>
                    );
                  })}
                </StudioList>
              ) : (
                <div className="grid min-h-[320px] place-items-center rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                  <div>
                    <FileText className="mx-auto size-9 text-slate-300 dark:text-slate-600" />
                    <p className="mt-3">队列为空。请在源文件旁点击“加入 AI 知识库”。</p>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-auto pt-12">
              <StudioPagination
                page={safeListPage}
                pageCount={listPageCount}
                total={listTotal}
                onPage={setListPage}
              />
            </div>
          </section>
        ) : null}

        {tab === 'removed' ? (
          <section className="flex min-h-[calc(100dvh-300px)] flex-1 flex-col pt-6 sm:pt-8">
            <div className="min-h-0 flex-1">
              {removedContent.length ? (
                <StudioList className="dark:bg-white/[0.02]">
                  {pagedRemovedContent.map((item) => {
                    const meta = TYPE_META[item.type];
                    return (
                      <StudioListItem
                        key={item.reference.id}
                        className="flex flex-col gap-3 sm:flex-row sm:items-center"
                      >
                        <StudioItemIcon>
                          <meta.icon className="size-4" />
                        </StudioItemIcon>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold">{item.title}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {meta.label}
                            {item.reference.hiddenAt
                              ? ` · ${new Date(item.reference.hiddenAt).toLocaleString('zh-CN')} 移除`
                              : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              item.reference.status === 'superseded' ||
                              actionReferenceId === item.reference.id
                            }
                            onClick={() => void handleRestoreContent(item)}
                          >
                            {actionReferenceId === item.reference.id &&
                            permanentDeleteReferenceId !== item.reference.id ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-1.5 size-3.5" />
                            )}
                            {item.reference.status === 'superseded' ? '已被新版本替换' : '恢复显示'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-400/25 dark:text-rose-300 dark:hover:bg-rose-400/10"
                            disabled={actionReferenceId === item.reference.id}
                            onClick={() => setPendingPermanentDeleteItem(item)}
                          >
                            {permanentDeleteReferenceId === item.reference.id ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1.5 size-3.5" />
                            )}
                            彻底删除
                          </Button>
                        </div>
                      </StudioListItem>
                    );
                  })}
                </StudioList>
              ) : (
                <StudioEmptyPlaceholder>没有已移除的课程内容。</StudioEmptyPlaceholder>
              )}
            </div>
            <StudioPagination
              page={safeListPage}
              pageCount={listPageCount}
              total={listTotal}
              onPage={setListPage}
            />
          </section>
        ) : null}
      </div>

      <Dialog
        open={hardRuleDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeHardRuleDialog();
            return;
          }
          setHardRuleDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>{editingHardRuleId ? '编辑 Hard Rule' : '添加新的 Hard Rule'}</DialogTitle>
            <DialogDescription>
              规则会注入课程聊天的 system prompt。每门课程最多 30 条，每条最多 1000 字。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1">
            {(() => {
              const editingRule = editingHardRuleId
                ? hardRules.find((rule) => rule.id === editingHardRuleId)
                : null;
              const dialogValue = editingRule
                ? (hardRuleDrafts[editingRule.id] ?? editingRule.content)
                : newHardRule;
              const dialogChanged = editingRule
                ? dialogValue.trim() !== editingRule.content.trim()
                : Boolean(dialogValue.trim());
              return (
                <>
                  <Textarea
                    id="course-hard-rule-dialog"
                    value={dialogValue}
                    maxLength={1000}
                    rows={4}
                    className="min-h-28 resize-y rounded-xl border-violet-200 bg-violet-50/40 shadow-none dark:border-violet-400/20 dark:bg-violet-400/[0.06]"
                    placeholder="例如：讲解代码时必须先解释运行结果，再展示实现；不得直接给出作业最终答案。"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (editingRule) {
                        if (value.trim() === editingRule.content.trim()) {
                          dirtyHardRuleIdsRef.current.delete(editingRule.id);
                        } else {
                          dirtyHardRuleIdsRef.current.add(editingRule.id);
                        }
                        setHardRuleDrafts((current) => ({
                          ...current,
                          [editingRule.id]: value,
                        }));
                        return;
                      }
                      setNewHardRule(value);
                    }}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs tabular-nums text-slate-400">
                      {dialogValue.length}/1000 · {hardRules.length}/30 条
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={closeHardRuleDialog}
                      >
                        取消
                      </Button>
                      {editingRule ? (
                        <Button
                          type="button"
                          className="rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                          disabled={
                            !dialogChanged ||
                            !dialogValue.trim() ||
                            savingHardRuleId === editingRule.id
                          }
                          onClick={() => void handleUpdateHardRule(editingRule)}
                        >
                          {savingHardRuleId === editingRule.id ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1.5 size-3.5" />
                          )}
                          保存修改
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          className="rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                          disabled={
                            !newHardRule.trim() ||
                            savingHardRuleId === 'new' ||
                            hardRules.length >= 30
                          }
                          onClick={() => void handleCreateHardRule()}
                        >
                          {savingHardRuleId === 'new' ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Plus className="mr-1.5 size-3.5" />
                          )}
                          添加规则
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renamingNotebook)}
        onOpenChange={(open) => {
          if (!open) closeNotebookRename();
        }}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>重命名 AI 笔记本</DialogTitle>
            <DialogDescription className="leading-6">
              名称会同步到老师资料库、学生课程页和课程聊天引用中；笔记本内容不会改变。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 space-y-2">
            <label
              htmlFor="teacher-notebook-name"
              className="text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              笔记本名称
            </label>
            <Input
              id="teacher-notebook-name"
              autoFocus
              maxLength={120}
              value={notebookNameDraft}
              placeholder="输入新的笔记本名称"
              className="h-11 rounded-xl"
              onChange={(event) => setNotebookNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveNotebookName();
              }}
            />
            <p className="text-right text-xs tabular-nums text-slate-400">
              {notebookNameDraft.length}/120
            </p>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={savingNotebookName}
              onClick={closeNotebookRename}
            >
              取消
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-violet-600 text-white hover:bg-violet-700"
              disabled={
                savingNotebookName ||
                !notebookNameDraft.trim() ||
                notebookNameDraft.trim() === renamingNotebook?.title
              }
              onClick={() => void saveNotebookName()}
            >
              {savingNotebookName ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-3.5" />
              )}
              保存名称
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mindMapOpen} onOpenChange={setMindMapOpen}>
        <DialogContent className="flex max-h-[min(820px,90dvh)] max-w-[min(920px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200/80 px-5 py-4 pr-14 dark:border-white/10">
            <DialogTitle className="text-base">思维导图</DialogTitle>
            <DialogDescription>
              {selectedLibraryResource?.title || '笔记本结构预览'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-5 dark:bg-slate-950 sm:p-6">
            {mindMapImageLoading ? (
              <div className="grid min-h-64 place-items-center text-sm text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  正在读取思维导图…
                </span>
              </div>
            ) : mindMapImageUrl ? (
              <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
                {/* Generated course artifact served through the authenticated teacher API. */}
                <img
                  src={mindMapImageUrl}
                  alt={`${selectedLibraryResource?.title || '笔记本'}思维导图`}
                  className="h-auto w-full"
                />
              </div>
            ) : mindMapImageError ? (
              <div className="grid min-h-64 place-items-center text-center text-sm text-rose-600">
                <div>
                  <AlertCircle className="mx-auto mb-2 size-5" />
                  <p>{mindMapImageError}</p>
                  <Button
                    className="mt-4"
                    size="sm"
                    variant="outline"
                    onClick={() => setMindMapImageReloadKey((key) => key + 1)}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    重新加载
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-sm text-slate-500">
                这本笔记本还没有思维导图。请在对应讲义旁点击“生成思维导图”。
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingPermanentDeleteItem)}
        onOpenChange={(open) => {
          if (!open && !permanentDeleteReferenceId) setPendingPermanentDeleteItem(null);
        }}
      >
        <DialogContent size="compact" className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>彻底删除课程内容？</DialogTitle>
            <DialogDescription className="leading-6">
              “{pendingPermanentDeleteItem?.title}”将从已移除列表中永久删除，此操作不可恢复。
              若底层文件未被其他课程或资料引用，也会一并清理。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(permanentDeleteReferenceId)}
              onClick={() => setPendingPermanentDeleteItem(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={Boolean(permanentDeleteReferenceId)}
              onClick={() => void confirmPermanentDeleteContent()}
            >
              {permanentDeleteReferenceId ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" />
              )}
              确认彻底删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewSource)} onOpenChange={(open) => !open && closeSourcePreview()}>
        <DialogContent className="h-[min(860px,92dvh)] max-h-[92dvh] max-w-[min(1180px,calc(100vw-1.5rem))] gap-0 rounded-3xl p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200/80 px-5 py-4 pr-14 dark:border-white/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <DialogTitle className="truncate pr-2 text-base">
                  {previewSource?.title || '源文件预览'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  在线预览
                  {sourcePreview
                    ? ` · ${sourcePreview.mimeType || '未知类型'} · ${formatFileSize(sourcePreview.size)}`
                    : ''}
                </DialogDescription>
              </div>
              {sourcePreview ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mr-0 w-fit shrink-0 sm:mr-8"
                  onClick={downloadSourcePreview}
                >
                  <Download className="mr-1.5 size-3.5" />
                  下载原文件
                </Button>
              ) : null}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden bg-slate-100/70 dark:bg-slate-900/70">
            {sourcePreviewLoading ? (
              <div className="grid h-full min-h-64 place-items-center text-sm text-slate-500">
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  正在读取源文件…
                </span>
              </div>
            ) : sourcePreviewError ? (
              <div className="grid h-full min-h-64 place-items-center p-6">
                <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-5 text-center dark:border-amber-400/20 dark:bg-white/5">
                  <AlertCircle className="mx-auto size-7 text-amber-500" />
                  <p className="mt-3 text-sm font-semibold">暂时无法在线预览</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{sourcePreviewError}</p>
                </div>
              </div>
            ) : sourcePreview?.kind === 'pdf' && sourcePreviewUrl ? (
              <iframe
                title={`${sourcePreview.fileName} 在线预览`}
                src={sourcePreviewUrl}
                className="h-full min-h-64 w-full border-0 bg-white"
              />
            ) : sourcePreview?.kind === 'markdown' ? (
              <div className="h-full overflow-y-auto p-4 sm:p-7">
                <article className="mx-auto max-w-4xl rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-950 sm:p-8">
                  <MessageResponse className="text-sm leading-7">
                    {sourcePreview.text || '该文件没有可预览的文本。'}
                  </MessageResponse>
                </article>
              </div>
            ) : sourcePreview ? (
              <div className="h-full overflow-y-auto p-4 sm:p-7">
                <article className="mx-auto max-w-4xl rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-950 sm:p-8">
                  {sourcePreview.kind === 'office' ? (
                    <p className="mb-4 text-xs font-semibold text-slate-400">
                      文档文本预览
                      {sourcePreview.pageCount ? ` · ${sourcePreview.pageCount} 页` : ''}
                    </p>
                  ) : null}
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-700 dark:text-slate-200">
                    {sourcePreview.text || '该文件没有可预览的文本。'}
                  </pre>
                </article>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeacherNotebookCardFace({
  item,
  persisted,
}: {
  item: CourseContentItem;
  persisted: boolean;
}) {
  const typeLabel = item.sourceFileId ? 'Markdown' : '讲义';
  const subtitle = item.notebookSections?.length
    ? `${item.notebookSections.length} 章节`
    : item.sourceFileId
      ? '关联源文件'
      : '课程笔记本';
  const dateLabel = new Date(item.updatedAt).toLocaleDateString('zh-CN');

  return (
    <div className="relative size-full text-left">
      <span className="absolute inset-y-1 left-0 z-[3] flex w-[18px] flex-col items-center justify-evenly rounded-l-[10px] bg-[linear-gradient(90deg,#1e3a5f_0%,#2b4d78_55%,#243f63_100%)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.18),inset_1px_0_0_rgba(0,0,0,0.18)]">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f8fafc_0%,#94a3b8_45%,#475569_100%)] shadow-[0_0_0_1px_rgba(15,23,42,0.25),inset_0_1px_1px_rgba(255,255,255,0.55)]"
          />
        ))}
      </span>
      <span className="absolute bottom-2 right-0 top-2 z-[1] w-2.5 rounded-r-lg bg-[repeating-linear-gradient(180deg,#fff_0_2px,#e2e8f0_2px_3px)] shadow-[2px_0_0_#f1f5f9,4px_0_0_#e2e8f0,6px_0_8px_rgba(15,23,42,0.08)]" />
      <span
        className="absolute bottom-0 left-3.5 right-1.5 top-0 z-[2] grid grid-rows-[auto_1fr_auto_auto] gap-2.5 overflow-hidden rounded-r-[14px] border border-l-0 border-slate-400/35 px-3.5 pb-3.5 pl-4 pt-4 shadow-[0_12px_28px_rgba(15,23,42,0.12),inset_0_2px_0_rgba(255,255,255,0.70),-2px_0_6px_rgba(15,23,42,0.08)] transition group-hover:shadow-[0_18px_34px_rgba(15,23,42,0.16),inset_0_2px_0_rgba(255,255,255,0.70),-2px_0_6px_rgba(15,23,42,0.10)]"
        style={{
          background:
            'linear-gradient(90deg,rgba(15,23,42,.06) 0 1px,transparent 1px 100%),linear-gradient(180deg,transparent 0,transparent 28px,rgba(148,163,184,.22) 28px,rgba(148,163,184,.22) 29px),repeating-linear-gradient(180deg,transparent 0 27px,rgba(148,163,184,.18) 27px 28px),linear-gradient(145deg,#f7fafc 0%,#eef4f8 48%,#e8eef4 100%)',
        }}
      >
        <span className="flex min-w-0 items-center justify-between gap-1.5">
          <span className="w-fit rounded border border-blue-600/20 bg-white/70 px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] text-slate-700">
            {typeLabel}
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-[3px] text-[9px] font-bold ${persisted ? 'bg-emerald-100/90 text-emerald-700' : 'bg-amber-100/90 text-amber-700'}`}
          >
            <Database className="size-2.5" />
            {persisted ? '已持久化' : '未确认'}
          </span>
        </span>
        <strong className="line-clamp-4 text-sm font-bold leading-[1.4] tracking-[0.01em] text-slate-900">
          {item.title}
        </strong>
        <span className="grid gap-0.5 text-[11px] leading-[1.35] text-slate-500">
          <span className="truncate">{subtitle}</span>
          <span className="truncate">{dateLabel}</span>
        </span>
        <span className="inline-flex w-fit min-w-[4.25rem] items-center justify-center rounded-lg bg-blue-700 px-[11px] py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
          打开
        </span>
      </span>
    </div>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
