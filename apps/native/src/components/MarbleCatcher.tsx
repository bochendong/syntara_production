import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import { launchMarble } from './GlassMarbles';
import type { LocalNotebook, LocalStudyMemory } from '../domain/models';
import { memoryMarble } from '../lib/learning-action-marbles';
import { readReviewedMap } from '../lib/memory-freshness';
import { buildMemoryGalaxy } from '../lib/memory-galaxy';
import type { MemoryGalaxyScene } from '../lib/memory-galaxy-3d';

const MemoryGalaxy3D = lazy(() => import('./MemoryGalaxy3D'));

export type MarbleCatch = {
  /** 每次存记忆一个新的 key，组件会重新播一遍。 */
  key: string;
  courseId: string;
  courseLabel: string;
  notebooks: LocalNotebook[];
  /** 存之前已有的记忆。 */
  memories: LocalStudyMemory[];
  incoming: LocalStudyMemory;
  from: Element | null;
};

/**
 * 点了「记住」之后：右下角浮出这门课的小星图，卡片上的珠子飞进中间的课程球，
 * 课程球亮一下，珠子再蹦到它所属的章节旁边，星图沉下去。
 * 星图很小、贴着输入框右上方，不挡对话，也不吃点击。
 */
export function MarbleCatcher({
  request,
  backgroundUrl,
  onDone,
}: {
  request: MarbleCatch;
  backgroundUrl?: string;
  onDone: () => void;
}) {
  const [landed, setLanded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const sceneRef = useRef<MemoryGalaxyScene | null>(null);
  const timers = useRef<number[]>([]);
  const launched = useRef(false);
  const doneRef = useRef(onDone);

  const [before, after] = useMemo(() => {
    const reviewed = readReviewedMap();
    const input = {
      courseId: request.courseId,
      courseLabel: request.courseLabel,
      backgroundUrl,
      notebooks: request.notebooks,
    };
    return [
      buildMemoryGalaxy({ ...input, memories: request.memories }, reviewed),
      buildMemoryGalaxy({ ...input, memories: [...request.memories, request.incoming] }, reviewed),
    ];
  }, [request, backgroundUrl]);

  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const later = (fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay));
  };

  const start = (scene: MemoryGalaxyScene | null) => {
    sceneRef.current = scene;
    if (!scene || launched.current) return;
    launched.current = true;
    // 星图浮上来就抛，不让人多等。
    later(() => {
      const current = sceneRef.current;
      if (!current) return;
      launchMarble(request.from, memoryMarble(request.incoming.kind).color, {
        to: current.coreOnScreen(),
        onLand: () => {
          setLanded(true);
          later(() => setLeaving(true), 1300);
          later(() => doneRef.current(), 1600);
        },
      });
    }, 300);
  };

  const fallBack = () => {
    // 没有 3D：退回原来的样子，珠子飞进课程头像。
    if (launched.current) return;
    launched.current = true;
    launchMarble(request.from, memoryMarble(request.incoming.kind).color);
    doneRef.current();
  };

  return (
    <div className={`marble-catcher${leaving ? ' is-leaving' : ''}`} aria-hidden>
      <Suspense fallback={<span className="marble-catcher-jar" />}>
        <MemoryGalaxy3D
          galaxy={landed ? after : before}
          spawnId={landed ? request.incoming.id : null}
          label="记忆星图"
          className="marble-catcher-jar"
          mini
          onScene={start}
          onUnavailable={fallBack}
        />
      </Suspense>
    </div>
  );
}
