/**
 * Stable browser-storage identifiers for the memory test center.
 *
 * These values are compatibility contracts: changing one would make an existing
 * browser look empty even though its previous test results still exist.
 */
export const MEMORY_TEST_RESULT_STORAGE_CONTRACT = {
  localSandbox: {
    storagePrefix: 'syntara:memory-phase2-local:v1',
  },
  activityResults: {
    databaseName: 'syntara-memory-phase2-activity-results',
    databaseVersion: 1,
    storeName: 'latest-by-case',
  },
  notebookAnswerResults: {
    databaseName: 'syntara-memory-phase2-notebook-answer-results',
    databaseVersion: 1,
    storeName: 'latest-by-case',
    scenarioId: 'memory-ai-explanation',
  },
  sourceUploadResults: {
    databaseName: 'syntara-memory-phase2-test-results',
    databaseVersion: 1,
    storeName: 'source-upload-latest',
    scenarioId: 'memory-source-upload-writeback',
  },
  reviewPlanResults: {
    databaseName: 'syntara-memory-phase2-review-plan-results',
    databaseVersion: 1,
    storeName: 'latest-by-case',
    scenarioId: 'memory-ai-review-plan',
  },
  unifiedQueryResults: {
    databaseName: 'syntara-memory-phase2-unified-query-results',
    databaseVersion: 1,
    storeName: 'latest-by-case',
    scenarioId: 'memory-layered-query',
  },
} as const;

export const MEMORY_TEST_RESULT_COMPATIBILITY_NOTE =
  '保留现有 scenario ID、localStorage 前缀、IndexedDB database/store 和 result key；重跑仍只覆盖同一用例的最新结果。';
