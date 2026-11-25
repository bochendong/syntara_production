import type { LocalProblem, LocalProblemAttempt, LocalProblemProgress } from '../domain/models';
import { accountStorageKey } from './browser-runtime';

/**
 * 错题本：做错过的题都在一张单子里，改对了也不自己走，学生点「移出」才离开。
 * 移出记在本机（按课程、按账号），之后再做错会自动回来。
 */
export type MistakeTab = 'book' | 'removed';

export type MistakeEntry = {
  problem: LocalProblem;
  tab: MistakeTab;
  /** 最近一次的状态（failed / partial / pending / passed），只用来给弹珠上色。 */
  status: string | undefined;
  wrongCount: number;
  lastAttemptAt: number | null;
};

const REMOVED_KEY = 'syntara.mistake-book-removed.v1:';
const CHANGE_EVENT = 'syntara:mistake-book';

function removedKey(courseId: string) {
  return accountStorageKey(REMOVED_KEY + courseId);
}

export function readRemovedMistakes(courseId: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(removedKey(courseId));
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === 'object' ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeRemovedMistakes(courseId: string, value: Record<string, number>) {
  try {
    window.localStorage.setItem(removedKey(courseId), JSON.stringify(value));
  } catch {
    // 存不了就只在这次打开里生效。
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function removeMistakes(courseId: string, problemIds: string[], at = Date.now()) {
  const removed = readRemovedMistakes(courseId);
  for (const id of problemIds) removed[id] = at;
  writeRemovedMistakes(courseId, removed);
}

export function restoreMistakes(courseId: string, problemIds: string[]) {
  const removed = readRemovedMistakes(courseId);
  for (const id of problemIds) delete removed[id];
  writeRemovedMistakes(courseId, removed);
}

export const MISTAKE_BOOK_EVENT = CHANGE_EVENT;

const isWrong = (status: string | undefined) =>
  status === 'failed' || status === 'partial' || status === 'pending';

/**
 * 把做错过的题分进「错题本 / 已移出」。
 * `mistakes` 是做错过的题（任何一次作答错了或部分对）。
 * 移出之后又做错（最新状态是错、且在移出之后作答）就回到待订正。
 */
export function sortMistakes(
  problems: LocalProblem[],
  mistakes: ReadonlySet<string>,
  records: ReadonlyMap<string, LocalProblemProgress> | null,
  removed: Record<string, number>,
): MistakeEntry[] {
  const entries: MistakeEntry[] = [];
  const seen = new Set<string>();
  for (const problem of problems) {
    if (seen.has(problem.id)) continue;
    seen.add(problem.id);
    const record = records?.get(problem.id);
    const status = record?.attemptedCount ? record.status : undefined;
    if (!mistakes.has(problem.id) && !(status === 'failed' || status === 'partial')) continue;
    const removedAt = removed[problem.id];
    const wrongAgain = isWrong(status) && (record?.lastAttemptAt ?? 0) > (removedAt ?? 0);
    const tab: MistakeTab = removedAt !== undefined && !wrongAgain ? 'removed' : 'book';
    entries.push({
      problem,
      tab,
      status,
      wrongCount: Math.max(1, (record?.attemptedCount ?? 0) - (record?.passedCount ?? 0)),
      lastAttemptAt: record?.lastAttemptAt ?? null,
    });
  }
  return entries;
}

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** 选项 id 换成 A、B、C（按题目里的顺序）。 */
function optionLetters(problem: LocalProblem, ids: string[]) {
  const options = Array.isArray(problem.publicContent.options)
    ? (problem.publicContent.options as unknown[]).map((option) => String(rec(option).id ?? ''))
    : [];
  return ids
    .map((id) => {
      const index = options.indexOf(id);
      return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : id;
    })
    .join('、');
}

function shorten(text: string, max = 24) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 上一次错的作答，压成一行：「你选了 B · 正确 C」「没过：空字符串、大写」。 */
export type MistakeSnippet = { mine: string; detail?: string };

export function mistakeSnippet(
  problem: LocalProblem,
  attempt: Pick<LocalProblemAttempt, 'answer' | 'result'> | undefined,
): MistakeSnippet | null {
  if (!attempt) return null;
  const answer = rec(attempt.answer);
  const result = rec(attempt.result);
  const server = rec(result.serverCodeResult ?? result);
  const selected = strings(answer.selectedOptionIds);
  if (selected.length) {
    const correct = strings(rec(problem.grading).correctOptionIds);
    return {
      mine: `你选了 ${optionLetters(problem, selected)}`,
      detail: correct.length ? `正确 ${optionLetters(problem, correct)}` : undefined,
    };
  }
  const cases = [
    ...(Array.isArray(server.publicCases) ? server.publicCases : []),
    ...(Array.isArray(server.caseResults) ? server.caseResults : []),
  ].map(rec);
  const failing = cases
    .filter((item) => item.passed === false)
    .map((item) => String(item.description || item.id || '').trim())
    .filter(Boolean);
  const summary = rec(server.publicSummary);
  if (failing.length || typeof summary.total === 'number') {
    const head =
      typeof summary.total === 'number' ? `${summary.passed ?? 0}/${summary.total} 测试通过` : '';
    return {
      mine: failing.length
        ? `没过：${failing
            .slice(0, 2)
            .map((t) => shorten(t, 14))
            .join('、')}`
        : head,
      detail: failing.length ? head || undefined : undefined,
    };
  }
  const blanks = Object.values(rec(answer.blanks)).map((value) => String(value ?? '').trim());
  if (blanks.some(Boolean)) {
    return { mine: `你填 ${shorten(blanks.filter(Boolean).slice(0, 2).join('、'), 18)}` };
  }
  const text = typeof answer.text === 'string' ? answer.text : '';
  if (text.trim()) return { mine: `你写了「${shorten(text, 16)}」` };
  return null;
}

/** 「今天」「2 天前」「1 周前」。 */
export function relativeDay(timestamp: number | null, now = Date.now()) {
  if (!timestamp) return '';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((start.getTime() - timestamp) / 86_400_000));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / 30)} 个月前`;
}
