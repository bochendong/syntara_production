#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'data', 'platform-tests', 'problem-banks');
const MAT136_SOURCE = path.join(
  ROOT,
  'tmp',
  'db-v2-critical-export-smoke',
  'mat102-mat136-problem-banks.json',
);
const CSC148_SOURCE = path.join(ROOT, 'data', 'csc148', 'problem-bank.json');
const CSC148_ID_MAP_SOURCE = path.join(OUTPUT_DIR, 'csc148-problem-id-map.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compact(value, maxLength = 8_000) {
  const text = String(value ?? '').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function compactTitle(value) {
  const firstMeaningfulLine = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s*/, '').trim())
    .find(Boolean);
  return compact(firstMeaningfulLine || '未命名题目', 180);
}

function publicQuestionText(publicContent, fallback) {
  const content = asRecord(publicContent);
  const direct = content.stem ?? content.question ?? content.prompt;
  if (typeof direct === 'string' && direct.trim()) return compact(direct);
  return compact(fallback);
}

function sanitizedPublicContent(value) {
  const content = asRecord(value);
  const allowedKeys = [
    'type',
    'stem',
    'selectionMode',
    'options',
    'starterCode',
    'codeSnippet',
    'functionName',
    'description',
    'statementSections',
    'starterCodeDescription',
  ];
  return Object.fromEntries(
    allowedKeys.filter((key) => content[key] !== undefined).map((key) => [key, content[key]]),
  );
}

function validateCsc148IdMap(source, idMapSnapshot) {
  const courseId = String(idMapSnapshot.courseId || '').trim();
  if (!courseId) throw new Error('CSC148 id map is missing its verified courseId.');
  const problemIdsBySourceId = asRecord(idMapSnapshot.problemIdsBySourceId);
  const titlesBySourceId = asRecord(idMapSnapshot.titlesBySourceId);
  const metadataBySourceId = asRecord(idMapSnapshot.metadataBySourceId);
  const sourceIds = new Set(source.problems.map((problem) => String(problem.id)));
  const entries = Object.entries(problemIdsBySourceId);
  const problemIds = entries.map(([, problemId]) => String(problemId || '').trim());
  if (!entries.length || problemIds.some((problemId) => !problemId)) {
    throw new Error('CSC148 id map contains an empty sourceId or problemId.');
  }
  if (new Set(problemIds).size !== problemIds.length) {
    throw new Error('CSC148 id map is not one-to-one: duplicate NotebookProblem ids found.');
  }
  for (const [sourceId] of entries) {
    if (!sourceIds.has(sourceId)) {
      throw new Error(`CSC148 id map contains unknown source row ${sourceId}.`);
    }
    if (!String(titlesBySourceId[sourceId] || '').trim()) {
      throw new Error(`CSC148 id map is missing the database title for ${sourceId}.`);
    }
    const metadata = asRecord(metadataBySourceId[sourceId]);
    if (metadata.status !== 'published') {
      throw new Error(`CSC148 id map row ${sourceId} is not verified as published.`);
    }
    if (!String(metadata.type || '').trim() || !String(metadata.difficulty || '').trim()) {
      throw new Error(`CSC148 id map row ${sourceId} is missing database metadata.`);
    }
  }
}

function buildMat136() {
  const source = readJson(MAT136_SOURCE);
  const course = source.courses.find(
    (item) =>
      String(item.courseCode || '')
        .replace(/\s+/g, '')
        .toUpperCase() === 'MAT136' && item.listedInCourseStore,
  );
  if (!course) throw new Error('The MAT136 published course is missing from the DB snapshot.');
  const notebookNames = new Map(course.notebooks.map((item) => [item.id, item.name]));
  const problems = course.problems
    .filter((problem) => problem.status === 'published')
    .map((problem) => ({
      id: problem.id,
      sourceId: problem.id,
      order: problem.order,
      title: compactTitle(problem.title),
      notebookId: problem.notebookId || null,
      notebookTitle: notebookNames.get(problem.notebookId) || null,
      type: problem.type,
      difficulty: problem.difficulty,
      points: problem.points,
      tags: Array.isArray(problem.tags) ? problem.tags.map(String) : [],
      question: publicQuestionText(problem.publicContentJson, problem.title),
      publicContent: sanitizedPublicContent(problem.publicContentJson),
      source: 'database_snapshot',
    }));
  return {
    schemaVersion: 1,
    courseCode: 'MAT136',
    courseId: course.id,
    courseName: course.name,
    source: 'db-v2-critical-export-smoke',
    sourceExportedAt: source.exportedAt,
    generatedAt: new Date().toISOString(),
    problemCount: problems.length,
    problems,
  };
}

function buildCsc148() {
  const source = readJson(CSC148_SOURCE);
  const idMapSnapshot = readJson(CSC148_ID_MAP_SOURCE);
  validateCsc148IdMap(source, idMapSnapshot);
  const problemIdsBySourceId = asRecord(idMapSnapshot.problemIdsBySourceId);
  const titlesBySourceId = asRecord(idMapSnapshot.titlesBySourceId);
  const metadataBySourceId = asRecord(idMapSnapshot.metadataBySourceId);
  const problems = source.problems.flatMap((problem) => {
    const problemId = String(problemIdsBySourceId[problem.id] || '').trim();
    // The production importer intentionally skips a small number of unsupported source rows.
    // A source-only id cannot become a student-facing link, so it is excluded from this bank.
    if (!problemId) return [];
    const databaseMetadata = asRecord(metadataBySourceId[problem.id]);
    const publicContent = {
      type: problem.type,
      stem: problem.question || problem.description || problem.title,
      options: problem.options,
      starterCode: problem.templateCode,
    };
    return [
      {
        id: problemId,
        sourceId: problem.id,
        order: problem.order,
        title: compactTitle(titlesBySourceId[problem.id] || problem.title),
        notebookId: problem.notebookId || null,
        notebookTitle: problem.notebookTitle || problem.sectionTitle || problem.category || null,
        type: String(databaseMetadata.type || problem.type),
        difficulty: String(databaseMetadata.difficulty || problem.difficulty),
        points: typeof problem.points === 'number' ? problem.points : 1,
        tags: Array.isArray(problem.tags) ? problem.tags.map(String) : [],
        question: publicQuestionText(publicContent, problem.title),
        publicContent: sanitizedPublicContent(publicContent),
        source: 'database_snapshot',
      },
    ];
  });
  return {
    schemaVersion: 1,
    courseCode: 'CSC148',
    courseId: idMapSnapshot.courseId,
    courseName: source.course || 'CSC148',
    source: source.sourceFile || 'data/csc148/problem-bank.json',
    sourceExportedAt: source.generatedAt || null,
    generatedAt: new Date().toISOString(),
    problemCount: problems.length,
    problems,
  };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const banks = [buildMat136(), buildCsc148()];
for (const bank of banks) {
  const filePath = path.join(OUTPUT_DIR, `${bank.courseCode.toLowerCase()}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(bank, null, 2)}\n`);
  console.log(
    `${bank.courseCode}: ${bank.problemCount} problems -> ${path.relative(ROOT, filePath)}`,
  );
}
