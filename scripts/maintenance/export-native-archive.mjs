#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const ARCHIVE_FORMAT = 'syntara-native-archive';
const ARCHIVE_VERSION = 1;

function option(name) {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function timestamp(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function jsonRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function messageText(message) {
  if (typeof message.plainText === 'string' && message.plainText.trim()) {
    return message.plainText;
  }
  if (typeof message.content === 'string') return message.content;
  const content = jsonRecord(message.content);
  if (typeof content.text === 'string') return content.text;
  if (typeof content.content === 'string') return content.content;
  const parts = jsonArray(content.parts)
    .flatMap((part) => {
      if (typeof part === 'string') return [part];
      const record = jsonRecord(part);
      return typeof record.text === 'string' ? [record.text] : [];
    })
    .join('\n');
  return parts || JSON.stringify(message.content ?? {});
}

function localAssetPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;
  try {
    const pathname = /^https?:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
    if (
      pathname.startsWith('/generated-notebooks/') ||
      pathname.startsWith('/api/uploads/images/') ||
      pathname.startsWith('/uploads/')
    ) {
      return pathname.split(/[?#]/, 1)[0];
    }
  } catch {
    return null;
  }
  return null;
}

function collectAssetPaths(value, output) {
  if (typeof value === 'string') {
    const direct = localAssetPath(value);
    if (direct) output.add(direct);
    for (const match of value.matchAll(
      /(?:https?:\/\/[^\s"'<>)]*)?(\/(?:generated-notebooks|api\/uploads\/images|uploads)\/[^\s"'<>)]*)/g,
    )) {
      const normalized = localAssetPath(match[0] || match[1]);
      if (normalized) output.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetPaths(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetPaths(item, output);
  }
}

async function findNotebookImageAssets(prisma, paths) {
  const rows = [];
  for (let index = 0; index < paths.length; index += 500) {
    rows.push(
      ...(await prisma.notebookImageAsset.findMany({
        where: { path: { in: paths.slice(index, index + 500) } },
      })),
    );
  }
  return rows;
}

async function resolveOwner(prisma) {
  const ownerId = option('owner-id');
  const email = option('email');
  if (ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, email: true, name: true },
    });
    if (!owner) throw new Error(`找不到 owner-id=${ownerId} 对应的用户。`);
    return owner;
  }
  if (email) {
    const owner = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!owner) throw new Error(`找不到 email=${email} 对应的用户。`);
    return owner;
  }

  const owners = await prisma.course.groupBy({
    by: ['ownerId'],
    _count: { _all: true },
  });
  if (owners.length !== 1) {
    const candidates = await prisma.user.findMany({
      where: { id: { in: owners.map((owner) => owner.ownerId) } },
      select: { id: true, email: true, name: true },
      orderBy: { email: 'asc' },
    });
    const lines = candidates.map(
      (candidate) => `- ${candidate.email ?? candidate.name ?? '无邮箱'} (${candidate.id})`,
    );
    throw new Error(
      ['数据库中有多个课程所有者，请用 --email 或 --owner-id 指定要迁移的账号。', ...lines].join(
        '\n',
      ),
    );
  }
  const owner = await prisma.user.findUnique({
    where: { id: owners[0].ownerId },
    select: { id: true, email: true, name: true },
  });
  if (!owner) throw new Error('唯一课程所有者已不存在。');
  return owner;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return path.resolve(`syntara-${stamp}.syntara.json`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const owner = await resolveOwner(prisma);
    const courses = await prisma.course.findMany({
      where: { ownerId: owner.id },
      orderBy: { updatedAt: 'desc' },
    });
    const courseIds = courses.map((course) => course.id);
    const notebooks = await prisma.notebook.findMany({
      where: { ownerId: owner.id, courseId: { in: courseIds } },
      orderBy: { updatedAt: 'desc' },
    });
    const notebookIds = notebooks.map((notebook) => notebook.id);
    const notebookById = new Map(notebooks.map((notebook) => [notebook.id, notebook]));

    const [
      modernPages,
      legacyScenes,
      markdownSections,
      problems,
      legacyConversations,
      courseConversations,
      studyMemories,
    ] = await Promise.all([
      prisma.notebookPage.findMany({
        where: { notebookId: { in: notebookIds } },
        include: {
          content: true,
          actions: true,
          assets: {
            include: { asset: true },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
      }),
      prisma.scene.findMany({
        where: { notebookId: { in: notebookIds } },
        orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
      }),
      prisma.markdownNotebookSection.findMany({
        where: { notebookId: { in: notebookIds } },
        orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
      }),
      prisma.notebookProblem.findMany({
        where: {
          OR: [{ courseId: { in: courseIds } }, { notebookId: { in: notebookIds } }],
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.conversation.findMany({
        where: {
          ownerId: owner.id,
          kind: { in: ['notebook', 'agent', 'system'] },
          OR: [{ courseId: { in: courseIds } }, { notebookId: { in: notebookIds } }],
        },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.courseConversation.findMany({
        where: {
          ownerId: owner.id,
          courseId: { in: courseIds },
          deletedAt: null,
        },
        include: {
          messages: {
            where: { deletedAt: null },
            orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.studyMemory.findMany({
        where: {
          ownerId: owner.id,
          OR: [{ courseId: { in: courseIds } }, { notebookId: { in: notebookIds } }],
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const archivedCourseConversations = courseConversations.map((conversation) => ({
      id: conversation.id,
      courseId: conversation.courseId,
      notebookId: null,
      title: conversation.title || '新对话',
      createdAt: timestamp(conversation.createdAt),
      updatedAt: timestamp(conversation.updatedAt),
    }));
    const dedicatedCourseConversationIds = new Set(
      archivedCourseConversations.map((conversation) => conversation.id),
    );
    const archivedLegacyConversations = legacyConversations.flatMap((conversation) => {
      if (dedicatedCourseConversationIds.has(conversation.id)) return [];
      const courseId =
        conversation.courseId ??
        (conversation.notebookId
          ? (notebookById.get(conversation.notebookId)?.courseId ?? null)
          : null);
      if (!courseId) return [];
      return [
        {
          id: conversation.id,
          courseId,
          notebookId: conversation.notebookId,
          title: conversation.title ?? '新对话',
          createdAt: timestamp(conversation.createdAt),
          updatedAt: timestamp(conversation.updatedAt),
        },
      ];
    });
    const archivedConversations = [...archivedCourseConversations, ...archivedLegacyConversations];
    const archivedConversationIds = new Set(
      archivedConversations.map((conversation) => conversation.id),
    );
    const archivedMessages = [
      ...courseConversations.flatMap((conversation) =>
        conversation.messages.map((message) => ({
          id: message.id,
          conversationId: conversation.id,
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: messageText(message),
          createdAt: timestamp(message.createdAt),
        })),
      ),
      ...legacyConversations.flatMap((conversation) =>
        archivedConversationIds.has(conversation.id)
          ? conversation.messages.map((message) => ({
              id: message.id,
              conversationId: conversation.id,
              role:
                message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
              text: messageText(message),
              createdAt: timestamp(message.createdAt),
            }))
          : [],
      ),
    ];

    const problemIds = problems.map((problem) => problem.id);
    const [attempts, progress] = await Promise.all([
      prisma.notebookProblemAttempt.findMany({
        where: { userId: owner.id, problemId: { in: problemIds } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.notebookProblemProgress.findMany({
        where: { userId: owner.id, problemId: { in: problemIds } },
      }),
    ]);

    const modernPageNotebookIds = new Set(modernPages.map((page) => page.notebookId));
    const notebookPages = [
      ...modernPages.map((page) => ({
        id: page.id,
        notebookId: page.notebookId,
        courseId: page.courseId,
        sourceSceneId: page.sourceSceneId,
        title: page.title,
        type: page.type,
        order: page.order,
        content: jsonRecord(page.content?.content),
        actions: jsonArray(page.actions?.actions),
        whiteboard: page.content?.whiteboard ? jsonRecord(page.content.whiteboard) : null,
        createdAt: timestamp(page.createdAt),
        updatedAt: timestamp(page.updatedAt),
      })),
      ...legacyScenes
        .filter((scene) => !modernPageNotebookIds.has(scene.notebookId))
        .map((scene) => ({
          id: scene.id,
          notebookId: scene.notebookId,
          courseId: notebookById.get(scene.notebookId)?.courseId ?? null,
          sourceSceneId: scene.id,
          title: scene.title,
          type: scene.type,
          order: scene.order,
          content: jsonRecord(scene.content),
          actions: jsonArray(scene.actions),
          whiteboard: scene.whiteboard ? jsonRecord(scene.whiteboard) : null,
          createdAt: timestamp(scene.createdAt),
          updatedAt: timestamp(scene.updatedAt),
        })),
    ];

    const canonicalProblems = problems.flatMap((problem) => {
      const notebookCourseId = problem.notebookId
        ? notebookById.get(problem.notebookId)?.courseId
        : null;
      const courseId = problem.courseId ?? notebookCourseId;
      if (!courseId) return [];
      return [
        {
          id: problem.id,
          courseId,
          notebookId: problem.notebookId,
          title: problem.title,
          type: problem.type,
          status: problem.status,
          difficulty: problem.difficulty,
          tags: problem.tags,
          publicContent: jsonRecord(problem.publicContentJson),
          grading: jsonRecord(problem.gradingJson),
          createdAt: timestamp(problem.createdAt),
          updatedAt: timestamp(problem.updatedAt),
        },
      ];
    });
    const canonicalProblemIds = new Set(canonicalProblems.map((problem) => problem.id));
    const referencedAssetPaths = new Set();
    const assetNotebookIdsByPath = new Map();
    const rememberNotebookAssets = (notebookId, value) => {
      if (!notebookId) return;
      const paths = new Set();
      collectAssetPaths(value, paths);
      for (const assetPath of paths) {
        referencedAssetPaths.add(assetPath);
        const notebookIdsForAsset = assetNotebookIdsByPath.get(assetPath) ?? new Set();
        notebookIdsForAsset.add(notebookId);
        assetNotebookIdsByPath.set(assetPath, notebookIdsForAsset);
      }
    };
    for (const page of notebookPages) {
      rememberNotebookAssets(page.notebookId, page.content);
      rememberNotebookAssets(page.notebookId, page.actions);
      rememberNotebookAssets(page.notebookId, page.whiteboard);
    }
    for (const section of markdownSections) {
      rememberNotebookAssets(section.notebookId, section.markdown);
      rememberNotebookAssets(section.notebookId, section.sourceMeta);
    }
    for (const problem of canonicalProblems) {
      rememberNotebookAssets(problem.notebookId, problem.publicContent);
      rememberNotebookAssets(problem.notebookId, problem.grading);
    }

    const linkedAssets = modernPages.flatMap((page) =>
      page.assets.map((link) => ({ ...link.asset, notebookId: page.notebookId })),
    );
    for (const asset of linkedAssets) {
      referencedAssetPaths.add(asset.path);
      const notebookIdsForAsset = assetNotebookIdsByPath.get(asset.path) ?? new Set();
      notebookIdsForAsset.add(asset.notebookId);
      assetNotebookIdsByPath.set(asset.path, notebookIdsForAsset);
    }
    const binaryAssets = await findNotebookImageAssets(prisma, [...referencedAssetPaths]);
    const binaryAssetByPath = new Map(binaryAssets.map((asset) => [asset.path, asset]));
    const canonicalAssetByPath = new Map();
    for (const linked of linkedAssets) {
      const binary = linked.data ? null : binaryAssetByPath.get(linked.path);
      const bytes = linked.data
        ? Buffer.from(linked.data)
        : binary?.data
          ? Buffer.from(binary.data)
          : null;
      canonicalAssetByPath.set(linked.path, {
        id: linked.id,
        path: linked.path,
        mimeType: linked.mimeType,
        sizeBytes: bytes?.length ?? linked.sizeBytes,
        sha256: bytes ? sha256(bytes) : linked.sha256,
        source: linked.source,
        dataBase64: bytes?.toString('base64') ?? null,
        createdAt: timestamp(linked.createdAt),
        updatedAt: timestamp(linked.updatedAt),
      });
    }
    for (const binary of binaryAssets) {
      if (canonicalAssetByPath.has(binary.path)) continue;
      const bytes = Buffer.from(binary.data);
      canonicalAssetByPath.set(binary.path, {
        id: binary.id,
        path: binary.path,
        mimeType: binary.mimeType,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        source: binary.source,
        dataBase64: bytes.toString('base64'),
        createdAt: timestamp(binary.createdAt),
        updatedAt: timestamp(binary.updatedAt),
      });
    }
    const assets = [...canonicalAssetByPath.values()];
    const pageAssets = modernPages.flatMap((page) =>
      page.assets.flatMap((link) => {
        const asset = canonicalAssetByPath.get(link.asset.path);
        if (!asset) return [];
        return [
          {
            id: link.id,
            pageId: link.pageId,
            assetId: asset.id,
            role: link.role,
            order: link.order,
            meta: jsonRecord(link.metaJson),
            createdAt: timestamp(link.createdAt),
            updatedAt: timestamp(link.updatedAt),
          },
        ];
      }),
    );
    const archiveTimestamp = Date.now();
    const notebookAssets = [...assetNotebookIdsByPath].flatMap(
      ([assetPath, notebookIdsForAsset]) => {
        const asset = canonicalAssetByPath.get(assetPath);
        if (!asset) return [];
        return [...notebookIdsForAsset].map((notebookId) => ({
          id: `${notebookId}:${asset.id}`,
          notebookId,
          assetId: asset.id,
          createdAt: archiveTimestamp,
          updatedAt: archiveTimestamp,
        }));
      },
    );
    const missingAssetPaths = [...referencedAssetPaths].filter(
      (assetPath) => !canonicalAssetByPath.get(assetPath)?.dataBase64,
    );

    const archive = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: Date.now(),
      source: {
        kind: 'postgresql',
        appVersion: process.env.npm_package_version ?? 'unknown',
        ownerId: owner.id,
        ownerEmail: owner.email ?? undefined,
      },
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        description: course.description ?? '',
        language: course.language === 'en-US' ? 'en-US' : 'zh-CN',
        tags: course.tags,
        purpose: course.purpose,
        university: course.university,
        courseCode: course.courseCode,
        createdAt: timestamp(course.createdAt),
        updatedAt: timestamp(course.updatedAt),
      })),
      notebooks: notebooks.map((notebook) => ({
        id: notebook.id,
        courseId: notebook.courseId,
        name: notebook.name,
        description: notebook.description ?? '',
        kind: notebook.notebookKind === 'markdown' ? 'markdown' : 'image',
        tags: notebook.tags,
        sectionCount: notebook.sectionCount,
        createdAt: timestamp(notebook.createdAt),
        updatedAt: timestamp(notebook.updatedAt),
      })),
      notebookPages,
      markdownSections: markdownSections.map((section) => ({
        id: section.id,
        notebookId: section.notebookId,
        courseId: section.courseId,
        title: section.title,
        order: section.order,
        markdown: section.markdown,
        summary: section.summary,
        sourceMeta: jsonRecord(section.sourceMeta),
        createdAt: timestamp(section.createdAt),
        updatedAt: timestamp(section.updatedAt),
      })),
      problems: canonicalProblems,
      problemAttempts: attempts
        .filter((attempt) => canonicalProblemIds.has(attempt.problemId))
        .map((attempt) => ({
          id: attempt.id,
          problemId: attempt.problemId,
          kind: attempt.kind,
          answer: jsonRecord(attempt.answerJson),
          result: attempt.resultJson ? jsonRecord(attempt.resultJson) : null,
          score: attempt.score,
          status: attempt.status,
          createdAt: timestamp(attempt.createdAt),
          updatedAt: timestamp(attempt.updatedAt),
        })),
      problemProgress: progress
        .filter((item) => canonicalProblemIds.has(item.problemId))
        .map((item) => ({
          id: item.id,
          problemId: item.problemId,
          latestAttemptId: item.latestAttemptId,
          status: item.status,
          score: item.score,
          attemptedCount: item.attemptedCount,
          passedCount: item.passedCount,
          lastAttemptAt: item.lastAttemptAt ? timestamp(item.lastAttemptAt) : null,
          createdAt: timestamp(item.createdAt),
          updatedAt: timestamp(item.updatedAt),
        })),
      conversations: archivedConversations,
      messages: archivedMessages,
      studyMemories: studyMemories.map((memory) => ({
        id: memory.id,
        courseId: memory.courseId,
        notebookId: memory.notebookId,
        targetType: memory.targetType,
        scope: memory.scope,
        kind: memory.kind,
        status: memory.status,
        source: memory.source,
        title: memory.title,
        text: memory.text,
        reason: memory.reason,
        question: memory.question,
        sourceReferences: jsonArray(memory.sourceReferences),
        confidence: memory.confidence,
        createdAt: timestamp(memory.createdAt),
        updatedAt: timestamp(memory.updatedAt),
      })),
      assets,
      pageAssets,
      notebookAssets,
      missingAssetPaths,
    };

    const outputPath = path.resolve(option('output') ?? defaultOutputPath());
    await writeFile(outputPath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
    const counts = {
      courses: archive.courses.length,
      notebooks: archive.notebooks.length,
      notebookPages: archive.notebookPages.length,
      markdownSections: archive.markdownSections.length,
      problems: archive.problems.length,
      problemAttempts: archive.problemAttempts.length,
      conversations: archive.conversations.length,
      messages: archive.messages.length,
      studyMemories: archive.studyMemories.length,
      assets: archive.assets.length,
      pageAssets: archive.pageAssets.length,
      notebookAssets: archive.notebookAssets.length,
      missingAssets: archive.missingAssetPaths.length,
    };
    console.log(`已导出 ${owner.email ?? owner.id} 的本地迁移包：`);
    console.log(outputPath);
    console.log(JSON.stringify(counts, null, 2));
    console.log('迁移包不包含账号凭据、API Key、支付记录或题目私密判题配置。');
    if (archive.missingAssetPaths.length) {
      console.warn(
        `有 ${archive.missingAssetPaths.length} 个资源在数据库中没有二进制内容，导入后会显示缺失提示。`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
