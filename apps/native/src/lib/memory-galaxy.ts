import type { LocalNotebook, LocalStudyMemory } from '../domain/models';
import { memoryMarble, type MarbleColor } from './learning-action-marbles';
import { memoryFreshness, type ReviewedMap } from './memory-freshness';

/**
 * 记忆星图（像 Obsidian 的关系图）：中间一颗大玻璃球是课程，外圈中号玻璃球是章节笔记，
 * 每条记忆是一颗小玻璃珠，绕着它所属的章节转。连线全部自动生成，不用手动连：
 * 珠子连到自己的章节；引用了同一份资料的珠子之间也连上。
 * 这里只管数据和排布（力导向），3D 和平面版共用。
 */

export type GalaxyNodeKind = 'core' | 'chapter' | 'memory';

export type GalaxyNode = {
  id: string;
  kind: GalaxyNodeKind;
  label: string;
  /** 记忆珠的颜色；章节球取它下面最多的那种颜色，没有记忆的章节是 null。 */
  color: MarbleColor | null;
  /** 0 = 很久没复习（雾蒙蒙），1 = 刚存或刚复习过。章节和课程恒为 1。 */
  freshness: number;
  /** 记忆珠绕着转的那颗球（章节或课程）。 */
  parent: string | null;
  /** 章节下面有几颗记忆。 */
  count: number;
  /** 珠子的稀有度，和头像一样分 R / SR / SSR / EX：记忆珠落地时随机抽；课程是 SSR，章节是 R。 */
  tier: MarbleRarity;
  createdAt: number;
};

export type GalaxyLink = {
  source: string;
  target: string;
  /** tree：章节连课程、珠子连章节；related：引用同一份资料的两颗珠子（或珠子和别的章节）。 */
  kind: 'tree' | 'related';
};

/** 没画成珠子的记忆：在所属章节（或课程）周围画成一粒淡淡的星尘。 */
export type GalaxyDust = { parent: string; color: MarbleColor; seed: number };

export type MemoryGalaxy = {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
  dust?: GalaxyDust[];
  /** Artwork matching this course's avatar, shared by live, flat and snapshot renderers. */
  backgroundUrl?: string;
};

export type GalaxyInput = {
  courseId: string;
  courseLabel: string;
  backgroundUrl?: string;
  notebooks: Pick<LocalNotebook, 'id' | 'name' | 'createdAt'>[];
  memories: LocalStudyMemory[];
  /** 最多画几颗珠子，默认 GALAXY_MARBLE_LIMIT；其余最近没更新的画成星尘。 */
  maxMarbles?: number;
  /** 点开的章节：这一章的记忆全部画成珠子，不受上限影响。 */
  expandNotebookId?: string | null;
  /** 一定要画成珠子的记忆（正在看的那颗）。 */
  keepMemoryIds?: (string | null | undefined)[];
};

/** 一次最多画 100 颗珠子：再多就挤成一团，看不清。 */
export const GALAXY_MARBLE_LIMIT = 100;

/** 笔记不多时，没有记忆的章节也画出来（淡一点），能看出整门课的样子。 */
const SHOW_EMPTY_CHAPTERS_UP_TO = 16;
const MAX_RELATED_PER_MEMORY = 4;

export const coreNodeId = (courseId: string) => `course:${courseId}`;
const chapterNodeId = (notebookId: string) => `notebook:${notebookId}`;

/** 「07 · 整除、gcd 与欧几里得算法」只留「整除、gcd 与欧几里得算法」，标签短一点。 */
export function shortChapterLabel(name: string): string {
  const trimmed = name.replace(/^\s*\d+\s*[·.、_\-:：]\s*/, '').trim();
  return trimmed || name;
}

function references(memory: LocalStudyMemory): string[] {
  return (memory.sourceReferences ?? []).filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
}

export function buildMemoryGalaxy(
  input: GalaxyInput,
  reviewed: ReviewedMap,
  now = Date.now(),
): MemoryGalaxy {
  const core = coreNodeId(input.courseId);
  const nodes: GalaxyNode[] = [
    {
      id: core,
      kind: 'core',
      label: input.courseLabel,
      color: null,
      freshness: 1,
      parent: null,
      count: input.memories.length,
      tier: 'SSR',
      createdAt: 0,
    },
  ];
  const links: GalaxyLink[] = [];

  const notebookIds = new Set(input.notebooks.map((notebook) => notebook.id));
  const byNotebook = new Map<string, LocalStudyMemory[]>();
  for (const memory of input.memories) {
    if (!memory.notebookId || !notebookIds.has(memory.notebookId)) continue;
    const list = byNotebook.get(memory.notebookId) ?? [];
    list.push(memory);
    byNotebook.set(memory.notebookId, list);
  }

  const showEmpty = input.notebooks.length <= SHOW_EMPTY_CHAPTERS_UP_TO;
  const chapters = [...input.notebooks]
    .filter((notebook) => showEmpty || byNotebook.has(notebook.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
  for (const notebook of chapters) {
    const own = byNotebook.get(notebook.id) ?? [];
    const tally = new Map<MarbleColor, number>();
    own.forEach((memory) => {
      const color = memoryMarble(memory.kind).color;
      tally.set(color, (tally.get(color) ?? 0) + 1);
    });
    const dominant = [...tally.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    const id = chapterNodeId(notebook.id);
    nodes.push({
      id,
      kind: 'chapter',
      label: shortChapterLabel(notebook.name),
      color: dominant ?? null,
      freshness: 1,
      parent: core,
      count: own.length,
      tier: 'R',
      createdAt: notebook.createdAt,
    });
    links.push({ source: core, target: id, kind: 'tree' });
  }

  const chapterIds = new Set(chapters.map((notebook) => chapterNodeId(notebook.id)));
  // 资料 → 用到它的章节：课程级的记忆（没有 notebookId）靠它连到对应章节。
  const referenceChapters = new Map<string, Set<string>>();
  for (const memory of input.memories) {
    if (!memory.notebookId || !chapterIds.has(chapterNodeId(memory.notebookId))) continue;
    for (const reference of references(memory)) {
      const set = referenceChapters.get(reference) ?? new Set<string>();
      set.add(chapterNodeId(memory.notebookId));
      referenceChapters.set(reference, set);
    }
  }

  const { drawn, dusty } = splitMarbles(input);
  const memories = drawn.sort((left, right) => left.createdAt - right.createdAt);
  const parentOf = new Map<string, string>();
  for (const memory of memories) {
    const chapter = memory.notebookId ? chapterNodeId(memory.notebookId) : null;
    const parent = chapter && chapterIds.has(chapter) ? chapter : core;
    parentOf.set(memory.id, parent);
    nodes.push({
      id: memory.id,
      kind: 'memory',
      label: memory.title,
      color: memoryMarble(memory.kind).color,
      freshness: memoryFreshness(memory, reviewed, now),
      parent,
      count: 0,
      tier: memoryRarity(memory.id),
      createdAt: memory.createdAt,
    });
    links.push({ source: parent, target: memory.id, kind: 'tree' });
  }

  // 同一份资料、同一个问题的珠子连起来；同一章里的本来就挨着，不再连。
  const related = new Map<string, Set<string>>();
  const relate = (a: string, b: string) => {
    if (a === b) return;
    const setA = related.get(a) ?? new Set<string>();
    const setB = related.get(b) ?? new Set<string>();
    if (setA.has(b) || setA.size >= MAX_RELATED_PER_MEMORY) return;
    if (!b.startsWith('notebook:') && setB.size >= MAX_RELATED_PER_MEMORY) return;
    setA.add(b);
    setB.add(a);
    related.set(a, setA);
    related.set(b, setB);
    links.push({ source: a, target: b, kind: 'related' });
  };
  const byKey = new Map<string, string[]>();
  for (const memory of memories) {
    const keys = references(memory).map((reference) => `ref:${reference}`);
    if (memory.question?.trim()) keys.push(`q:${memory.question.trim()}`);
    for (const key of keys) {
      const list = byKey.get(key) ?? [];
      list.push(memory.id);
      byKey.set(key, list);
    }
    if (parentOf.get(memory.id) === core) {
      for (const reference of references(memory)) {
        referenceChapters.get(reference)?.forEach((chapter) => relate(memory.id, chapter));
      }
    }
  }
  byKey.forEach((ids) => {
    for (let index = 1; index < ids.length; index += 1) {
      const previous = ids[index - 1];
      const current = ids[index];
      if (parentOf.get(previous) !== parentOf.get(current)) relate(previous, current);
    }
  });

  const dust = dusty.map((memory): GalaxyDust => {
    const chapter = memory.notebookId ? chapterNodeId(memory.notebookId) : null;
    return {
      parent: chapter && chapterIds.has(chapter) ? chapter : core,
      color: memoryMarble(memory.kind).color,
      seed: seeded(memory.id, 3),
    };
  });
  const galaxy: MemoryGalaxy = dust.length ? { nodes, links, dust } : { nodes, links };
  if (input.backgroundUrl) galaxy.backgroundUrl = input.backgroundUrl;
  return galaxy;
}

/** 记忆太多时只把最近更新的画成珠子；点开的章节和正在看的那颗总是画出来。 */
function splitMarbles(input: GalaxyInput) {
  const limit = input.maxMarbles ?? GALAXY_MARBLE_LIMIT;
  if (input.memories.length <= limit) return { drawn: [...input.memories], dusty: [] };
  const keep = new Set(input.keepMemoryIds?.filter(Boolean));
  const pinned = (memory: LocalStudyMemory) =>
    keep.has(memory.id) ||
    (Boolean(input.expandNotebookId) && memory.notebookId === input.expandNotebookId);
  const byRecent = [...input.memories].sort((left, right) => right.updatedAt - left.updatedAt);
  const drawn = byRecent.filter(pinned);
  const dusty: LocalStudyMemory[] = [];
  for (const memory of byRecent) {
    if (pinned(memory)) continue;
    if (drawn.length < limit) drawn.push(memory);
    else dusty.push(memory);
  }
  return { drawn, dusty };
}

/** 和某颗球直接相连的所有球（自己也算）。点亮它们，其余的变暗。 */
export type MarbleRarity = 'R' | 'SR' | 'SSR' | 'EX';

/**
 * 像抽卡：每颗记忆珠由自己的 id 决定稀有度，大约 R 75%、SR 18%、SSR 6%、EX 1%。
 * 只看 id，所以同一条记忆在手机和桌面上抽到的一样，也不会每次打开都变。
 */
export function memoryRarity(id: string): MarbleRarity {
  const roll = seeded(id, 9);
  if (roll < 0.01) return 'EX';
  if (roll < 0.07) return 'SSR';
  if (roll < 0.25) return 'SR';
  return 'R';
}

export function galaxyNeighbors(galaxy: MemoryGalaxy, id: string | null): Set<string> | null {
  if (!id) return null;
  const set = new Set([id]);
  for (const link of galaxy.links) {
    if (link.source === id) set.add(link.target);
    if (link.target === id) set.add(link.source);
  }
  // 点章节：它下面的珠子全亮。
  const node = galaxy.nodes.find((item) => item.id === id);
  if (node?.kind === 'chapter') {
    galaxy.nodes.forEach((item) => {
      if (item.parent === id) set.add(item.id);
    });
  }
  return set;
}

// ---- 排布：简单的力导向，章节绕课程一圈，珠子绕自己的章节慢慢转 ----

export type LayoutPoint = { x: number; y: number; vx: number; vy: number; pinned: boolean };

export const GALAXY_RADIUS: Record<GalaxyNodeKind, number> = {
  core: 0.62,
  chapter: 0.34,
  memory: 0.24,
};

function seeded(id: string, salt = 0): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export class GalaxyLayout {
  readonly points = new Map<string, LayoutPoint>();
  private nodes: GalaxyNode[] = [];
  private byId = new Map<string, GalaxyNode>();
  private links: GalaxyLink[] = [];
  private chapterRing = 2.2;
  /** 珠子绕章节转的速度（0 = 不转）。 */
  orbit = 1;

  setGalaxy(galaxy: MemoryGalaxy) {
    this.nodes = galaxy.nodes;
    this.links = galaxy.links;
    this.byId = new Map(galaxy.nodes.map((node) => [node.id, node]));
    const chapters = galaxy.nodes.filter((node) => node.kind === 'chapter');
    // 章节越多，圈越大，珠子才放得下。
    this.chapterRing = Math.max(1.9, 1.1 + chapters.length * 0.27);
    const keep = new Set(galaxy.nodes.map((node) => node.id));
    [...this.points.keys()].forEach((id) => {
      if (!keep.has(id)) this.points.delete(id);
    });
    chapters.forEach((node, index) => {
      if (this.points.has(node.id)) return;
      const angle = (index / Math.max(1, chapters.length)) * Math.PI * 2 - Math.PI / 2;
      this.points.set(node.id, {
        x: Math.cos(angle) * this.chapterRing,
        y: Math.sin(angle) * this.chapterRing,
        vx: 0,
        vy: 0,
        pinned: false,
      });
    });
    for (const node of galaxy.nodes) {
      if (this.points.has(node.id)) continue;
      if (node.kind === 'core') {
        this.points.set(node.id, { x: 0, y: 0, vx: 0, vy: 0, pinned: false });
        continue;
      }
      const parent = (node.parent && this.points.get(node.parent)) || { x: 0, y: 0 };
      const angle = seeded(node.id) * Math.PI * 2;
      const distance = this.restLength(node) * (0.8 + seeded(node.id, 1) * 0.4);
      this.points.set(node.id, {
        x: parent.x + Math.cos(angle) * distance,
        y: parent.y + Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        pinned: false,
      });
    }
  }

  /** 新珠子从课程球里蹦出来，再飞到自己的章节旁边。 */
  spawnAtCore(id: string) {
    const point = this.points.get(id);
    const core = this.nodes.find((node) => node.kind === 'core');
    const origin = core ? this.points.get(core.id) : null;
    if (!point || !origin) return;
    point.x = origin.x;
    point.y = origin.y;
    const angle = seeded(id, 3) * Math.PI * 2;
    point.vx = Math.cos(angle) * 3;
    point.vy = Math.sin(angle) * 3;
  }

  /** 雾越重，离章节越远（被慢慢“遗忘”到外圈）。 */
  private restLength(node: GalaxyNode): number {
    if (node.kind === 'chapter') return this.chapterRing;
    const parent = node.parent ? this.byId.get(node.parent) : null;
    const fog = 1 - node.freshness;
    if (parent?.kind === 'core') return 1.2 + fog * 0.5;
    return 0.72 + fog * 0.35;
  }

  /** 先在后台跑一段，打开时已经排好，不会一团乱飞。 */
  settle(steps = 260) {
    const orbit = this.orbit;
    this.orbit = 0;
    for (let index = 0; index < steps; index += 1) this.step(1 / 60);
    this.orbit = orbit;
    this.points.forEach((point) => {
      point.vx = 0;
      point.vy = 0;
    });
  }

  /** 走一步；返回整体还动得多厉害（用来判断能不能停下动画）。 */
  step(dt: number): number {
    const nodes = this.nodes;
    const points = nodes.map((node) => this.points.get(node.id));
    const ax = new Float32Array(nodes.length);
    const ay = new Float32Array(nodes.length);
    const index = new Map(nodes.map((node, position) => [node.id, position]));

    // 互相排斥：球越大推得越远。
    for (let i = 0; i < nodes.length; i += 1) {
      const a = points[i];
      if (!a) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = points[j];
        if (!b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 1e-6) {
          dx = (seeded(nodes[j].id) - 0.5) * 0.01;
          dy = (seeded(nodes[i].id) - 0.5) * 0.01;
          distanceSq = dx * dx + dy * dy + 1e-6;
        }
        const reach = GALAXY_RADIUS[nodes[i].kind] + GALAXY_RADIUS[nodes[j].kind];
        if (distanceSq > 16) continue;
        const distance = Math.sqrt(distanceSq);
        const strength = (0.035 * (reach + 0.18)) / distanceSq;
        // 真的挨在一起时，再用力分开，珠子不会叠在一起。
        const overlap = Math.max(0, reach + 0.05 - distance) * 18;
        const force = Math.min(6, strength + overlap);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        ax[i] -= fx;
        ay[i] -= fy;
        ax[j] += fx;
        ay[j] += fy;
      }
    }

    // 连线是弹簧。
    for (const link of this.links) {
      const i = index.get(link.source);
      const j = index.get(link.target);
      if (i === undefined || j === undefined) continue;
      const a = points[i];
      const b = points[j];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const rest =
        link.kind === 'related'
          ? Math.max(1.1, distance * 0.92)
          : this.restLength(nodes[nodes[j].kind === 'core' ? i : j]);
      const stiffness = link.kind === 'related' ? 0.25 : nodes[j].kind === 'chapter' ? 2.2 : 4;
      const stretch = (distance - rest) * stiffness;
      const fx = (dx / distance) * stretch;
      const fy = (dy / distance) * stretch;
      // 课程球不动；章节被珠子拉得少一点。
      const weightA = nodes[i].kind === 'core' ? 0 : nodes[i].kind === 'chapter' ? 0.25 : 1;
      const weightB = nodes[j].kind === 'core' ? 0 : nodes[j].kind === 'chapter' ? 0.25 : 1;
      ax[i] += fx * weightA;
      ay[i] += fy * weightA;
      ax[j] -= fx * weightB;
      ay[j] -= fy * weightB;
    }

    let energy = 0;
    nodes.forEach((node, position) => {
      const point = points[position];
      if (!point) return;
      if (node.kind === 'core') {
        point.x = point.pinned ? point.x : point.x * 0.9;
        point.y = point.pinned ? point.y : point.y * 0.9;
        point.vx = point.vy = 0;
        return;
      }
      // 轻轻拉向中心，整团不会飘走。
      ax[position] -= point.x * 0.02;
      ay[position] -= point.y * 0.02;
      // 珠子绕自己的章节转：新鲜的转得快，起雾的慢吞吞。
      if (node.kind === 'memory' && this.orbit > 0 && node.parent) {
        const parent = this.points.get(node.parent);
        if (parent) {
          const dx = point.x - parent.x;
          const dy = point.y - parent.y;
          const distance = Math.max(0.001, Math.hypot(dx, dy));
          const speed =
            this.orbit * (0.12 + node.freshness * 0.28) * (seeded(node.id, 2) > 0.5 ? 1 : -1);
          ax[position] += (-dy / distance) * speed;
          ay[position] += (dx / distance) * speed;
        }
      }
      // 章节绕课程整体慢慢转。
      if (node.kind === 'chapter' && this.orbit > 0) {
        const distance = Math.max(0.001, Math.hypot(point.x, point.y));
        ax[position] += (-point.y / distance) * this.orbit * 0.035;
        ay[position] += (point.x / distance) * this.orbit * 0.035;
      }
      if (point.pinned) {
        point.vx = point.vy = 0;
        return;
      }
      point.vx = (point.vx + ax[position] * dt) * 0.9;
      point.vy = (point.vy + ay[position] * dt) * 0.9;
      const speed = Math.hypot(point.vx, point.vy);
      if (speed > 4) {
        point.vx *= 4 / speed;
        point.vy *= 4 / speed;
      }
      point.x += point.vx * dt;
      point.y += point.vy * dt;
      energy = Math.max(energy, speed);
    });
    return energy;
  }

  bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = -1;
    let maxX = 1;
    let minY = -1;
    let maxY = 1;
    this.nodes.forEach((node) => {
      const point = this.points.get(node.id);
      if (!point) return;
      const r = GALAXY_RADIUS[node.kind];
      minX = Math.min(minX, point.x - r);
      maxX = Math.max(maxX, point.x + r);
      minY = Math.min(minY, point.y - r);
      maxY = Math.max(maxY, point.y + r);
    });
    return { minX, maxX, minY, maxY };
  }
}
