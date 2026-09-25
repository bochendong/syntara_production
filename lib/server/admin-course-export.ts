import JSZip from 'jszip';
import { Readable } from 'node:stream';
import type { PrismaClient } from '@prisma/client';

type Database = PrismaClient;

function safeSegment(value: string) {
  return (
    value
      .normalize('NFKC')
      .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
      .trim()
      .slice(0, 90) || 'untitled'
  );
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lazyBytes(read: () => Promise<Uint8Array | null>) {
  return Readable.from(
    (async function* () {
      const bytes = await read();
      if (bytes) yield Buffer.from(bytes);
    })(),
  );
}

function lazyText(read: () => Promise<string | null>) {
  return Readable.from(
    (async function* () {
      const value = await read();
      if (value) yield Buffer.from(value, 'utf8');
    })(),
  );
}

function sourceFolder(category: string | null, kind: string) {
  return category === 'problem_bank' || kind === 'problem_bank'
    ? '02-original-problem-bank'
    : '01-original-materials';
}

function collectGeneratedImagePaths(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\/generated-notebooks\/[^\s"'<>)]*/g)) {
      try {
        const path = decodeURIComponent(new URL(match[0], 'https://archive.invalid').pathname);
        if (path.startsWith('/generated-notebooks/') && !path.split('/').includes('..')) {
          paths.add(path);
        }
      } catch {
        // Keep the original text intact; an invalid URL is reported only in its source JSON.
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectGeneratedImagePaths(entry, paths);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectGeneratedImagePaths(entry, paths);
  }
}

export async function buildAdminCourseArchive(db: Database, courseIds: string[]) {
  const zip = new JSZip();
  const courses = await db.course.findMany({
    where: { id: { in: courseIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      language: true,
      courseCode: true,
      university: true,
      academicYear: true,
      academicTerm: true,
      tags: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const manifest: {
    courseCount: number;
    courses: {
      id: string;
      name: string;
      sources: number;
      notebooks: number;
      problems: number;
      unavailableOriginalFiles: string[];
      unavailableGeneratedImages: string[];
    }[];
  } = {
    courseCount: courses.length,
    courses: [],
  };

  for (const course of courses) {
    const root = `${safeSegment(course.name)}_${course.id}`;
    const generatedImagePaths = new Set<string>();
    zip.file(`${root}/course.json`, json(course));
    const sources = await db.courseSource.findMany({
      where: { courseId: course.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        kind: true,
        sourceCategory: true,
        sourceHash: true,
        fileMime: true,
        fileSize: true,
        storageKey: true,
        openaiFileId: true,
        extractedTextHash: true,
        metadataJson: true,
        removedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { documents: true } },
      },
    });
    const unavailableOriginalFiles: string[] = [];
    for (const source of sources) {
      const folder = `${root}/${sourceFolder(source.sourceCategory, source.kind)}/${safeSegment(source.title)}_${source.id}`;
      zip.file(`${folder}/source.json`, json(source));
      // Read large payloads only as JSZip emits each member, instead of loading every file at once.
      const raw = await db.courseSource.findUnique({
        where: { id: source.id },
        select: { fileData: true, extractedText: true },
      });
      if (raw?.fileData?.length) {
        const extension = source.title.includes('.')
          ? ''
          : source.fileMime === 'application/pdf'
            ? '.pdf'
            : '';
        zip.file(
          `${folder}/original/${safeSegment(source.title)}${extension}`,
          lazyBytes(
            async () =>
              (
                await db.courseSource.findUnique({
                  where: { id: source.id },
                  select: { fileData: true },
                })
              )?.fileData ?? null,
          ),
          { binary: true },
        );
      } else if (source.fileSize > 0 || source.storageKey || source.openaiFileId) {
        unavailableOriginalFiles.push(source.id);
      }
      if (raw?.extractedText) {
        zip.file(
          `${folder}/extracted-text.txt`,
          lazyText(
            async () =>
              (
                await db.courseSource.findUnique({
                  where: { id: source.id },
                  select: { extractedText: true },
                })
              )?.extractedText ?? null,
          ),
        );
      }
    }

    const notebooks = await db.notebook.findMany({
      where: { courseId: course.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        notebookKind: true,
        tags: true,
        language: true,
        style: true,
        coverSlideJson: true,
        coverImagePath: true,
        removedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    for (const notebook of notebooks) {
      collectGeneratedImagePaths(notebook, generatedImagePaths);
      const folder = `${root}/03-organized-notebooks/${safeSegment(notebook.name)}_${notebook.id}`;
      zip.file(`${folder}/notebook.json`, json(notebook));
      const sections = await db.markdownNotebookSection.findMany({
        where: { notebookId: notebook.id },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      for (const section of sections) {
        collectGeneratedImagePaths(section.markdown, generatedImagePaths);
        const stem = `${String(section.order + 1).padStart(3, '0')}_${safeSegment(section.title)}_${section.id}`;
        zip.file(`${folder}/markdown/${stem}.md`, section.markdown);
        zip.file(`${folder}/markdown/${stem}.json`, json({ ...section, markdown: undefined }));
      }
      const scenes = await db.scene.findMany({
        where: { notebookId: notebook.id },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      for (const scene of scenes) {
        collectGeneratedImagePaths(scene, generatedImagePaths);
        zip.file(
          `${folder}/scenes/${String(scene.order + 1).padStart(3, '0')}_${scene.id}.json`,
          json(scene),
        );
      }
      const pages = await db.notebookPage.findMany({
        where: { notebookId: notebook.id },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: {
          content: true,
          actions: true,
          assets: {
            include: {
              asset: {
                select: { id: true, path: true, mimeType: true, sizeBytes: true, sha256: true },
              },
            },
          },
        },
      });
      for (const page of pages) {
        collectGeneratedImagePaths(page, generatedImagePaths);
        const stem = `${String(page.order + 1).padStart(3, '0')}_${safeSegment(page.title)}_${page.id}`;
        zip.file(`${folder}/pages/${stem}.json`, json(page));
        for (const link of page.assets) {
          if (!link.asset.sizeBytes) continue;
          zip.file(
            `${folder}/assets/${link.asset.id}_${safeSegment(link.asset.path.split('/').pop() || 'image')}`,
            lazyBytes(
              async () =>
                (
                  await db.asset.findUnique({
                    where: { id: link.asset.id },
                    select: { data: true },
                  })
                )?.data ?? null,
            ),
            { binary: true },
          );
        }
      }
    }

    const chapters = await db.courseProblemChapter.findMany({
      where: { courseId: course.id },
      orderBy: { position: 'asc' },
    });
    const tags = await db.courseProblemTagNode.findMany({
      where: { courseId: course.id },
      orderBy: [{ level: 'asc' }, { position: 'asc' }],
    });
    zip.file(`${root}/04-organized-problem-bank/chapters.json`, json(chapters));
    zip.file(`${root}/04-organized-problem-bank/tags.json`, json(tags));
    const problems = await db.notebookProblem.findMany({
      where: { OR: [{ courseId: course.id }, { notebook: { courseId: course.id } }] },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { secret: true, tagAssignments: true },
    });
    for (const problem of problems) {
      collectGeneratedImagePaths(problem.publicContentJson, generatedImagePaths);
      zip.file(
        `${root}/04-organized-problem-bank/problems/${String(problem.order + 1).padStart(4, '0')}_${safeSegment(problem.title)}_${problem.id}.json`,
        json(problem),
      );
    }
    const imports = await db.problemImportBatch.findMany({
      where: { OR: [{ courseId: course.id }, { notebook: { courseId: course.id } }] },
      orderBy: { createdAt: 'asc' },
    });
    for (const item of imports) {
      zip.file(`${root}/02-original-problem-bank/import-records/${item.id}.json`, json(item));
    }
    const unavailableGeneratedImages: string[] = [];
    for (const path of generatedImagePaths) {
      const found = await db.notebookImageAsset
        .findUnique({ where: { path }, select: { path: true } })
        .catch(() => null);
      if (!found) {
        unavailableGeneratedImages.push(path);
        continue;
      }
      zip.file(
        `${root}/media${path}`,
        lazyBytes(
          async () =>
            (
              await db.notebookImageAsset.findUnique({
                where: { path },
                select: { data: true },
              })
            )?.data ?? null,
        ),
        { binary: true },
      );
    }
    const rules = await db.courseHardRule.findMany({
      where: { courseId: course.id },
      orderBy: { position: 'asc' },
    });
    zip.file(`${root}/course-rules.json`, json(rules));
    manifest.courses.push({
      id: course.id,
      name: course.name,
      sources: sources.length,
      notebooks: notebooks.length,
      problems: problems.length,
      unavailableOriginalFiles,
      unavailableGeneratedImages,
    });
  }
  zip.file('manifest.json', json(manifest));
  zip.file(
    'README.txt',
    '课程资料导出。每门课程包含原始上传资料、提取文本、原始题库导入记录、整理后的笔记本与题库。页面引用的图片存于 media/generated-notebooks，关联附件存于笔记本 assets 目录。manifest.json 列出数据库没有保存原文件或生成图片的来源。此导出不会修改原数据。\n',
  );
  return zip;
}

export function archiveResponse(zip: JSZip, name: string) {
  const stream = zip.generateNodeStream({
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 3 },
  });
  return new Response(Readable.toWeb(stream as unknown as Readable) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeSegment(name)}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
