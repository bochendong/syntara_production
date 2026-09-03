import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import { normalizeProblemConceptTags } from '@/lib/problem-bank/concept-tags.mjs';
import type { NotebookProblemTagAssignment, NotebookProblemTagPath } from '@/lib/problem-bank';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';

export const PROBLEM_TAG_AUTO_APPLY_CONFIDENCE = 0.7;
const LEGACY_AREA = '待整理';

type Db = PrismaClient | Prisma.TransactionClient;

function cleanName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizedName(value: string): string {
  return cleanName(value).toLocaleLowerCase('zh-CN');
}

function uniquePaths(paths: NotebookProblemTagPath[]): NotebookProblemTagPath[] {
  const seen = new Set<string>();
  return paths
    .map((path) => ({ area: cleanName(path.area), concept: cleanName(path.concept) }))
    .filter((path) => path.area && path.concept && path.area !== path.concept)
    .filter((path) => {
      const key = `${normalizedName(path.area)}\0${normalizedName(path.concept)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export async function requireProblemTagCourseAccess(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  ownerOnly = false,
) {
  const role = await findCourseAccessRole(prisma, userId, courseId);
  if (!role || (ownerOnly && role !== 'owner')) return null;
  return role;
}

export async function listCourseProblemTagTree(prisma: PrismaClient, courseId: string) {
  const nodes = await prisma.courseProblemTagNode.findMany({
    where: { courseId, status: { not: 'merged' } },
    orderBy: [{ level: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { assignments: { where: { status: 'applied' } } } },
    },
  });
  const areas = nodes.filter((node) => node.level === 0);
  const concepts = nodes.filter((node) => node.level === 1);
  return areas.map((area) => ({
    id: area.id,
    name: area.name,
    aliases: area.aliases,
    source: area.source,
    status: area.status,
    confidence: area.confidence,
    lockedByTeacher: area.lockedByTeacher,
    problemCount: concepts
      .filter((concept) => concept.parentId === area.id)
      .reduce((count, concept) => count + concept._count.assignments, 0),
    concepts: concepts
      .filter((concept) => concept.parentId === area.id)
      .map((concept) => ({
        id: concept.id,
        name: concept.name,
        aliases: concept.aliases,
        source: concept.source,
        status: concept.status,
        confidence: concept.confidence,
        lockedByTeacher: concept.lockedByTeacher,
        problemCount: concept._count.assignments,
      })),
  }));
}

export async function getProblemTagAssignments(
  prisma: PrismaClient,
  courseId: string,
  problemIds: string[],
): Promise<Map<string, NotebookProblemTagAssignment[]>> {
  const result = new Map<string, NotebookProblemTagAssignment[]>();
  if (problemIds.length === 0) return result;
  const rows = await prisma.notebookProblemTagAssignment.findMany({
    where: {
      problemId: { in: Array.from(new Set(problemIds)).slice(0, 500) },
      tag: { courseId },
    },
    include: { tag: { include: { parent: true } } },
    orderBy: [{ status: 'asc' }, { tag: { position: 'asc' } }],
  });
  for (const row of rows) {
    if (!row.tag.parent || row.tag.level !== 1) continue;
    const item: NotebookProblemTagAssignment = {
      id: row.tag.id,
      areaId: row.tag.parent.id,
      area: row.tag.parent.name,
      concept: row.tag.name,
      source: row.source,
      status: row.status === 'pending' ? 'pending' : 'applied',
      confidence: row.confidence,
      lockedByTeacher: row.tag.lockedByTeacher,
    };
    result.set(row.problemId, [...(result.get(row.problemId) || []), item]);
  }
  return result;
}

async function upsertTagPath(
  tx: Db,
  args: {
    courseId: string;
    path: NotebookProblemTagPath;
    source: string;
    confidence?: number | null;
    status?: 'active' | 'pending';
  },
) {
  const areaName = cleanName(args.path.area);
  const conceptName = cleanName(args.path.concept);
  const area = await tx.courseProblemTagNode.upsert({
    where: {
      courseId_level_normalizedName: {
        courseId: args.courseId,
        level: 0,
        normalizedName: normalizedName(areaName),
      },
    },
    create: {
      courseId: args.courseId,
      parentId: null,
      name: areaName,
      normalizedName: normalizedName(areaName),
      level: 0,
      aliases: [],
      source: args.source,
      status: args.status || 'active',
      confidence: args.confidence ?? null,
    },
    update: args.status === 'active' ? { status: 'active' } : {},
  });
  const concept = await tx.courseProblemTagNode.upsert({
    where: {
      courseId_level_normalizedName: {
        courseId: args.courseId,
        level: 1,
        normalizedName: normalizedName(conceptName),
      },
    },
    create: {
      courseId: args.courseId,
      parentId: area.id,
      name: conceptName,
      normalizedName: normalizedName(conceptName),
      level: 1,
      aliases: [],
      source: args.source,
      status: args.status || 'active',
      confidence: args.confidence ?? null,
    },
    update: args.status === 'active' ? { status: 'active' } : {},
  });
  return { area, concept };
}

export async function syncProblemTagPaths(args: {
  prisma: PrismaClient;
  courseId: string;
  problemId: string;
  paths: NotebookProblemTagPath[];
  source: 'ai' | 'manual' | 'legacy';
  confidence?: number | null;
}) {
  const paths = uniquePaths(args.paths);
  return args.prisma.$transaction(async (tx) => {
    const problem = await tx.notebookProblem.findFirst({
      where: {
        id: args.problemId,
        OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
      },
      select: { id: true, tags: true },
    });
    if (!problem) throw new Error('Problem is not part of this course.');

    const preservedManual = await tx.notebookProblemTagAssignment.findMany({
      where: { problemId: args.problemId, source: 'manual', status: 'applied' },
      include: { tag: true },
    });
    if (args.source === 'manual') {
      await tx.notebookProblemTagAssignment.deleteMany({ where: { problemId: args.problemId } });
    } else {
      await tx.notebookProblemTagAssignment.deleteMany({
        where: { problemId: args.problemId, source: { not: 'manual' } },
      });
    }

    const appliedNames = new Set(preservedManual.map((row) => row.tag.name));
    const assignments = [];
    for (const path of paths) {
      const confidence = args.confidence ?? null;
      const applied =
        args.source !== 'ai' || (confidence ?? 1) >= PROBLEM_TAG_AUTO_APPLY_CONFIDENCE;
      const { concept } = await upsertTagPath(tx, {
        courseId: args.courseId,
        path,
        source: args.source,
        confidence,
        status: applied ? 'active' : 'pending',
      });
      const assignment = await tx.notebookProblemTagAssignment.upsert({
        where: { problemId_tagId: { problemId: args.problemId, tagId: concept.id } },
        create: {
          problemId: args.problemId,
          tagId: concept.id,
          source: args.source,
          status: applied ? 'applied' : 'pending',
          confidence,
        },
        update: {
          source: args.source,
          status: applied ? 'applied' : 'pending',
          confidence,
        },
      });
      if (applied) appliedNames.add(concept.name);
      assignments.push(assignment);
    }
    await tx.notebookProblem.update({
      where: { id: args.problemId },
      data: { tags: Array.from(appliedNames).slice(0, 16) },
    });
    return assignments;
  });
}

export async function seedProblemTagsFromProblem(args: {
  prisma: PrismaClient;
  courseId: string;
  problem: {
    id: string;
    title: string;
    type: string;
    difficulty: string;
    tags: string[];
    publicContent: unknown;
    sourceMeta?: unknown;
    notebookId?: string | null;
    notebookName?: string | null;
    tagPaths?: NotebookProblemTagPath[];
  };
}) {
  const suppliedPaths = uniquePaths(args.problem.tagPaths || []);
  const concepts = normalizeProblemConceptTags({
    courseId: args.courseId,
    notebookId: args.problem.notebookId,
    notebookName: args.problem.notebookName,
    title: args.problem.title,
    type: args.problem.type,
    difficulty: args.problem.difficulty,
    tags: args.problem.tags,
    publicContent: args.problem.publicContent,
    sourceMeta: args.problem.sourceMeta || {},
  });
  const paths = suppliedPaths.length
    ? suppliedPaths
    : concepts.map((concept: string) => ({ area: LEGACY_AREA, concept }));
  if (paths.length === 0) return [];
  return syncProblemTagPaths({
    prisma: args.prisma,
    courseId: args.courseId,
    problemId: args.problem.id,
    paths,
    source: suppliedPaths.length ? 'ai' : 'legacy',
    confidence: suppliedPaths.length ? 0.85 : null,
  });
}

async function refreshProblemTagProjection(tx: Db, problemIds: string[]) {
  for (const problemId of Array.from(new Set(problemIds))) {
    const rows = await tx.notebookProblemTagAssignment.findMany({
      where: { problemId, status: 'applied' },
      include: { tag: true },
      orderBy: { tag: { position: 'asc' } },
    });
    await tx.notebookProblem.update({
      where: { id: problemId },
      data: { tags: rows.map((row) => row.tag.name).slice(0, 16) },
    });
  }
}

export async function updateProblemTagNode(args: {
  prisma: PrismaClient;
  courseId: string;
  tagId: string;
  name?: string;
  parentId?: string;
  aliases?: string[];
  confirmAssignments?: boolean;
}) {
  return args.prisma.$transaction(async (tx) => {
    const node = await tx.courseProblemTagNode.findFirst({
      where: { id: args.tagId, courseId: args.courseId },
      include: { assignments: { select: { problemId: true } } },
    });
    if (!node) throw new Error('标签不存在。');
    if (args.parentId && node.level !== 1) throw new Error('只有知识点可以移动。');
    if (args.parentId) {
      const parent = await tx.courseProblemTagNode.findFirst({
        where: { id: args.parentId, courseId: args.courseId, level: 0 },
        select: { id: true },
      });
      if (!parent) throw new Error('目标知识领域不存在。');
    }
    const name = args.name ? cleanName(args.name) : node.name;
    const updated = await tx.courseProblemTagNode.update({
      where: { id: node.id },
      data: {
        name,
        normalizedName: normalizedName(name),
        ...(args.parentId ? { parentId: args.parentId } : {}),
        ...(args.aliases
          ? {
              aliases: Array.from(new Set(args.aliases.map(cleanName).filter(Boolean))).slice(
                0,
                20,
              ),
            }
          : {}),
        source: 'manual',
        status: 'active',
        lockedByTeacher: true,
      },
    });
    if (args.confirmAssignments && node.level === 1) {
      await tx.notebookProblemTagAssignment.updateMany({
        where: { tagId: node.id, status: 'pending' },
        data: { status: 'applied', source: 'manual' },
      });
    }
    await refreshProblemTagProjection(
      tx,
      node.assignments.map((item) => item.problemId),
    );
    return updated;
  });
}

export async function mergeProblemTagNodes(args: {
  prisma: PrismaClient;
  courseId: string;
  sourceId: string;
  targetId: string;
}) {
  if (args.sourceId === args.targetId) throw new Error('不能合并同一个标签。');
  return args.prisma.$transaction(async (tx) => {
    const nodes = await tx.courseProblemTagNode.findMany({
      where: { id: { in: [args.sourceId, args.targetId] }, courseId: args.courseId },
      include: { assignments: { select: { problemId: true } } },
    });
    const source = nodes.find((node) => node.id === args.sourceId);
    const target = nodes.find((node) => node.id === args.targetId);
    if (!source || !target || source.level !== target.level) throw new Error('标签无法合并。');
    const affected = source.assignments.map((item) => item.problemId);
    if (source.level === 0) {
      await tx.courseProblemTagNode.updateMany({
        where: { parentId: source.id },
        data: { parentId: target.id, source: 'manual', lockedByTeacher: true },
      });
    } else {
      for (const problemId of affected) {
        await tx.notebookProblemTagAssignment.upsert({
          where: { problemId_tagId: { problemId, tagId: target.id } },
          create: { problemId, tagId: target.id, source: 'manual', status: 'applied' },
          update: { source: 'manual', status: 'applied' },
        });
      }
      await tx.notebookProblemTagAssignment.deleteMany({ where: { tagId: source.id } });
    }
    await tx.courseProblemTagNode.update({
      where: { id: target.id },
      data: {
        aliases: Array.from(new Set([...target.aliases, source.name, ...source.aliases])).slice(
          0,
          20,
        ),
        source: 'manual',
        lockedByTeacher: true,
      },
    });
    await tx.courseProblemTagNode.delete({ where: { id: source.id } });
    await refreshProblemTagProjection(tx, affected);
    return target;
  });
}
