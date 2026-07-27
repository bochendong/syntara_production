#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const options = {
  baseUrl: process.env.SYNTARA_BASE_URL?.trim() || 'http://localhost:3000',
  userId: process.env.SYNTARA_PUBLIC_API_USER_ID?.trim() || '',
  courseId: '',
  concurrency: 8,
  timeoutMs: 20_000,
  out: '',
};

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length).trim();
  else if (arg.startsWith('--user-id=')) options.userId = arg.slice('--user-id='.length).trim();
  else if (arg.startsWith('--course-id=')) {
    options.courseId = arg.slice('--course-id='.length).trim();
  } else if (arg.startsWith('--concurrency=')) {
    options.concurrency = Number(arg.slice('--concurrency='.length));
  } else if (arg.startsWith('--timeout-ms=')) {
    options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
  } else if (arg.startsWith('--out=')) {
    options.out = arg.slice('--out='.length).trim();
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

assert.ok(options.userId, 'SYNTARA_PUBLIC_API_USER_ID or --user-id is required.');
assert.ok(options.courseId, '--course-id is required.');
assert.ok(
  Number.isInteger(options.concurrency) && options.concurrency >= 2 && options.concurrency <= 32,
  '--concurrency must be an integer from 2 to 32.',
);
assert.ok(
  Number.isInteger(options.timeoutMs) && options.timeoutMs >= 1_000 && options.timeoutMs <= 120_000,
  '--timeout-ms must be an integer from 1000 to 120000.',
);

const url = `${options.baseUrl.replace(/\/$/, '')}/api/courses/${encodeURIComponent(options.courseId)}/content-state`;
const startedAt = Date.now();
const responses = await Promise.all(
  Array.from({ length: options.concurrency }, async (_, index) => {
    const requestStartedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-user-id': options.userId,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body = await response.json().catch(() => null);
    return {
      index,
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
      durationMs: Date.now() - requestStartedAt,
      body,
    };
  }),
);

const statuses = Array.from(new Set(responses.map((response) => response.status)));
assert.ok(
  statuses.every((status) => status === 200 || status === 504),
  `Expected snapshots or retryable timeouts, received HTTP ${statuses.join(', ')}.`,
);
const snapshotResponses = responses.filter((response) => response.status === 200);
const timeoutResponses = responses.filter((response) => response.status === 504);
const snapshots = snapshotResponses.map((response) => response.body);
if (snapshotResponses.length > 0) {
  assert.ok(
    snapshots.every(
      (snapshot) =>
        snapshot?.storage === 'database' &&
        snapshot.courseId === options.courseId &&
        typeof snapshot.revision === 'string' &&
        typeof snapshot.checkedAt === 'string',
    ),
    'Every response must contain a valid course content snapshot.',
  );
  assert.ok(
    snapshots.every((snapshot) => {
      const sourceHealthCounts = [
        snapshot?.sources?.processingCount,
        snapshot?.sources?.ingestErrorCount,
        snapshot?.sources?.indexPendingCount,
        snapshot?.sources?.indexErrorCount,
      ];
      return (
        sourceHealthCounts.every((count) => Number.isInteger(count) && count >= 0) &&
        (snapshot?.sources?.oldestProcessingAt === null ||
          typeof snapshot?.sources?.oldestProcessingAt === 'string')
      );
    }),
    'Every source snapshot must expose cheap aggregate synchronization health.',
  );
}
if (timeoutResponses.length > 0) {
  assert.ok(
    timeoutResponses.every(
      (response) =>
        response.body?.code === 'COURSE_CONTENT_STATE_TIMEOUT' &&
        response.body?.retryable === true &&
        response.retryAfter === '5',
    ),
    'A timed-out shared flight must return the public retryable 504 contract.',
  );
}
const uniqueCheckedAt =
  snapshotResponses.length > 0
    ? Array.from(new Set(snapshots.map((snapshot) => snapshot.checkedAt)))
    : [];
if (snapshotResponses.length === responses.length) {
  assert.equal(
    uniqueCheckedAt.length,
    1,
    'Concurrent requests did not join one server-side in-flight snapshot.',
  );
}

const report = {
  ok: true,
  mode:
    snapshotResponses.length === responses.length
      ? 'snapshot'
      : timeoutResponses.length === responses.length
        ? 'retryable_timeout'
        : 'recovery_transition',
  synchronized: snapshotResponses.length === responses.length,
  statuses,
  url,
  concurrency: options.concurrency,
  wallTimeMs: Date.now() - startedAt,
  uniqueCheckedAt,
  uniqueRevisions:
    snapshotResponses.length > 0
      ? Array.from(new Set(snapshots.map((snapshot) => snapshot.revision)))
      : [],
  counts:
    snapshotResponses.length > 0
      ? {
          notebooks: snapshots[0].notebooks.count,
          problems: snapshots[0].problems.count,
          sources: snapshots[0].sources.count,
        }
      : null,
  sourceHealth:
    snapshotResponses.length > 0
      ? {
          processingCount: snapshots[0].sources.processingCount,
          ingestErrorCount: snapshots[0].sources.ingestErrorCount,
          indexPendingCount: snapshots[0].sources.indexPendingCount,
          indexErrorCount: snapshots[0].sources.indexErrorCount,
          oldestProcessingAt: snapshots[0].sources.oldestProcessingAt,
        }
      : null,
  timeout:
    timeoutResponses.length > 0
      ? {
          count: timeoutResponses.length,
          code: timeoutResponses[0].body?.code,
          retryable: timeoutResponses[0].body?.retryable,
          retryAfter: timeoutResponses[0].retryAfter,
        }
      : null,
  durationsMs: responses.map((response) => response.durationMs),
};

if (options.out) {
  const outputPath = path.resolve(options.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
