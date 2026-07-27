'use client';

import { backendJson } from '@/lib/utils/backend-api';

export type PhaseTwoRecordedRun<T = unknown> = {
  version: 1;
  scenarioId:
    | 'memory-structured-facts-calendar'
    | 'memory-layered-query'
    | 'memory-ai-review-plan'
    | 'memory-problem-writeback'
    | 'memory-question-writeback';
  caseId: string;
  recordedAt: string;
  result: T;
};

const API_PATH = '/api/platform-tests/memory-phase2-run-records';

export async function syncPhaseTwoRunToLocalFile<T>(args: {
  scenarioId: PhaseTwoRecordedRun['scenarioId'];
  caseId: string;
  result: T;
}): Promise<PhaseTwoRecordedRun<T>> {
  const response = await backendJson<{ record: PhaseTwoRecordedRun<T> }>(API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return response.record;
}

export async function loadPhaseTwoRunsFromLocalFiles<T>(
  scenarioId: PhaseTwoRecordedRun['scenarioId'],
): Promise<PhaseTwoRecordedRun<T>[]> {
  const response = await backendJson<{ records: PhaseTwoRecordedRun<T>[] }>(
    `${API_PATH}?scenarioId=${encodeURIComponent(scenarioId)}`,
    { cache: 'no-store' },
  );
  return response.records || [];
}
