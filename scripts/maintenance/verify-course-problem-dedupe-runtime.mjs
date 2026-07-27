#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.OPENMAIC_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const userId = process.env.SYNTARA_PUBLIC_API_USER_ID?.trim();
const userEmail = process.env.SYNTARA_PUBLIC_API_USER_EMAIL?.trim();
const requestTimeoutMs = Number.parseInt(process.env.OPENMAIC_API_TIMEOUT_MS || '180000', 10);

if (!userId) {
  throw new Error('SYNTARA_PUBLIC_API_USER_ID is required.');
}

async function api(pathname, init = {}, options = {}) {
  const method = init.method || 'GET';
  const maxAttempts = options.maxAttempts || 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    process.stderr.write(
      `[dedupe-runtime] ${method} ${pathname} (attempt ${attempt}/${maxAttempts})\n`,
    );
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
          'x-user-id': userId,
          ...(userEmail ? { 'x-user-email': userEmail } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          `${method} ${pathname} failed (${response.status}): ${JSON.stringify(body)}`,
        );
        error.status = response.status;
        throw error;
      }
      process.stderr.write(
        `[dedupe-runtime] ${method} ${pathname} completed in ${Date.now() - startedAt}ms\n`,
      );
      return body;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const transient =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        [500, 502, 503, 504].includes(status);
      if (!transient || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw lastError;
}

function shortAnswer(title, stem) {
  return {
    title,
    type: 'short_answer',
    status: 'published',
    source: 'manual',
    difficulty: 'medium',
    stem,
    referenceAnswer: 'Runtime verification answer.',
    tags: ['dedupe-runtime-verification'],
  };
}

const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const courseName = `Dedupe Runtime QA ${suffix}`;
let courseId = null;
let cleanupError = null;

try {
  const createdCourse = await api('/api/courses', {
    method: 'POST',
    body: JSON.stringify({
      name: courseName,
      description: 'Temporary API-only atomic dedupe verification course.',
      language: 'en-US',
      purpose: 'university',
      tags: ['qa', 'dedupe'],
    }),
  });
  courseId = createdCourse.course.id;

  const createdNotebook = await api(
    '/api/notebooks',
    {
      method: 'POST',
      body: JSON.stringify({
        id: `qa_dedupe_${suffix}`,
        courseId,
        name: 'Atomic dedupe verification',
        notebookKind: 'markdown',
        language: 'en-US',
        tags: ['qa'],
      }),
    },
    { maxAttempts: 2 },
  );
  const notebookId = createdNotebook.notebook.id;

  const firstProblem = shortAnswer(
    'Induction runtime check',
    'Prove by mathematical induction that the sum of the first n odd positive integers equals n squared for every positive integer n.',
  );
  const firstInsert = await api(
    `/api/notebooks/${encodeURIComponent(notebookId)}/problems`,
    {
      method: 'POST',
      body: JSON.stringify({ problem: firstProblem }),
    },
    { maxAttempts: 2 },
  );
  assert.equal(firstInsert.insertedCount, 1);
  assert.equal(firstInsert.reusedCount, 0);

  const repeatedInsert = await api(
    `/api/notebooks/${encodeURIComponent(notebookId)}/problems`,
    {
      method: 'POST',
      body: JSON.stringify({
        problem: {
          ...firstProblem,
          title: 'Same induction question with a regenerated title',
        },
      }),
    },
    { maxAttempts: 2 },
  );
  assert.equal(repeatedInsert.insertedCount, 0);
  assert.equal(repeatedInsert.reusedCount, 1);
  assert.equal(repeatedInsert.skippedCount, 1);
  assert.deepEqual(repeatedInsert.reusedProblemIds, firstInsert.insertedProblemIds);

  const concurrentProblem = shortAnswer(
    'Concurrent runtime check',
    'For every integer n greater than or equal to zero, prove that two to the power n is at least n plus one using mathematical induction.',
  );
  const concurrentResponses = await Promise.all(
    [0, 1].map((index) =>
      api(
        `/api/notebooks/${encodeURIComponent(notebookId)}/problems`,
        {
          method: 'POST',
          body: JSON.stringify({
            problem: {
              ...concurrentProblem,
              title: `${concurrentProblem.title} ${index + 1}`,
            },
          }),
        },
        { maxAttempts: 2 },
      ),
    ),
  );
  assert.equal(
    concurrentResponses.reduce((total, response) => total + response.insertedCount, 0),
    1,
  );
  assert.equal(
    concurrentResponses.reduce((total, response) => total + response.reusedCount, 0),
    1,
  );

  const courseProblems = await api(
    `/api/courses/${encodeURIComponent(courseId)}/problems`,
    {},
    { maxAttempts: 3 },
  );
  assert.equal(courseProblems.problems.length, 2);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: 'api_runtime',
        courseId,
        notebookId,
        finalProblemCount: courseProblems.problems.length,
        checks: [
          'first insert creates one problem',
          'same content with a new title reuses the existing problem',
          'two concurrent identical writes insert exactly once',
          'API reports inserted/reused/skipped IDs accurately',
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (courseId) {
    try {
      await api(
        `/api/courses/${encodeURIComponent(courseId)}`,
        { method: 'DELETE' },
        { maxAttempts: 3 },
      );
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
  if (cleanupError) {
    throw new Error(`Runtime verification cleanup failed: ${cleanupError}`);
  }
}
