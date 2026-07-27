'use client';

import type { LocalMemoryMutationResponse } from '@/features/qa/test-center/memory/local-memory-test-store';
import {
  loadPhaseTwoRunsFromLocalFiles,
  syncPhaseTwoRunToLocalFile,
} from '@/features/qa/test-center/memory/local-memory-run-file-sync';
import { MEMORY_TEST_RESULT_STORAGE_CONTRACT } from '@/features/qa/test-center/memory/result-storage-contract';

const {
  databaseName: DB_NAME,
  databaseVersion: DB_VERSION,
  storeName: STORE_NAME,
} = MEMORY_TEST_RESULT_STORAGE_CONTRACT.activityResults;

export type LocalMemoryActivityScenarioId =
  | 'memory-problem-writeback'
  | 'memory-question-writeback';

export type LocalMemoryActivityLatestResult = {
  key: string;
  version: 1;
  scenarioId: LocalMemoryActivityScenarioId;
  caseId: string;
  fixtureUserId: string;
  updatedAt: number;
  mutation: LocalMemoryMutationResponse | null;
  cliRun?: unknown;
};

function resultKey(scenarioId: LocalMemoryActivityScenarioId, caseId: string) {
  return `${scenarioId}:${caseId.trim()}`;
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
      store.createIndex('scenarioId', 'scenarioId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    };
  });
}

function isLatestResult(value: unknown): value is LocalMemoryActivityLatestResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<LocalMemoryActivityLatestResult>;
  return (
    result.version === 1 &&
    (result.scenarioId === 'memory-problem-writeback' ||
      result.scenarioId === 'memory-question-writeback') &&
    typeof result.caseId === 'string' &&
    typeof result.fixtureUserId === 'string' &&
    typeof result.updatedAt === 'number' &&
    Boolean(result.mutation || result.cliRun)
  );
}

export async function saveLocalMemoryActivityLatestResult(args: {
  scenarioId: LocalMemoryActivityScenarioId;
  caseId: string;
  fixtureUserId: string;
  mutation: LocalMemoryMutationResponse;
}): Promise<LocalMemoryActivityLatestResult> {
  const result: LocalMemoryActivityLatestResult = {
    key: resultKey(args.scenarioId, args.caseId),
    version: 1,
    scenarioId: args.scenarioId,
    caseId: args.caseId,
    fixtureUserId: args.fixtureUserId,
    updatedAt: Date.now(),
    mutation: args.mutation,
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
  await syncPhaseTwoRunToLocalFile({
    scenarioId: result.scenarioId,
    caseId: result.caseId,
    result,
  });
  return result;
}

async function loadIndexedDbLatestResults(
  scenarioId: LocalMemoryActivityScenarioId,
): Promise<LocalMemoryActivityLatestResult[]> {
  const db = await openDb();
  try {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).index('scenarioId').getAll(scenarioId);
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return values.filter(isLatestResult).sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    db.close();
  }
}

export async function loadLocalMemoryActivityLatestResults(
  scenarioId: LocalMemoryActivityScenarioId,
): Promise<LocalMemoryActivityLatestResult[]> {
  const [indexedDbResult, fileResult] = await Promise.allSettled([
    loadIndexedDbLatestResults(scenarioId),
    loadPhaseTwoRunsFromLocalFiles<LocalMemoryActivityLatestResult>(scenarioId),
  ]);

  if (indexedDbResult.status === 'rejected' && fileResult.status === 'rejected') {
    throw indexedDbResult.reason;
  }

  const merged = new Map<string, LocalMemoryActivityLatestResult>();
  if (indexedDbResult.status === 'fulfilled') {
    for (const result of indexedDbResult.value) {
      merged.set(result.caseId, result);
    }
  }
  if (fileResult.status === 'fulfilled') {
    for (const record of fileResult.value) {
      const candidate = record.result;
      if (!isLatestResult(candidate) || candidate.scenarioId !== scenarioId) continue;
      const current = merged.get(candidate.caseId);
      if (!current || candidate.updatedAt > current.updatedAt) {
        merged.set(candidate.caseId, candidate);
      }
    }
  }

  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
