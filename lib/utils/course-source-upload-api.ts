'use client';

import { backendJson, type BackendLoadOptions } from '@/lib/utils/backend-api';

export type CourseSourceUploadRecord = {
  courseId: string;
  sourceHash: string;
  title: string;
  kind: string;
  fileMime: string | null;
  usageProfile: string | null;
  topic: string | null;
  coverImagePath: string | null;
  coverStatus: string | null;
  allQuestionUpload: boolean | null;
  ingestStatus: 'processing' | 'ready' | 'error';
  indexStatus: 'pending' | 'indexing' | 'ready' | 'error';
  errorReason: string | null;
  contentVersion: number;
  notebookIds: string[];
  sectionIds: string[];
  problemIds: string[];
  importBatchIds: string[];
  memoryIds: string[];
  templateMemoryIds: string[];
  knowledgeGraphFactIds: string[];
  ragEntryIds: string[];
  openaiFileIds: string[];
  textSections: Array<{
    id: string;
    notebookId: string;
    title: string;
    order: number;
    markdown: string;
  }>;
  createdAt: string;
  updatedAt: string;
  stats: {
    notebookCount: number;
    sectionCount: number;
    problemCount: number;
    importBatchCount: number;
    memoryCount: number;
    templateMemoryCount: number;
    knowledgeGraphFactCount: number;
    ragEntryCount: number;
    openaiFileCount: number;
  };
};

export type DeleteCourseSourceUploadResult = {
  source: CourseSourceUploadRecord;
  cleanupErrors: string[];
  preservedProblems: number;
  detachedProblemProvenance: number;
  deleted: {
    notebooks: number;
    sections: number;
    problems: number;
    importBatches: number;
    memories: number;
    templateMemories: number;
    memoryFacts: number;
    memoryFactEvents: number;
    ragEntries: number;
    openaiFiles: number;
  };
};

export type CourseSourceUploadTextDetail = Pick<
  CourseSourceUploadRecord,
  'courseId' | 'sourceHash' | 'textSections'
>;

export async function listCourseSourceUploads(
  courseId: string,
  options?: { includeText?: boolean; includeArtifacts?: boolean } & BackendLoadOptions,
): Promise<CourseSourceUploadRecord[]> {
  const params = new URLSearchParams();
  if (options?.includeText === false) params.set('includeText', '0');
  if (options?.includeArtifacts === false) params.set('includeArtifacts', '0');
  const query = params.toString();
  const data = await backendJson<{ uploads: CourseSourceUploadRecord[] }>(
    `/api/courses/${encodeURIComponent(courseId)}/source-uploads${query ? `?${query}` : ''}`,
    { signal: options?.signal, timeoutMs: options?.timeoutMs },
  );
  return data.uploads;
}

export async function getCourseSourceUploadText(args: {
  courseId: string;
  sourceHash: string;
}): Promise<CourseSourceUploadTextDetail> {
  const data = await backendJson<{ source: CourseSourceUploadTextDetail }>(
    `/api/courses/${encodeURIComponent(args.courseId)}/source-uploads/${encodeURIComponent(
      args.sourceHash,
    )}`,
    { timeoutMs: 8_000 },
  );
  return data.source;
}

export async function deleteCourseSourceUpload(args: {
  courseId: string;
  sourceHash: string;
}): Promise<DeleteCourseSourceUploadResult> {
  const params = new URLSearchParams();
  params.set('preserveProblems', '1');
  const query = params.toString();
  const data = await backendJson<{ result: DeleteCourseSourceUploadResult }>(
    `/api/courses/${encodeURIComponent(args.courseId)}/source-uploads/${encodeURIComponent(
      args.sourceHash,
    )}${query ? `?${query}` : ''}`,
    {
      method: 'DELETE',
    },
  );
  return data.result;
}

export async function retryCourseSourceIndex(args: {
  courseId: string;
  sourceHash: string;
  allowExternalEmbeddings?: boolean;
}): Promise<void> {
  const params = new URLSearchParams();
  if (!args.allowExternalEmbeddings) params.set('localOnly', '1');
  const query = params.toString();
  await backendJson<{ ok: true; indexStatus: 'indexing' }>(
    `/api/courses/${encodeURIComponent(args.courseId)}/source-uploads/${encodeURIComponent(
      args.sourceHash,
    )}/reindex${query ? `?${query}` : ''}`,
    {
      method: 'POST',
    },
  );
}
