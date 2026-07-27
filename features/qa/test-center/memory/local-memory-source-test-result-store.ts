'use client';

import type { LocalMemoryMutationResponse } from '@/features/qa/test-center/memory/local-memory-test-store';
import { MEMORY_TEST_RESULT_STORAGE_CONTRACT } from '@/features/qa/test-center/memory/result-storage-contract';

const {
  databaseName: DB_NAME,
  databaseVersion: DB_VERSION,
  storeName: STORE_NAME,
  scenarioId: SOURCE_UPLOAD_SCENARIO_ID,
} = MEMORY_TEST_RESULT_STORAGE_CONTRACT.sourceUploadResults;

export type LocalSourceTestStage = 'memory' | 'notebook' | 'cover';
export type LocalSourceTestRunStatus = 'running' | 'completed' | 'partial';

export type LocalSourceUploadLatestResult = {
  key: string;
  version: 1;
  scenarioId: typeof SOURCE_UPLOAD_SCENARIO_ID;
  testCaseId: string;
  fixtureUserId: string;
  runId: string;
  status: LocalSourceTestRunStatus;
  phase: string;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  runError: string | null;
  memoryMutation: LocalMemoryMutationResponse | null;
  notebookMutation: LocalMemoryMutationResponse | null;
  coverMutation: LocalMemoryMutationResponse | null;
  stageErrors: Partial<Record<LocalSourceTestStage, string>>;
};

function resultKey(testCaseId: string) {
  return `${SOURCE_UPLOAD_SCENARIO_ID}:${testCaseId.trim()}`;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持保存本地测试结果。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    };
  });
}

function isLatestResult(value: unknown): value is LocalSourceUploadLatestResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<LocalSourceUploadLatestResult>;
  return (
    result.version === 1 &&
    result.scenarioId === SOURCE_UPLOAD_SCENARIO_ID &&
    typeof result.testCaseId === 'string' &&
    typeof result.runId === 'string' &&
    typeof result.updatedAt === 'number'
  );
}

export function createLocalSourceUploadLatestResult(args: {
  testCaseId: string;
  fixtureUserId: string;
  runId: string;
  startedAt?: number;
}): LocalSourceUploadLatestResult {
  const startedAt = args.startedAt ?? Date.now();
  return {
    key: resultKey(args.testCaseId),
    version: 1,
    scenarioId: SOURCE_UPLOAD_SCENARIO_ID,
    testCaseId: args.testCaseId,
    fixtureUserId: args.fixtureUserId,
    runId: args.runId,
    status: 'running',
    phase: '正在准备最新一次测试…',
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    runError: null,
    memoryMutation: null,
    notebookMutation: null,
    coverMutation: null,
    stageErrors: {},
  };
}

export async function saveLocalSourceUploadLatestResult(
  result: LocalSourceUploadLatestResult,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore(STORE_NAME).put({
        ...result,
        key: resultKey(result.testCaseId),
      });
    });
  } finally {
    db.close();
  }
}

export async function loadLocalSourceUploadLatestResults(): Promise<
  LocalSourceUploadLatestResult[]
> {
  const db = await openDb();
  try {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return values.filter(isLatestResult).sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    db.close();
  }
}
