import type { MarbleColor } from './learning-action-marbles';

/** 每本笔记读到哪一节、读过哪些节。只存在这台设备上（和记忆复习一样）。 */
export type NotebookReading = {
  last: number;
  visited: number[];
  at: number;
};

const STORAGE_KEY = 'syntara.notebook-reading.v1';

/** 笔记的弹珠颜色跟着它在课程里的顺序走：列表、阅读器、学习进度页同一套。 */
export const NOTEBOOK_MARBLE_COLORS: MarbleColor[] = ['blue', 'purple', 'pink', 'green', 'amber'];

export function notebookMarbleColor(index: number): MarbleColor {
  return NOTEBOOK_MARBLE_COLORS[
    ((index % NOTEBOOK_MARBLE_COLORS.length) + NOTEBOOK_MARBLE_COLORS.length) %
      NOTEBOOK_MARBLE_COLORS.length
  ];
}

function readAll(): Record<string, NotebookReading> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, NotebookReading>) : {};
  } catch {
    return {};
  }
}

export function loadNotebookReadings(): Record<string, NotebookReading> {
  return readAll();
}

export function loadNotebookReading(notebookId: string): NotebookReading | null {
  return readAll()[notebookId] ?? null;
}

export function saveNotebookReading(notebookId: string, index: number): NotebookReading {
  const all = readAll();
  const previous = all[notebookId];
  const visited = new Set(previous?.visited ?? []);
  visited.add(index);
  const next: NotebookReading = {
    last: index,
    visited: [...visited].sort((a, b) => a - b),
    at: Date.now(),
  };
  all[notebookId] = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 隐私模式下存不了就算了，阅读本身不受影响。
  }
  return next;
}

/** 「02 · 集合与命题证明」拆成编号和标题，编号放进弹珠里。 */
export function splitNotebookName(name: string): { number: string | null; title: string } {
  const match = /^\s*(\d{1,3})(?:\s*[·.、:：\-–—]\s*|\s+)(.+)$/.exec(name);
  return match ? { number: match[1], title: match[2] } : { number: null, title: name };
}

/** 按课程里的笔记顺序（编号）找这本笔记的弹珠颜色。 */
export function notebookAccentFor(
  notebooks: { id: string; name: string }[],
  notebookId: string,
): MarbleColor {
  const index = [...notebooks]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    .findIndex((notebook) => notebook.id === notebookId);
  return notebookMarbleColor(Math.max(0, index));
}
