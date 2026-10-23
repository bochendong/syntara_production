import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeneralChatClient, GeneralConversation } from '../data/general-chat';
import { getLocalRepository } from '../data/repository';
import { mergeRecentChats, syncRecentChatPage, type RecentChat } from '../data/recent-chats';

type Summary = Pick<GeneralConversation, 'id' | 'title' | 'createdAt' | 'updatedAt'>;

export function useRecentChats(
  courseIds: string[],
  currentCourseId: string | null,
  current: Summary[],
  client: GeneralChatClient | null,
  enabled: boolean,
) {
  const courseKey = JSON.stringify(courseIds.slice().sort());
  const [rows, setRows] = useState<RecentChat[]>([]);
  const [revision, setRevision] = useState(0);
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ids: string[] = JSON.parse(courseKey);
    void (async () => {
      const repository = await getLocalRepository();
      const [local, general] = await Promise.allSettled([
        repository.listConversations(ids),
        client ? client.list() : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setRows((previous) =>
        mergeRecentChats(
          ids,
          local.status === 'fulfilled'
            ? local.value
            : previous.filter((row) => row.courseId !== null),
          general.status === 'fulfilled'
            ? general.value
            : previous.filter((row) => row.courseId === null),
        ),
      );
      setError(
        local.status === 'rejected' || general.status === 'rejected'
          ? '部分聊天暂时无法加载'
          : null,
      );
    })().catch(() => {
      if (!cancelled) setError('聊天记录暂时无法加载');
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, courseKey, client, current, revision]);

  useEffect(() => {
    const request = ++generation.current;
    if (!enabled) return;
    refreshing.current = true;
    setState('loading');
    setCursors({});
    void getLocalRepository()
      .then((repository) => syncRecentChatPage(repository, JSON.parse(courseKey)))
      .then((result) => {
        if (request !== generation.current) return;
        setCursors(result.cursors);
        setState(result.failed ? 'error' : 'idle');
        refresh();
      })
      .catch(() => {
        if (request === generation.current) setState('error');
      })
      .finally(() => {
        if (request === generation.current) refreshing.current = false;
      });
    return () => {
      generation.current = request + 1;
    };
  }, [enabled, courseKey, refresh]);

  const loadMore = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const request = generation.current;
    setState('loading');
    try {
      const repository = await getLocalRepository();
      const result = await syncRecentChatPage(repository, JSON.parse(courseKey), { cursors });
      if (request !== generation.current) return;
      setCursors(result.cursors);
      setState(result.failed ? 'error' : 'idle');
      refresh();
    } catch {
      if (request === generation.current) setState('error');
    } finally {
      if (request === generation.current) refreshing.current = false;
    }
  }, [courseKey, cursors, refresh]);

  const search = useCallback(
    (query: string) => {
      if (!query.trim()) return;
      const request = generation.current;
      void getLocalRepository()
        .then((repository) => syncRecentChatPage(repository, JSON.parse(courseKey), { query }))
        .then(() => {
          if (request === generation.current) refresh();
        })
        .catch(() => {
          if (request === generation.current) setError('聊天搜索暂时不可用');
        });
    },
    [courseKey, refresh],
  );

  const conversations = useMemo(() => {
    const ids: string[] = JSON.parse(courseKey);
    const local = rows.filter((row) => row.courseId !== null);
    const general = rows.filter((row) => row.courseId === null);
    if (currentCourseId)
      local.push(...current.map((row) => ({ ...row, courseId: currentCourseId })));
    else {
      general.length = 0;
      general.push(...current.map((row) => ({ ...row, courseId: null })));
    }
    return mergeRecentChats(ids, local, general);
  }, [courseKey, currentCourseId, current, rows]);

  return {
    conversations,
    error,
    refresh,
    search,
    paging: {
      hasMore: state === 'error' || Object.values(cursors).some(Boolean),
      state,
      onLoadMore: loadMore,
    },
  };
}
