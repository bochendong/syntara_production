import { useEffect, useState } from 'react';
import type { LocalProblem, LocalProblemProgress } from '../../domain/models';
import { getLocalRepository } from '../../data/repository';
import { problemAttemptHasMistake } from '../../data/problem-attempt-history';
import { isPlatformCourse } from '../../data/chat-sync';
import { bankResetTimes } from '../../data/problem-bank-round';
import { getNativeProblemAttempts } from '../../data/platform-api-client';

// Synced progress can arrive before this device downloads the individual submissions.
export function knownFirst(record?: LocalProblemProgress) {
  if (!record?.attemptedCount) return undefined;
  if (record.attemptedCount === 1) return record.status;
  if (record.passedCount === record.attemptedCount) return 'passed';
  return undefined;
}

export function useBankAttemptHistory(
  courseId: string,
  problems: LocalProblem[],
  records: Map<string, LocalProblemProgress> | null,
) {
  const [state, setState] = useState<{
    firsts: Map<string, string>;
    mistakes: Set<string>;
    loading: boolean;
    incomplete: boolean;
  }>({
    firsts: new Map(),
    mistakes: new Set(),
    incomplete: false,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    const firsts = new Map<string, string>();
    const mistakes = new Set<string>();
    let incomplete = false;
    const missing = problems.filter((p) => {
      const row = records?.get(p.id);
      const first = knownFirst(row);
      if (first) firsts.set(p.id, first);
      if (row?.hasIncorrectAttempt || row?.status === 'failed') mistakes.add(p.id);
      return row?.attemptedCount && (!first || (first === 'partial' && !mistakes.has(p.id)));
    });
    setState({
      firsts: new Map(firsts),
      mistakes: new Set(mistakes),
      incomplete: false,
      loading: !records || missing.length > 0,
    });
    async function load() {
      if (!missing.length) return;
      const repo = await getLocalRepository();
      const online = await isPlatformCourse(repo, courseId).catch(() => false);
      const resetTimes = bankResetTimes(courseId);
      let index = 0;
      async function worker() {
        while (active && index < missing.length) {
          const id = missing[index++].id;
          try {
            const local =
              (await repo.loadProblemDocument(id))?.attempts.filter(
                (a) =>
                  a.createdAt > (resetTimes[id] ?? 0) &&
                  (a.kind === 'submit' || a.kind === 'answer'),
              ) ?? [];
            if (local.some(problemAttemptHasMistake)) mistakes.add(id);
            if (local.length >= records!.get(id)!.attemptedCount) {
              const earliest = local.sort(
                (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
              )[0];
              firsts.set(id, earliest.status);
            } else if (online) {
              let cursor: string | null = null;
              do {
                const page = await getNativeProblemAttempts(courseId, id, cursor);
                if (page.attempts.some(problemAttemptHasMistake)) mistakes.add(id);
                cursor = page.nextCursor;
                const earliest = page.attempts.at(-1);
                if (!cursor && earliest) firsts.set(id, earliest.status);
              } while (active && cursor);
            } else {
              incomplete = true;
            }
          } catch {
            incomplete = true;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, missing.length) }, worker));
      if (active) setState({ firsts, mistakes, incomplete, loading: false });
    }
    void load().catch(() => {
      if (active) setState({ firsts, mistakes, incomplete: true, loading: false });
    });
    return () => {
      active = false;
    };
  }, [courseId, problems, records]);
  return state;
}
