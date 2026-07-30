#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OPENMAIC_ROOT = process.env.OPENMAIC_ROOT || path.resolve(ROOT, '..', 'OpenMAIC');
const OUTPUT = path.join(
  ROOT,
  'apps/native/src/data/snapshots/additional-queue-learning-content.v1.json',
);

function sourceFile(file) {
  const absolute = path.join(OPENMAIC_ROOT, file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing OpenMAIC source: ${absolute}`);
  }
  return absolute;
}

function initializerText(file, variableName) {
  const absolute = sourceFile(file);
  const source = fs.readFileSync(absolute, 'utf8');
  const ast = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      initializer = node.initializer?.getText(ast) || null;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!initializer) {
    throw new Error(`Missing ${variableName} in ${absolute}`);
  }
  return initializer;
}

function evaluateInitializer(file, variableName, context = {}) {
  return vm.runInNewContext(`(${initializerText(file, variableName)})`, {
    String,
    ...context,
  });
}

function rawMarkdown(strings, ...values) {
  return String.raw({ raw: strings }, ...values).trim();
}

function normalizedMarkdown(markdown) {
  return String(markdown)
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

function mat136Section(title, summary, markdown) {
  return { title, summary, markdown: normalizedMarkdown(markdown) };
}

function splitMemoryIntoSections(text) {
  const normalized = normalizedMarkdown(text);
  const matches = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) {
    return [{ title: '学习与答题指南', markdown: normalized }];
  }
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    return {
      title: match[1].trim(),
      markdown: normalized.slice(start, end).trim(),
    };
  });
}

function summary(markdown) {
  return markdown
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/[#>*`|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function validateSourcePath(sourcePath) {
  const absolute = path.join(ROOT, sourcePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing queue source: ${sourcePath}`);
  }
}

function validateNotebook(notebook) {
  validateSourcePath(notebook.sourcePath);
  if (!notebook.sections.length) {
    throw new Error(`${notebook.id}: no sections`);
  }
  for (const [index, section] of notebook.sections.entries()) {
    if (!section.title?.trim() || !section.markdown?.trim()) {
      throw new Error(`${notebook.id}: malformed section ${index + 1}`);
    }
    if (/Disclaimer|Speed Up Education|not for sale/i.test(section.markdown)) {
      throw new Error(`${notebook.id}/${section.title}: leaked boilerplate`);
    }
    if (/^\s*[-*]\s*$/m.test(section.markdown)) {
      throw new Error(`${notebook.id}/${section.title}: orphan list marker`);
    }
  }
}

const csc108Notebooks = evaluateInitializer(
  'scripts/maintenance/import-csc108-word-markdown-notebooks.mjs',
  'NOTEBOOKS',
  { m: rawMarkdown },
);

const mat136Descriptors = evaluateInitializer(
  'scripts/maintenance/import-mat136-queue-markdown-sections.mjs',
  'NOTEBOOKS',
);
const mat136Sections = evaluateInitializer(
  'scripts/maintenance/import-mat136-queue-markdown-sections.mjs',
  'CURATED_SECTIONS',
  {
    md: normalizedMarkdown,
    section: mat136Section,
  },
);

const mathMemoryModule = await import(
  pathToFileURL(sourceFile('scripts/maintenance/math-public-memory-concepts.mjs')).href
);
const csc108MemoryModule = await import(
  pathToFileURL(sourceFile('scripts/maintenance/csc108-public-memory-concepts.mjs')).href
);
const mat136MemoryFile = JSON.parse(
  fs.readFileSync(sourceFile('scripts/maintenance/mat136-notebook-public-memory.json'), 'utf8'),
);

const mat102SourcePaths = [
  'queue/MAT102/02SetsAndPropositions (1).pdf',
  'queue/MAT102/03LogicCont.pdf',
  'queue/MAT102/04Relations.pdf',
  'queue/MAT102/05FunctionsI.pdf',
  'queue/MAT102/06FunctionsII.pdf',
  'queue/MAT102/07NumberTheoryI.pdf',
  'queue/MAT102/08NumberTheoryII.pdf',
  'queue/MAT102/09NumberTheoryIII.pdf',
  'queue/MAT102/10InductionI-1.pdf',
  'queue/MAT102/11GroupTheory-2.pdf',
  'queue/MAT102/12GroupTheoryII.pdf',
];

const notebooks = [
  ...csc108Notebooks.map((notebook) => ({
    id: notebook.notebookId,
    courseId: 'course-csc108-local',
    name: notebook.name.replace(' - ', ' · '),
    description: notebook.description,
    tags: [...notebook.tags, 'queue', '本地'],
    sourcePath: `queue/CSC108/${notebook.sourceFile}`,
    sections: notebook.sections.map((section) => ({
      title: section.title,
      markdown: normalizedMarkdown(section.markdown),
      summary: summary(section.markdown),
    })),
  })),
  ...mathMemoryModule.MAT102_NOTEBOOK_MEMORY_SPECS.map((memory, index) => ({
    id: memory.notebookId,
    courseId: 'course-mat102-local',
    name: `${String(index + 2).padStart(2, '0')} · ${memory.title
      .replace(/^MAT102\s*/, '')
      .replace(/公共记忆|入口$/, '')
      .trim()}`,
    description: '依据 MAT102 queue 讲义整理的 proof-first 本地文本笔记。',
    tags: ['MAT102', '证明', 'queue', '本地'],
    sourcePath: mat102SourcePaths[index],
    sections: splitMemoryIntoSections(memory.text).map((section) => ({
      ...section,
      summary: summary(section.markdown),
    })),
  })),
  ...mat136Descriptors.map((descriptor) => ({
    id: descriptor.notebookId,
    courseId: 'course-mat136-local',
    name: `${descriptor.lectureNo} · ${descriptor.label}`,
    description: `依据 MAT136 queue 讲义整理的${descriptor.label}本地文本笔记。`,
    tags: ['MAT136', descriptor.label, 'queue', '本地'],
    sourcePath: `queue/MAT136/${descriptor.file}`,
    sections: mat136Sections[descriptor.notebookId].map((section) => ({
      title: section.title,
      markdown: normalizedMarkdown(section.markdown),
      summary: section.summary || summary(section.markdown),
    })),
  })),
];

for (const notebook of notebooks) validateNotebook(notebook);

const notebookSourcePath = new Map(notebooks.map((notebook) => [notebook.id, notebook.sourcePath]));

const memories = [
  {
    id: 'memory-csc108-course-answer-contract-local',
    courseId: 'course-csc108-local',
    notebookId: null,
    targetType: 'course',
    kind: 'answer_contract',
    title: 'CSC108 本地课程回答合约',
    text: csc108MemoryModule.CSC108_PUBLIC_MEMORY_TEXTS[csc108MemoryModule.CSC108_COURSE_MEMORY_ID],
    sourceReferences: csc108Notebooks.map((notebook) => `queue/CSC108/${notebook.sourceFile}`),
  },
  ...csc108MemoryModule.CSC108_NOTEBOOK_MEMORY_SPECS.map((spec) => ({
    id: `local-${spec.memoryId}`,
    courseId: 'course-csc108-local',
    notebookId: spec.notebookId,
    targetType: 'notebook',
    kind: 'notebook_public_memory',
    title: spec.title,
    text: csc108MemoryModule.CSC108_PUBLIC_MEMORY_TEXTS[spec.memoryId],
    sourceReferences: [notebookSourcePath.get(spec.notebookId)].filter(Boolean),
  })),
  {
    id: 'memory-mat102-course-answer-contract-local',
    courseId: 'course-mat102-local',
    notebookId: null,
    targetType: 'course',
    kind: 'answer_contract',
    title: 'MAT102 本地课程回答合约',
    text: mathMemoryModule.MATH_COURSE_MEMORY_TEXTS[mathMemoryModule.MAT102_COURSE_MEMORY_ID],
    sourceReferences: mat102SourcePaths,
  },
  ...mathMemoryModule.MAT102_NOTEBOOK_MEMORY_SPECS.map((spec, index) => ({
    id: `local-${spec.memoryId}`,
    courseId: 'course-mat102-local',
    notebookId: spec.notebookId,
    targetType: 'notebook',
    kind: 'notebook_public_memory',
    title: spec.title,
    text: spec.text,
    sourceReferences: [mat102SourcePaths[index]],
  })),
  {
    id: 'memory-mat136-course-answer-contract-local',
    courseId: 'course-mat136-local',
    notebookId: null,
    targetType: 'course',
    kind: 'answer_contract',
    title: 'MAT136 本地课程回答合约',
    text: mathMemoryModule.MATH_COURSE_MEMORY_TEXTS[mathMemoryModule.MAT136_COURSE_MEMORY_ID],
    sourceReferences: mat136Descriptors.map((descriptor) => `queue/MAT136/${descriptor.file}`),
  },
  ...mat136MemoryFile.memories.map((memory) => ({
    id: `local-${memory.id}`,
    courseId: 'course-mat136-local',
    notebookId: memory.notebookId,
    targetType: 'notebook',
    kind: 'notebook_public_memory',
    title: memory.title,
    text: memory.text,
    sourceReferences: [notebookSourcePath.get(memory.notebookId)].filter(Boolean),
  })),
];

for (const memory of memories) {
  if (!memory.text?.trim()) throw new Error(`${memory.id}: empty memory text`);
  for (const sourcePath of memory.sourceReferences) validateSourcePath(sourcePath);
}

const output = {
  version: 'additional-queue-learning-content-v1',
  generatedBy: 'manual-static-content-copy',
  sourceBoundary: 'repo-local queue sources; no API, database, LLM, or generation task',
  notebooks,
  memories,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

const stats = notebooks.reduce((result, notebook) => {
  const current = result[notebook.courseId] || { notebooks: 0, sections: 0, memories: 0 };
  current.notebooks += 1;
  current.sections += notebook.sections.length;
  result[notebook.courseId] = current;
  return result;
}, {});
for (const memory of memories) {
  stats[memory.courseId].memories += 1;
}
console.log(JSON.stringify({ output: OUTPUT, stats }, null, 2));
