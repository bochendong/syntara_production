'use client';

import type { LocalMemoryMutationResponse } from '@/features/qa/test-center/memory/local-memory-test-store';
import type {
  UnifiedMemoryQueryRequest,
  UnifiedMemoryQueryResponse,
} from '@/features/qa/test-center/memory/unified-memory-query-types';
import { MEMORY_TEST_RESULT_STORAGE_CONTRACT } from '@/features/qa/test-center/memory/result-storage-contract';
import { syncPhaseTwoRunToLocalFile } from '@/features/qa/test-center/memory/local-memory-run-file-sync';

const {
  databaseName: DB_NAME,
  databaseVersion: DB_VERSION,
  storeName: STORE_NAME,
  scenarioId: SCENARIO_ID,
} = MEMORY_TEST_RESULT_STORAGE_CONTRACT.unifiedQueryResults;

export type LocalMemoryUnifiedQueryLatestResult = {
  key: string;
  version: 1;
  scenarioId: typeof SCENARIO_ID;
  caseId: string;
  fixtureUserId: string;
  query: string;
  request?: UnifiedMemoryQueryRequest;
  sourceFingerprint: string;
  updatedAt: number;
  response: UnifiedMemoryQueryResponse;
  calendarMutation: LocalMemoryMutationResponse | null;
};

function resultKey(caseId: string) {
  return `${SCENARIO_ID}:${caseId.trim()}`;
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

function isLatestResult(value: unknown): value is LocalMemoryUnifiedQueryLatestResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<LocalMemoryUnifiedQueryLatestResult>;
  return (
    result.version === 1 &&
    result.scenarioId === SCENARIO_ID &&
    typeof result.caseId === 'string' &&
    typeof result.fixtureUserId === 'string' &&
    typeof result.query === 'string' &&
    typeof result.sourceFingerprint === 'string' &&
    typeof result.updatedAt === 'number' &&
    Boolean(result.response)
  );
}

export async function saveLocalMemoryUnifiedQueryLatestResult(args: {
  caseId: string;
  fixtureUserId: string;
  query: string;
  request: UnifiedMemoryQueryRequest;
  sourceFingerprint: string;
  response: UnifiedMemoryQueryResponse;
  calendarMutation: LocalMemoryMutationResponse | null;
}): Promise<LocalMemoryUnifiedQueryLatestResult> {
  const result: LocalMemoryUnifiedQueryLatestResult = {
    key: resultKey(args.caseId),
    version: 1,
    scenarioId: SCENARIO_ID,
    caseId: args.caseId,
    fixtureUserId: args.fixtureUserId,
    query: args.query,
    request: args.request,
    sourceFingerprint: args.sourceFingerprint,
    updatedAt: Date.now(),
    response: args.response,
    calendarMutation: args.calendarMutation,
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
    scenarioId: SCENARIO_ID,
    caseId: result.caseId,
    result,
  });
  return result;
}

export async function loadLocalMemoryUnifiedQueryLatestResults(): Promise<
  LocalMemoryUnifiedQueryLatestResult[]
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
