'use client';

import type { NotebookMemoryAnswerResponse } from '@/features/qa/test-center/memory/csc148-notebook-memory-answer-cases';
import { MEMORY_TEST_RESULT_STORAGE_CONTRACT } from '@/features/qa/test-center/memory/result-storage-contract';

const {
  databaseName: DB_NAME,
  databaseVersion: DB_VERSION,
  storeName: STORE_NAME,
  scenarioId: NOTEBOOK_ANSWER_SCENARIO_ID,
} = MEMORY_TEST_RESULT_STORAGE_CONTRACT.notebookAnswerResults;

export type LocalNotebookAnswerLatestResult = {
  key: string;
  version: 1;
  caseId: string;
  sourceFingerprint: string;
  updatedAt: number;
  response: NotebookMemoryAnswerResponse;
};

function resultKey(caseId: string) {
  return `${NOTEBOOK_ANSWER_SCENARIO_ID}:${caseId.trim()}`;
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

function isLatestResult(value: unknown): value is LocalNotebookAnswerLatestResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<LocalNotebookAnswerLatestResult>;
  return (
    result.version === 1 &&
    typeof result.caseId === 'string' &&
    typeof result.sourceFingerprint === 'string' &&
    typeof result.updatedAt === 'number' &&
    Boolean(result.response)
  );
}

export async function saveLocalNotebookAnswerLatestResult(args: {
  caseId: string;
  sourceFingerprint: string;
  response: NotebookMemoryAnswerResponse;
}): Promise<LocalNotebookAnswerLatestResult> {
  const result: LocalNotebookAnswerLatestResult = {
    key: resultKey(args.caseId),
    version: 1,
    caseId: args.caseId,
    sourceFingerprint: args.sourceFingerprint,
    updatedAt: Date.now(),
    response: args.response,
  };
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore(STORE_NAME).put(result);
    });
  } finally {
    db.close();
  }
  return result;
}

export async function loadLocalNotebookAnswerLatestResults(): Promise<
  LocalNotebookAnswerLatestResult[]
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
