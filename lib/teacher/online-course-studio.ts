'use client';

import { backendFetch, backendJson } from '@/lib/utils/backend-api';

export type AcademicTerm = 'winter' | 'summer' | 'fall';
export type CourseContentType = 'notebook' | 'problem_bank' | 'source';
export type CourseSourceCategory =
  | 'school_teacher_notes'
  | 'crash_course_teacher_notes'
  | 'problem_bank';

export type TeacherStudioCourse = {
  id: string;
  code: string;
  name: string;
  description?: string;
  academicYear: number;
  term: AcademicTerm;
  createdAt: number;
  updatedAt: number;
};

export type TeacherStudioContentItem = {
  id: string;
  type: CourseContentType;
  title: string;
  description?: string;
  sourceCategory?: CourseSourceCategory;
  sourceFileId?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  ingestStatus?: string;
  notebookSections?: Array<{
    id: string;
    title: string;
    summary?: string;
    markdown: string;
    sourcePages: number[];
  }>;
  generation?: {
    providerId?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalTokens: number;
    qualityScore?: number;
    generatedAt?: number;
  };
  mindMap?: { imageUrl?: string; generatedAt?: number; [key: string]: unknown };
  createdAt: number;
  updatedAt: number;
  reference: {
    id: string;
    courseId: string;
    assetId: string;
    status: 'active' | 'hidden' | 'superseded';
    learningOrder?: number;
    inheritedFromCourseId?: string;
    hiddenAt?: number;
    createdAt: number;
    updatedAt: number;
  };
};

export type TeacherStudioTask = {
  id: string;
  notebookId?: string;
  kind: 'knowledge_notebook' | 'mind_map';
  sourceId?: string;
  sourceTitle?: string;
  sourceFileId: string;
  sourceAssetId: string;
  requestedBy: string;
  courseId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: number;
  attemptCount: number;
  persistenceStatus: 'pending' | 'complete' | 'failed';
  persistenceStorage?: 'postgresql';
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type TeacherStudioSourcePreview = {
  fileName: string;
  mimeType: string;
  size: number;
  kind: 'pdf' | 'markdown' | 'text' | 'office';
  blob: Blob;
  text?: string;
  pageCount?: number;
};

type StudioPayload = {
  storage: 'postgresql';
  course: {
    id: string;
    name: string;
    description?: string | null;
    courseCode?: string | null;
    academicYear?: number | null;
    academicTerm?: AcademicTerm | null;
    createdAt: number;
    updatedAt: number;
  };
  sources: Array<{
    id: string;
    title: string;
    mimeType: string;
    size: number;
    sourceCategory: CourseSourceCategory;
    ingestStatus: string;
    removedAt: number | null;
    fileUrl: string;
    createdAt: number;
    updatedAt: number;
  }>;
  notebooks: Array<{
    id: string;
    title: string;
    summary: string;
    removedAt: number | null;
    learningOrder: number | null;
    sourceId: string | null;
    generation?: TeacherStudioContentItem['generation'];
    mindMap?: TeacherStudioContentItem['mindMap'];
    sections: NonNullable<TeacherStudioContentItem['notebookSections']>;
    createdAt: number;
    updatedAt: number;
  }>;
  tasks: Array<
    Omit<
      TeacherStudioTask,
      'courseId' | 'requestedBy' | 'sourceFileId' | 'sourceAssetId' | 'completedAt'
    >
  >;
};

function currentTerm(): AcademicTerm {
  const month = new Date().getMonth() + 1;
  return month <= 4 ? 'winter' : month <= 8 ? 'summer' : 'fall';
}

function sourceItem(courseId: string, source: StudioPayload['sources'][number]) {
  const status = source.removedAt ? 'hidden' : 'active';
  return {
    id: source.id,
    type: 'source' as const,
    title: source.title,
    description: `${source.mimeType} · ${source.size} bytes`,
    sourceCategory: source.sourceCategory,
    sourceFileId: source.id,
    fileUrl: source.fileUrl,
    mimeType: source.mimeType,
    size: source.size,
    ingestStatus: source.ingestStatus,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    reference: {
      id: `online-source:${source.id}`,
      courseId,
      assetId: source.id,
      status,
      hiddenAt: source.removedAt || undefined,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    },
  } satisfies TeacherStudioContentItem;
}

function notebookItem(courseId: string, notebook: StudioPayload['notebooks'][number]) {
  const status = notebook.removedAt ? 'hidden' : 'active';
  return {
    id: notebook.id,
    type: 'notebook' as const,
    title: notebook.title,
    description: notebook.summary,
    sourceFileId: notebook.sourceId || undefined,
    notebookSections: notebook.sections,
    generation: notebook.generation || undefined,
    mindMap: notebook.mindMap || undefined,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    reference: {
      id: `online-notebook:${notebook.id}`,
      courseId,
      assetId: notebook.id,
      status,
      hiddenAt: notebook.removedAt || undefined,
      learningOrder: notebook.learningOrder ?? undefined,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt,
    },
  } satisfies TeacherStudioContentItem;
}

function taskItem(courseId: string, teacherId: string, task: StudioPayload['tasks'][number]) {
  const sourceId = task.sourceId || task.id;
  return {
    ...task,
    courseId,
    requestedBy: teacherId,
    sourceFileId: sourceId,
    sourceAssetId: sourceId,
    completedAt: task.status === 'completed' ? task.updatedAt : undefined,
  } satisfies TeacherStudioTask;
}

export async function loadOnlineTeacherStudio(args: { courseId: string; teacherId: string }) {
  const payload = await backendJson<StudioPayload>(
    `/api/teacher/courses/${encodeURIComponent(args.courseId)}/studio`,
  );
  const allContent: TeacherStudioContentItem[] = [
    ...payload.sources.map((source) => sourceItem(args.courseId, source)),
    ...payload.notebooks.map((notebook) => notebookItem(args.courseId, notebook)),
  ];
  const tasks = payload.tasks.map((task) => taskItem(args.courseId, args.teacherId, task));
  return {
    course: {
      id: payload.course.id,
      code: payload.course.courseCode?.trim() || payload.course.name,
      name: payload.course.name,
      description: payload.course.description || undefined,
      academicYear: payload.course.academicYear ?? new Date().getFullYear(),
      term: payload.course.academicTerm ?? currentTerm(),
      createdAt: payload.course.createdAt,
      updatedAt: payload.course.updatedAt,
    } satisfies TeacherStudioCourse,
    content: allContent.filter((item) => item.reference.status === 'active'),
    removedContent: allContent.filter((item) => item.reference.status === 'hidden'),
    tasks,
  };
}

export function academicTermLabel(term: AcademicTerm) {
  return term === 'winter' ? 'Winter' : term === 'summer' ? 'Summer' : 'Fall';
}

export function resolveCourseSourceCategory(
  source: Pick<TeacherStudioContentItem, 'sourceCategory' | 'title' | 'description'>,
): CourseSourceCategory {
  if (source.sourceCategory) return source.sourceCategory;
  const text = `${source.title} ${source.description || ''}`.toLowerCase();
  if (/速成|冲刺|crash\s*course|cram/.test(text)) return 'crash_course_teacher_notes';
  if (/题库|试题|习题|question|problem|exam/.test(text)) return 'problem_bank';
  return 'school_teacher_notes';
}

export function orderCourseContentNotebooks(items: TeacherStudioContentItem[]) {
  return items.slice().sort((left, right) => {
    const leftOrder = left.reference.learningOrder;
    const rightOrder = right.reference.learningOrder;
    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    return left.createdAt - right.createdAt;
  });
}

export async function uploadOnlineTeacherSources(args: {
  courseId: string;
  sourceCategory: CourseSourceCategory;
  files: File[];
}) {
  for (const file of args.files) {
    const formData = new FormData();
    formData.set('file', file);
    formData.set('sourceCategory', args.sourceCategory);
    const response = await backendFetch(
      `/api/teacher/courses/${encodeURIComponent(args.courseId)}/sources`,
      { method: 'POST', body: formData, timeoutMs: 300_000 },
    );
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || `上传失败（HTTP ${response.status}）`);
  }
}

export async function getOnlineTeacherSourcePreview(item: TeacherStudioContentItem) {
  if (item.type !== 'source' || !item.fileUrl) throw new Error('源文件不存在');
  const response = await backendFetch(item.fileUrl, { timeoutMs: 120_000 });
  if (!response.ok) throw new Error(`源文件读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const lower = item.title.toLowerCase();
  const kind: TeacherStudioSourcePreview['kind'] =
    item.mimeType === 'application/pdf' || lower.endsWith('.pdf')
      ? 'pdf'
      : lower.endsWith('.md') || lower.endsWith('.markdown')
        ? 'markdown'
        : lower.endsWith('.docx') || lower.endsWith('.pptx')
          ? 'office'
          : 'text';
  return {
    fileName: item.title,
    mimeType: item.mimeType || blob.type || 'application/octet-stream',
    size: item.size || blob.size,
    kind,
    blob,
    text: kind === 'markdown' || kind === 'text' ? await blob.text() : undefined,
  } satisfies TeacherStudioSourcePreview;
}

function contentEndpoint(courseId: string, item: TeacherStudioContentItem) {
  const collection = item.type === 'notebook' ? 'notebooks' : 'sources';
  return `/api/teacher/courses/${encodeURIComponent(courseId)}/${collection}/${encodeURIComponent(item.id)}`;
}

export async function setOnlineContentRemoved(args: {
  courseId: string;
  item: TeacherStudioContentItem;
  removed: boolean;
}) {
  const response = await backendFetch(contentEndpoint(args.courseId, args.item), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: args.removed ? 'remove' : 'restore' }),
  });
  if (!response.ok) throw new Error(args.removed ? '移除失败' : '恢复失败');
}

export async function permanentlyDeleteOnlineContent(args: {
  courseId: string;
  item: TeacherStudioContentItem;
}) {
  const response = await backendFetch(contentEndpoint(args.courseId, args.item), {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) throw new Error('彻底删除失败');
}

export async function updateOnlineNotebookOrder(courseId: string, notebookIds: string[]) {
  const response = await backendFetch(
    `/api/teacher/courses/${encodeURIComponent(courseId)}/notebooks/order`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notebookIds }),
    },
  );
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || '保存课程顺序失败');
}

export async function processOnlineSource(courseId: string, sourceId: string) {
  const response = await backendFetch(
    `/api/teacher/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(sourceId)}/process`,
    { method: 'POST', timeoutMs: 300_000 },
  );
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || '源文件处理失败');
}

export async function generateOnlineMindMap(args: {
  courseId: string;
  sourceId: string;
  notebookId: string;
}) {
  const response = await backendFetch(
    `/api/teacher/courses/${encodeURIComponent(args.courseId)}/sources/${encodeURIComponent(args.sourceId)}/mind-map`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notebookId: args.notebookId }),
      timeoutMs: 300_000,
    },
  );
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || '思维导图生成失败');
}
