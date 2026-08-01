#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAI } from '@ai-sdk/openai';
import { PrismaClient } from '@prisma/client';
import { generateText, Output } from 'ai';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { z } from 'zod';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const QUEUE_ROOT = path.join(ROOT, 'queue');
const GENERATED_DIR = path.join(ROOT, 'data', 'queue-notebooks-v2', 'generated');
const PREVIEW_DIR = path.join(ROOT, 'data', 'queue-notebooks-v2', 'previews');
const MANIFEST_PATH = path.join(ROOT, 'data', 'queue-notebooks-v2', 'manifest.json');
const LEGACY_SNAPSHOT_PATH = path.join(
  ROOT,
  'apps',
  'native',
  'src',
  'data',
  'snapshots',
  'additional-queue-learning-content.v1.json',
);
const IMPORT_VERSION = 'queue-notebook-rewrite-v3';
const DEFAULT_MODEL = 'gpt-5.6-terra';
const OWNER_ID = 'user-dongbochen1218-icloud-com';

const COURSE_CONFIG = {
  CPSC107: {
    localCourseId: 'course-cpsc107-local',
    productionCourseId: 'cmpc9dqgv000p8ogmrsjl5co8',
    language: 'zh-CN',
  },
  CSC108: {
    localCourseId: 'course-csc108-local',
    productionCourseId: 'cmpnueg4p001d8o017jee1mjq',
    language: 'zh-CN',
  },
  CSC148: {
    localCourseId: 'course-csc148-local',
    productionCourseId: 'cmqjfarz800158oi68s595q9n',
    language: 'zh-CN',
  },
  MAT102: {
    localCourseId: 'course-mat102-local',
    productionCourseId: 'cmpd5bird007v8ogmjuuiio03',
    language: 'zh-CN',
  },
  MAT136: {
    localCourseId: 'course-mat136-local',
    productionCourseId: 'cmpanemia001v8ouzmhttvkrn',
    language: 'zh-CN',
  },
  MOLECULE: {
    localCourseId: 'course-molecule-design-local',
    productionCourseId: 'cmqoac1vb00498o0uludsvrhd',
    language: 'zh-CN',
  },
};

const CPSC107_IDS = {
  '01_Rackert_基础.pdf': 'queue-cpsc107-01-racket-basics',
  '02_htdf_htdd.pdf': 'queue-cpsc107-02-htdf-htdd',
  '03_ref_self_ref.pdf': 'queue-cpsc107-03-ref-self-ref',
  '04_recursion_bst.pdf': 'queue-cpsc107-04-recursion-bst',
  '05_trees.pdf': 'queue-cpsc107-05-trees-mutual-reference',
  '06_two_one_of_local.pdf': 'queue-cpsc107-06-two-one-of-local',
  '07_Abstract.pdf': 'queue-cpsc107-07-abstract-functions',
  '08_Search.pdf': 'queue-cpsc107-08-search',
  '09_Tail_Recursion.pdf': 'queue-cpsc107-09-tail-recursion',
};

const CSC148_META = {
  '1_The_Python_Memory_Model.md': {
    id: 'local-queue-csc148-01-memory-model',
    name: '01 · Python 记忆模型',
  },
  '2_Testing_Your_code.md': {
    id: 'local-queue-csc148-02-testing',
    name: '02 · 测试你的代码',
  },
  '3_OOP.md': {
    id: 'local-queue-csc148-03-oop',
    name: '03 · 面向对象程序设计',
  },
  '4_ADT.md': {
    id: 'local-queue-csc148-04-adt',
    name: '04 · 抽象数据类型',
  },
  '5_Exception.md': {
    id: 'local-queue-csc148-05-exceptions',
    name: '05 · Exceptions',
  },
  '6_Linked_List.md': {
    id: 'local-queue-csc148-06-linked-list',
    name: '06 · Linked Lists',
  },
  '7_Recursion.md': {
    id: 'local-queue-csc148-07-recursion',
    name: '07 · Recursion',
  },
  '8_trees.md': {
    id: 'local-queue-csc148-08-trees',
    name: '08 · Trees',
  },
};

const sectionSchema = z.object({
  title: z.string().trim().min(1),
  kind: z.enum(['path', 'concept', 'method', 'example', 'mistake', 'practice', 'summary']),
  summary: z.string().trim(),
  markdown: z.string().trim().min(1),
  sourceRefs: z.array(z.string().trim().min(1)),
});

const notebookSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim(),
  tags: z.array(z.string().trim().min(1)),
  sourceStatus: z.enum(['read', 'source-limited']),
  coverageNotes: z.array(z.string().trim()),
  sections: z.array(sectionSchema).min(1),
});

function parseArgs(argv) {
  const options = {
    generate: false,
    write: false,
    force: false,
    only: [],
    model: null,
    limit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split('=', 2);
    const nextValue = () => inlineValue ?? argv[++index];
    if (argument === '--generate') options.generate = true;
    else if (argument === '--write') options.write = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (flag === '--only') {
      options.only.push(
        ...String(nextValue())
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (flag === '--model') options.model = String(nextValue()).trim();
    else if (flag === '--limit') options.limit = Number.parseInt(nextValue(), 10);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(
    `
Rebuild queue notebooks from source files and optionally import them into Railway.

Usage:
  node scripts/maintenance/rebuild-queue-notebooks.mjs
  node scripts/maintenance/rebuild-queue-notebooks.mjs --generate --only MAT102/02
  node scripts/maintenance/rebuild-queue-notebooks.mjs --generate --limit 2
  node scripts/maintenance/rebuild-queue-notebooks.mjs --write

Options:
  --generate       Generate or resume rewritten notebook JSON files with the LLM.
  --write          Import a fully generated manifest into PostgreSQL.
  --force          Regenerate matching checkpoint files.
  --only <terms>   Comma-separated source path, course, filename, or notebook-id filters.
  --limit <n>      Limit selected sources after filtering.
  --model <id>     Override DEFAULT_MODEL.

Default mode is a read-only audit. --write never invokes the model.
`.trim(),
  );
}

function loadEnvFile(filename) {
  const file = path.join(ROOT, filename);
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function normalizeModelId(value) {
  return (value?.trim() || DEFAULT_MODEL).replace(/^(?:openai[:/])+/i, '');
}

function stableSlug(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function courseKeyFor(relativePath) {
  // This Markdown file is an all-question exam source. It belongs in the
  // problem bank import path and must not become a teaching notebook.
  if (relativePath === 'queue/CSC108/12_FinalExam_2025_Questions.md') return null;
  if (relativePath.startsWith('queue/CPSC107/')) return 'CPSC107';
  if (relativePath.startsWith('queue/CSC108/')) return 'CSC108';
  if (relativePath.startsWith('queue/CSC148/')) return 'CSC148';
  if (relativePath.startsWith('queue/MAT102/')) return 'MAT102';
  if (relativePath.startsWith('queue/MAT136/')) return 'MAT136';
  if (relativePath === 'queue/Bochen_Paper 2_Molecule_Image_MolecularGeneration.pdf') {
    return 'MOLECULE';
  }
  return null;
}

function listTeachingSources() {
  const results = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.(pdf|docx|md)$/i.test(entry.name)) {
        const relativePath = path.relative(ROOT, absolute).split(path.sep).join('/');
        const courseKey = courseKeyFor(relativePath);
        if (courseKey) results.push({ absolute, relativePath, courseKey });
      }
    }
  };
  walk(QUEUE_ROOT);
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function legacyBySourcePath() {
  const snapshot = JSON.parse(fs.readFileSync(LEGACY_SNAPSHOT_PATH, 'utf8'));
  return new Map(snapshot.notebooks.map((notebook) => [notebook.sourcePath, notebook]));
}

function sourceMetadata(source, legacyMap) {
  const filename = path.basename(source.absolute);
  const config = COURSE_CONFIG[source.courseKey];
  const legacy = legacyMap.get(source.relativePath);
  const csc148 = source.courseKey === 'CSC148' ? CSC148_META[filename] : null;
  const cpsc107Id = source.courseKey === 'CPSC107' ? CPSC107_IDS[filename] : null;
  const id =
    legacy?.id ||
    csc148?.id ||
    cpsc107Id ||
    (source.courseKey === 'MOLECULE'
      ? 'queue-molecule-image-molecular-generation-paper'
      : `queue-${source.courseKey.toLowerCase()}-${stableSlug(filename)}`);
  return {
    ...source,
    ...config,
    id,
    priorName: legacy?.name || csc148?.name || filename.replace(/\.[^.]+$/, ''),
  };
}

function pdfText(source) {
  const info = execFileSync('pdfinfo', [source.absolute], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const pageCount = Number.parseInt(info.match(/^Pages:\s+(\d+)/m)?.[1] || '0', 10);
  const raw = execFileSync('pdftotext', ['-layout', source.absolute, '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const pages = raw.split('\f').filter((page) => page.trim());
  return {
    pageCount: pageCount || pages.length,
    text: pages
      .map((page, index) => `\n\n===== PDF PAGE ${index + 1} =====\n${page.trim()}`)
      .join(''),
  };
}

function docxText(source) {
  const text = execFileSync('pandoc', ['--from=docx', '--to=gfm', '--wrap=none', source.absolute], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { pageCount: null, text };
}

function extractSource(source) {
  const extension = path.extname(source.absolute).toLowerCase();
  let extracted;
  if (extension === '.pdf') extracted = pdfText(source);
  else if (extension === '.docx') extracted = docxText(source);
  else extracted = { pageCount: null, text: fs.readFileSync(source.absolute, 'utf8') };
  const normalized = extracted.text
    .replace(/\r/g, '')
    // PDF font maps occasionally leak C0 control bytes. They are evidence
    // corruption, not mathematical notation, and must never reach the model.
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return {
    ...extracted,
    text: normalized.length > 180_000 ? normalized.slice(0, 180_000) : normalized,
    extractedChars: normalized.length,
    truncated: normalized.length > 180_000,
  };
}

function buildClient(apiKey) {
  const proxyUrl =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    null;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  const proxyFetch = (input, init = {}) =>
    undiciFetch(input, dispatcher ? { ...init, dispatcher } : init);
  return {
    openai: createOpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      fetch: proxyFetch,
    }),
    dispatcher,
  };
}

function systemPrompt() {
  return [
    '你是大学课程的资深讲义作者。你的任务是把源文件重写为学生真正愿意读、能够用于复习和解题的 Markdown 笔记本。',
    '源文件只是证据，不得直接复制 OCR，不得编造源文件没有支持的定理、题目、数字或课程要求。',
    '所有学生可见说明使用简体中文；标准数学符号、代码标识符、Racket/Python API 和课程代码可保留英文。',
    '按知识单元组织，不按 PDF 页机械切分；章节数量和篇幅由源材料及教学需要决定。',
    '必须保存并讲清源文件中的例题、证明步骤、设计配方、代码模板、公式推导和检查方法。',
    '源材料包含值得教学的例题、证明、方法或实验时，应选择具有代表性的内容完整讲解，不为满足数量而凑案例。',
    '每个例题必须包含题目、方法选择、主要步骤、结果，以及适用时的易错点或验算。',
    '不要输出免责声明、机构宣传、老师私人指令、销售信息、页眉页脚或制作说明。',
    '数学使用 $...$ 与 $$...$$；代码课程可以使用 fenced code block，数学课程不要把普通文本误写成代码块。',
    '集合与逻辑符号必须使用明确的 LaTeX 命令，例如 \\in、\\cup、\\cap、\\subseteq、\\land、\\lor、\\neg；禁止使用八进制转义、控制字符或来源中的损坏字形。',
    '章节正文需要自洽、具体、有教学递进，不能只是提纲、术语列表或泛泛总结。',
    'sourceRefs 必须指向真实的页码或源文件标题/小节；无法确认时明确标记 source-limited，不得猜测。',
  ].join('\n');
}

function generationPrompt(source, extracted) {
  return [
    '## 重写任务',
    JSON.stringify(
      {
        course: source.courseKey,
        priorNotebookName: source.priorName,
        sourcePath: source.relativePath,
        sourceType: path.extname(source.absolute).slice(1).toLowerCase(),
        pageCount: extracted.pageCount,
        extractedChars: extracted.extractedChars,
        truncated: extracted.truncated,
        sectionPlanning: '按源材料的知识结构和教学递进自然拆分，不设置固定章节数量。',
      },
      null,
      2,
    ),
    '## 输出要求',
    [
      '- name：保留讲次顺序，改成准确自然的课程标题。',
      '- description：说明学生学完能做什么，不写“依据某文件整理”。',
      '- tags：使用课程、核心概念和方法标签。',
      '- sections：形成完整教学链：学习路径 → 核心概念/方法 → 多个例题 → 易错点 → 自测/总结。',
      '- markdown：直接写学生正文，不要重复章节标题，不要提及你是 AI。',
      '- coverageNotes：只记录源材料缺失、OCR 不确定或有意省略的内容；没有则为空数组。',
    ].join('\n'),
    '## 源文件提取文本',
    extracted.text,
  ].join('\n\n');
}

function normalizeGeneratedNotebook(notebook) {
  return {
    ...notebook,
    sections: notebook.sections.map((section) => ({
      ...section,
      // The reader already renders section.title. Remove a redundant first
      // heading while preserving any meaningful subheadings below it.
      markdown: section.markdown.replace(/^#{1,6}\s+[^\n]+\n+/, '').trim(),
    })),
  };
}

function generationStats(notebook) {
  const combined = notebook.sections.map((section) => section.markdown).join('\n\n');
  const exampleCount = notebook.sections.filter((section) => section.kind === 'example').length;
  return {
    sectionCount: notebook.sections.length,
    exampleCount,
    bodyChars: combined.length,
  };
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filename);
}

async function atomicWriteText(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function writePreview(source, checkpoint) {
  const notebook = checkpoint.notebook;
  const markdown = [
    `# ${notebook.name}`,
    '',
    notebook.description,
    '',
    `> 来源：${source.relativePath}`,
    `> 模型：${checkpoint.model}`,
    '',
    ...notebook.sections.flatMap((section) => [`## ${section.title}`, '', section.markdown, '']),
  ].join('\n');
  await atomicWriteText(path.join(PREVIEW_DIR, `${source.id}.md`), `${markdown.trim()}\n`);
}

function checkpointPath(source) {
  return path.join(GENERATED_DIR, `${source.id}.json`);
}

async function generateOne({ source, openai, model, force }) {
  const outputPath = checkpointPath(source);
  if (!force && fs.existsSync(outputPath)) {
    const existing = JSON.parse(await readFile(outputPath, 'utf8'));
    const parsed = notebookSchema.safeParse(existing.notebook);
    if (parsed.success) {
      await writePreview(source, existing);
      console.log(`[resume] ${source.id}`);
      return existing;
    }
  }
  const extracted = extractSource(source);
  if (extracted.extractedChars < 800) {
    throw new Error(
      `${source.relativePath}: extracted text is too short (${extracted.extractedChars})`,
    );
  }
  console.log(
    `[generate] ${source.id} source=${source.relativePath} chars=${extracted.extractedChars}`,
  );
  const generated = await generateText({
    model: openai.chat(model),
    system: systemPrompt(),
    prompt: generationPrompt(source, extracted),
    output: Output.object({ schema: notebookSchema }),
    maxOutputTokens: 24_000,
    maxRetries: 2,
  });
  if (!generated.output) throw new Error(`${source.id}: model returned no structured output`);
  const notebook = normalizeGeneratedNotebook(generated.output);
  const stats = generationStats(notebook);
  const checkpoint = {
    schemaVersion: 3,
    importVersion: IMPORT_VERSION,
    generatedAt: new Date().toISOString(),
    model,
    source: {
      id: source.id,
      courseKey: source.courseKey,
      localCourseId: source.localCourseId,
      productionCourseId: source.productionCourseId,
      sourcePath: source.relativePath,
      pageCount: extracted.pageCount,
      extractedChars: extracted.extractedChars,
      truncated: extracted.truncated,
    },
    notebook,
    stats,
    usage: generated.usage,
  };
  await atomicWriteJson(outputPath, checkpoint);
  await writePreview(source, checkpoint);
  console.log(
    `[generated] ${source.id} sections=${stats.sectionCount} examples=${stats.exampleCount} chars=${stats.bodyChars}`,
  );
  return checkpoint;
}

async function assembleManifest(sources, { requireComplete = true } = {}) {
  const notebooks = [];
  const missing = [];
  for (const source of sources) {
    const filename = checkpointPath(source);
    if (!fs.existsSync(filename)) {
      missing.push(source.id);
      continue;
    }
    const checkpoint = JSON.parse(await readFile(filename, 'utf8'));
    const parsed = notebookSchema.safeParse(checkpoint.notebook);
    if (!parsed.success) throw new Error(`${source.id}: checkpoint has an invalid output shape`);
    notebooks.push({
      id: source.id,
      courseKey: source.courseKey,
      localCourseId: source.localCourseId,
      productionCourseId: source.productionCourseId,
      sourcePath: source.relativePath,
      model: checkpoint.model,
      generatedAt: checkpoint.generatedAt,
      ...parsed.data,
      stats: checkpoint.stats || generationStats(parsed.data),
    });
  }
  if (requireComplete && missing.length) {
    throw new Error(`Missing ${missing.length} generated notebooks: ${missing.join(', ')}`);
  }
  const manifest = {
    schemaVersion: 3,
    version: IMPORT_VERSION,
    generatedAt: new Date().toISOString(),
    sourceBoundary: 'queue PDF, DOCX, and Markdown teaching sources; question-bank JSON excluded',
    notebookCount: notebooks.length,
    notebooks,
  };
  await atomicWriteJson(MANIFEST_PATH, manifest);
  return { manifest, missing };
}

async function importManifest(manifest) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for --write');
  const prisma = new PrismaClient();
  const results = [];
  try {
    const courses = await prisma.course.findMany({
      where: {
        id: { in: Object.values(COURSE_CONFIG).map((course) => course.productionCourseId) },
      },
      select: { id: true, ownerId: true, name: true },
    });
    const courseById = new Map(courses.map((course) => [course.id, course]));
    for (const config of Object.values(COURSE_CONFIG)) {
      const course = courseById.get(config.productionCourseId);
      if (!course) throw new Error(`Production course missing: ${config.productionCourseId}`);
      if (course.ownerId !== OWNER_ID) {
        throw new Error(
          `Production course owner mismatch: ${course.id} owner=${course.ownerId} expected=${OWNER_ID}`,
        );
      }
    }

    for (const notebook of manifest.notebooks) {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.notebook.findUnique({
          where: { id: notebook.id },
          select: {
            id: true,
            ownerId: true,
            courseId: true,
            notebookKind: true,
            sceneCount: true,
            sectionCount: true,
          },
        });
        if (existing && existing.ownerId !== OWNER_ID) {
          throw new Error(`${notebook.id}: owned by ${existing.ownerId}, refusing overwrite`);
        }
        const keepImageNotebook = Boolean(existing && existing.sceneCount > 0);
        const data = {
          ownerId: OWNER_ID,
          courseId: notebook.productionCourseId,
          name: notebook.name,
          description: notebook.description,
          tags: notebook.tags,
          language: COURSE_CONFIG[notebook.courseKey].language,
          notebookKind: keepImageNotebook ? existing.notebookKind : 'markdown',
          sectionCount: notebook.sections.length,
          contentVersion: existing ? { increment: 1 } : 1,
        };
        await tx.notebook.upsert({
          where: { id: notebook.id },
          create: { id: notebook.id, ...data },
          update: data,
        });
        await tx.markdownNotebookSection.deleteMany({ where: { notebookId: notebook.id } });
        await tx.markdownNotebookSection.createMany({
          data: notebook.sections.map((section, index) => ({
            notebookId: notebook.id,
            courseId: notebook.productionCourseId,
            title: section.title,
            order: index,
            markdown: section.markdown,
            summary: section.summary,
            sourceMeta: {
              sourceKind: 'queue-source-rewrite',
              sourcePath: notebook.sourcePath,
              sourceRefs: section.sourceRefs,
              sectionKind: section.kind,
              importVersion: manifest.version,
              model: notebook.model,
              generatedAt: notebook.generatedAt,
            },
          })),
        });
        return {
          id: notebook.id,
          created: !existing,
          oldSectionCount: existing?.sectionCount ?? 0,
          newSectionCount: notebook.sections.length,
          preservedSceneCount: existing?.sceneCount ?? 0,
        };
      });
      results.push(result);
      console.log(
        `[write] ${result.id} ${result.created ? 'created' : 'updated'} sections=${result.oldSectionCount}->${result.newSectionCount} scenes=${result.preservedSceneCount}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  loadEnvFile('.env');
  loadEnvFile('.env.local');
  const legacyMap = legacyBySourcePath();
  const allSources = listTeachingSources().map((source) => sourceMetadata(source, legacyMap));
  const selected = allSources
    .filter((source) => {
      if (!options.only.length) return true;
      const haystack = [
        source.id,
        source.courseKey,
        source.relativePath,
        path.basename(source.relativePath),
      ]
        .join(' ')
        .toLowerCase();
      return options.only.some((term) => haystack.includes(term.toLowerCase()));
    })
    .slice(0, options.limit || undefined);

  const audit = {
    totalSources: allSources.length,
    selectedSources: selected.length,
    byCourse: Object.fromEntries(
      Object.keys(COURSE_CONFIG).map((courseKey) => [
        courseKey,
        allSources.filter((source) => source.courseKey === courseKey).length,
      ]),
    ),
    generated: allSources.filter((source) => fs.existsSync(checkpointPath(source))).length,
    manifestExists: fs.existsSync(MANIFEST_PATH),
  };
  console.log(JSON.stringify(audit, null, 2));

  if (options.generate) {
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required');
    const model = normalizeModelId(options.model || process.env.DEFAULT_MODEL);
    const { openai, dispatcher } = buildClient(process.env.OPENAI_API_KEY);
    try {
      for (const source of selected) {
        await generateOne({ source, openai, model, force: options.force });
      }
    } finally {
      await dispatcher?.close();
    }
    const complete = allSources.every((source) => fs.existsSync(checkpointPath(source)));
    const assembled = await assembleManifest(allSources, { requireComplete: complete });
    console.log(
      JSON.stringify(
        {
          manifest: path.relative(ROOT, MANIFEST_PATH),
          notebooks: assembled.manifest.notebookCount,
          missing: assembled.missing.length,
        },
        null,
        2,
      ),
    );
  }

  if (options.write) {
    const { manifest } = await assembleManifest(allSources, { requireComplete: true });
    const results = await importManifest(manifest);
    console.log(
      JSON.stringify(
        {
          imported: results.length,
          created: results.filter((result) => result.created).length,
          updated: results.filter((result) => !result.created).length,
          manifest: path.relative(ROOT, MANIFEST_PATH),
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
