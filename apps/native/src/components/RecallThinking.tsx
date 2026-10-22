import { useEffect, useRef, useState } from 'react';
import { marbleImages, memoryMarble } from '../lib/learning-action-marbles';
import { MarbleThinking } from './GlassMarbles';
import './recall-thinking.css';

/** 这次发给 AI 的学习记忆（按类型）和笔记片段数量，发消息前在本机就挑好了。 */
export interface ThinkingRecall {
  memoryKinds: string[];
  noteCount: number;
}

const MAX_MARBLES = 7;
const ROLL_IN_MS = 520;
const ROLL_STAGGER_MS = 110;
const GATHER_MS = 360;

type Marble = { key: string; src: string | null };

function marblesOf(recall: ThinkingRecall): Marble[] {
  const memories = recall.memoryKinds.slice(0, MAX_MARBLES - 1).map((kind, index) => ({
    key: `m${index}`,
    src: marbleImages[memoryMarble(kind).color],
  }));
  const notes = Array.from(
    { length: Math.min(recall.noteCount, Math.max(1, MAX_MARBLES - memories.length), 3) },
    (_, index) => ({ key: `n${index}`, src: null }),
  );
  return [...memories, ...notes];
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * AI 思考时：这次用到的记忆珠子（真实颜色）和笔记小透明珠一颗颗滚进来，
 * 在一个扁椭圆上慢慢绕圈；第一个字出来时收拢到中间、淡出。没有记忆和笔记时退回三颗跳珠。
 */
export function RecallThinking({ recall, done }: { recall: ThinkingRecall | null; done: boolean }) {
  const marbles = recall ? marblesOf(recall) : [];
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const doneAtRef = useRef<number | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!done) return;
    doneAtRef.current = performance.now();
    const timer = window.setTimeout(() => setGone(true), GATHER_MS + 60);
    return () => window.clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring || !marbles.length || reducedMotion()) return;
    const nodes = [...ring.querySelectorAll<HTMLElement>('.recall-marble')];
    const count = nodes.length;
    const rx = 10 + count * 3;
    const ry = 4;
    const cx = rx + 7;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const spin = (now - start) / 1400;
      const gather = doneAtRef.current ? Math.min(1, (now - doneAtRef.current) / GATHER_MS) : 0;
      nodes.forEach((node, index) => {
        const angle = spin + (index / count) * Math.PI * 2;
        const depth = Math.sin(angle);
        let x = cx + Math.cos(angle) * rx;
        let y = 9 + depth * ry;
        // 滚入：从左边带着旋转滚到自己的位置。
        const rolled = Math.min(
          1,
          Math.max(0, (now - start - index * ROLL_STAGGER_MS) / ROLL_IN_MS),
        );
        const ease = 1 - (1 - rolled) ** 3;
        x = -14 + (x + 14) * ease;
        const roll = (1 - ease) * -540;
        // 收拢：所有珠子往中心缩。
        x += (cx - x) * gather;
        y += (9 - y) * gather;
        const scale = (0.78 + (0.22 * (depth + 1)) / 2) * (1 - gather * 0.85);
        node.style.transform = `translate(${x - 6}px, ${y - 6}px) rotate(${roll}deg) scale(${scale})`;
        node.style.opacity = String(ease * (1 - gather));
        node.style.zIndex = String(Math.round((depth + 1) * 10));
      });
      if (!doneAtRef.current || now - doneAtRef.current < GATHER_MS) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // 珠子只在拿到这次的记忆时排一次。
  }, [marbles.length]);

  if (gone) return null;
  if (!marbles.length) {
    return done ? null : (
      <span className="assistant-thinking" aria-label="正在思考">
        <MarbleThinking />
      </span>
    );
  }
  const width = 2 * (10 + marbles.length * 3) + 14;
  return (
    <span
      className={`recall-thinking${done ? ' recall-thinking-done' : ''}${reducedMotion() ? ' recall-thinking-still' : ''}`}
      aria-label="正在翻笔记和记忆"
    >
      <span className="recall-ring" ref={ringRef} style={{ width }}>
        {marbles.map((marble) =>
          marble.src ? (
            <img key={marble.key} className="recall-marble" src={marble.src} alt="" />
          ) : (
            <span key={marble.key} className="recall-marble recall-marble-note" />
          ),
        )}
      </span>
    </span>
  );
}
