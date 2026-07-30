#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function option(name) {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

const databasePath =
  option('database') ||
  path.join(homedir(), 'Library/Application Support/com.syntara.local/syntara-local.db');
const iterations = Math.max(50, Number(option('iterations') || 500));
const database = new DatabaseSync(databasePath, { readOnly: true });
database.exec('PRAGMA query_only = ON');

const course = database.prepare('SELECT id FROM courses ORDER BY updated_at DESC LIMIT 1').get();
if (!course?.id) throw new Error('本地数据库中没有可用于基准测试的课程。');

const conversation = database
  .prepare('SELECT id FROM conversations WHERE course_id = ? ORDER BY updated_at DESC LIMIT 1')
  .get(course.id);
const notebook = database
  .prepare('SELECT id FROM notebooks WHERE course_id = ? ORDER BY updated_at DESC LIMIT 1')
  .get(course.id);
const hasLocalSearch = Boolean(
  database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_course_search' LIMIT 1",
    )
    .get(),
);
const searchSeed = hasLocalSearch
  ? database
      .prepare(
        `SELECT substr(replace(title, ' ', ''), 1, 3) AS term
           FROM local_course_search
          WHERE course_id = ? AND length(replace(title, ' ', '')) >= 3
          LIMIT 1`,
      )
      .get(course.id)
  : null;

const workloads = [
  {
    name: 'course-list',
    run: () => database.prepare('SELECT * FROM courses ORDER BY updated_at DESC').all(),
  },
  {
    name: 'course-workspace',
    run: () => {
      database.prepare('SELECT * FROM notebooks WHERE course_id = ?').all(course.id);
      database.prepare('SELECT * FROM problems WHERE course_id = ?').all(course.id);
      database
        .prepare('SELECT * FROM conversations WHERE course_id = ? ORDER BY updated_at DESC')
        .all(course.id);
    },
  },
  {
    name: 'conversation-messages',
    run: () =>
      conversation?.id
        ? database
            .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
            .all(conversation.id)
        : [],
  },
  {
    name: 'notebook-document',
    run: () => {
      if (!notebook?.id) return;
      database
        .prepare('SELECT * FROM notebook_pages WHERE notebook_id = ? ORDER BY sort_order')
        .all(notebook.id);
      database
        .prepare('SELECT * FROM markdown_sections WHERE notebook_id = ? ORDER BY sort_order')
        .all(notebook.id);
      database
        .prepare(
          `SELECT assets.*
             FROM assets
             JOIN notebook_assets ON notebook_assets.asset_id = assets.id
            WHERE notebook_assets.notebook_id = ?`,
        )
        .all(notebook.id);
    },
  },
];

if (searchSeed?.term) {
  workloads.push({
    name: 'local-course-search',
    run: () =>
      database
        .prepare(
          `SELECT source_id, resource_id, source_type, title,
                  snippet(local_course_search, 5, '', '', ' … ', 64) AS excerpt
             FROM local_course_search
            WHERE course_id = ? AND local_course_search MATCH ?
            ORDER BY bm25(
              local_course_search,
              0.0, 0.0, 0.0, 0.0, 8.0, 2.0, 0.0
            ) ASC
            LIMIT 20`,
        )
        .all(course.id, `"${String(searchSeed.term).replaceAll('"', '""')}"`),
  });
}

const results = {};
for (const workload of workloads) {
  for (let index = 0; index < 20; index += 1) workload.run();
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    workload.run();
    durations.push(performance.now() - startedAt);
  }
  results[workload.name] = {
    iterations,
    p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...durations).toFixed(3)),
  };
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
