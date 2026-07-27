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
  out: '',
};

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length).trim();
  else if (arg.startsWith('--user-id=')) options.userId = arg.slice('--user-id='.length).trim();
  else if (arg.startsWith('--course-id=')) {
    options.courseId = arg.slice('--course-id='.length).trim();
  } else if (arg.startsWith('--concurrency=')) {
    options.concurrency = Number(arg.slice('--concurrency='.length));
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

const url = `${options.baseUrl.replace(/\/$/, '')}/api/courses/${encodeURIComponent(options.courseId)}`;
const startedAt = Date.now();
const responses = await Promise.all(
  Array.from({ length: options.concurrency }, async (_, index) => {
    const requestStartedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-user-id': options.userId,
      },
    });
    const body = await response.json().catch(() => null);
    return {
      index,
      status: response.status,
      durationMs: Date.now() - requestStartedAt,
      body,
    };
  }),
);

assert.deepEqual(
  Array.from(new Set(responses.map((response) => response.status))),
  [200],
  'Every concurrent course-detail request must succeed.',
);
assert.ok(
  responses.every(
    (response) =>
      response.body?.course?.id === options.courseId &&
      (response.body.course.accessRole === 'owner' ||
        response.body.course.accessRole === 'enrolled') &&
      typeof response.body.course.name === 'string',
  ),
  'Every response must contain the same accessible course.',
);

const report = {
  ok: true,
  url,
  concurrency: options.concurrency,
  wallTimeMs: Date.now() - startedAt,
  courseId: options.courseId,
  courseNames: Array.from(new Set(responses.map((response) => response.body.course.name))),
  accessRoles: Array.from(new Set(responses.map((response) => response.body.course.accessRole))),
  durationsMs: responses.map((response) => response.durationMs),
};

if (options.out) {
  const outputPath = path.resolve(options.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
