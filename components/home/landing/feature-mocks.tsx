import type { CSSProperties } from 'react';

import styles from './landing.module.css';

const delay = (step: number) => ({ '--d': step }) as CSSProperties;

function Window({
  title,
  children,
  dark,
}: {
  title: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`${styles.window} ${dark ? styles.windowDark : ''}`}>
      <div className={styles.windowBar}>
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function NotesMock() {
  return (
    <Window title="CSC148 · 第 9 讲 递归">
      <div className={styles.notes}>
        <h4 className={styles.reveal} style={delay(0)}>
          递归的两个部分
        </h4>
        <p className={styles.reveal} style={delay(1)}>
          <b>基本情况</b>：问题小到可以直接回答，函数在这里停下。
          <span className={styles.cite}>1</span>
        </p>
        <p className={styles.reveal} style={delay(2)}>
          <b>递归情况</b>：把问题拆小，调用自己处理更小的那一份。
          <span className={styles.cite}>2</span>
        </p>
        <pre className={`${styles.code} ${styles.reveal}`} style={delay(3)}>
          {
            'def total(lst):\n    if lst == []:\n        return 0\n    return lst[0] + total(lst[1:])'
          }
        </pre>
        <div className={`${styles.source} ${styles.pop}`} style={delay(5)}>
          <span className={styles.cite}>1</span>
          Lecture 9 · Recursion · 第 12 页
        </div>
      </div>
    </Window>
  );
}

const TREE_NODES: { v: number; x: number; y: number }[] = [
  { v: 50, x: 160, y: 34 },
  { v: 30, x: 90, y: 92 },
  { v: 70, x: 230, y: 92 },
  { v: 20, x: 52, y: 150 },
  { v: 40, x: 128, y: 150 },
  { v: 60, x: 192, y: 150 },
  { v: 80, x: 268, y: 150 },
];
const TREE_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 4],
  [2, 5],
  [2, 6],
];

export function ClassroomMock() {
  return (
    <Window title="课堂 · 二叉搜索树" dark>
      <div className={styles.theater}>
        <div className={styles.slide}>
          <p className={styles.slideTitle}>插入 42：比根小往左，比 30 大往右</p>
          <svg viewBox="0 0 320 214" className={styles.tree} aria-hidden>
            {TREE_EDGES.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={TREE_NODES[a].x}
                y1={TREE_NODES[a].y}
                x2={TREE_NODES[b].x}
                y2={TREE_NODES[b].y}
              />
            ))}
            <path className={styles.treePath} d="M160 34 L90 92 L128 150 L156 200" />
            {TREE_NODES.map((n) => (
              <g key={n.v}>
                <circle cx={n.x} cy={n.y} r="17" />
                <text x={n.x} y={n.y + 5}>
                  {n.v}
                </text>
              </g>
            ))}
            <g className={styles.treeNew}>
              <circle cx="156" cy="200" r="17" />
              <text x="156" y="205">
                42
              </text>
            </g>
          </svg>
        </div>
        <div className={styles.subtitles}>
          <span>先和根节点 50 比，42 更小，往左走。</span>
          <span>再和 30 比，42 更大，往右走。</span>
          <span>40 的右边是空的，42 就放在这里。</span>
        </div>
        <div className={styles.player}>
          <i className={`${styles.marble} ${styles.mPurple}`} />
          <div className={styles.track}>
            <b />
          </div>
          <span>2:14</span>
        </div>
      </div>
    </Window>
  );
}

const OPTIONS = ['3 次', '4 次', '2 次', '无限次'];

export function ProblemsMock() {
  return (
    <Window title="题库 · 递归">
      <div className={styles.problem}>
        <div className={styles.levels}>
          <span>
            <i className={`${styles.marble} ${styles.mGreen}`} />
            基础
          </span>
          <span className={styles.levelOn}>
            <i className={`${styles.marble} ${styles.mAmber}`} />
            进阶
          </span>
          <span>
            <i className={`${styles.marble} ${styles.mPink}`} />
            挑战
          </span>
        </div>
        <p className={styles.question}>
          调用 <code>total([1, 2, 3])</code> 时，<code>total</code> 一共会被调用几次？
        </p>
        <div className={styles.options}>
          {OPTIONS.map((o, i) => (
            <div key={o} className={`${styles.option} ${i === 1 ? styles.optionRight : ''}`}>
              <b>{'ABCD'[i]}</b>
              {o}
            </div>
          ))}
        </div>
        <div className={`${styles.toast} ${styles.pop}`} style={delay(6)}>
          <i className={`${styles.marble} ${styles.mGreen}`} />
          答对了。[1,2,3] → [2,3] → [3] → []，一共 4 次。
        </div>
      </div>
    </Window>
  );
}

export function MemoryMock() {
  return (
    <Window title="学习记忆 · CSC148" dark>
      <div className={styles.memory}>
        <div className={styles.orbit} aria-hidden>
          <i className={`${styles.marble} ${styles.core}`} />
          {(['mPink', 'mAmber', 'mBlue', 'mGreen', 'mPurple', 'mPink'] as const).map((c, i) => (
            <span key={i} className={styles.orbitArm} style={{ '--i': i } as CSSProperties}>
              <i className={`${styles.marble} ${styles[c]}`} />
            </span>
          ))}
        </div>
        <div className={styles.memoryCards}>
          <div className={`${styles.memoryCard} ${styles.pop}`} style={delay(1)}>
            <i className={`${styles.marble} ${styles.mPink}`} />
            <div>
              <b>错题</b>
              <p>写递归时忘了基本情况，栈溢出了</p>
            </div>
          </div>
          <div className={`${styles.memoryCard} ${styles.foggy} ${styles.pop}`} style={delay(2)}>
            <i className={`${styles.marble} ${styles.mAmber}`} />
            <div>
              <b>知识盲点</b>
              <p>lst[1:] 每次都会复制一份列表</p>
            </div>
            <span className={styles.fogTag}>5 天没复习</span>
          </div>
          <div className={`${styles.memoryCard} ${styles.pop}`} style={delay(3)}>
            <i className={`${styles.marble} ${styles.mBlue}`} />
            <div>
              <b>偏好</b>
              <p>喜欢先看例子，再看定义</p>
            </div>
          </div>
        </div>
      </div>
    </Window>
  );
}

const WEEK = [
  { d: '一', n: 20 },
  { d: '二', n: 21, today: true },
  { d: '三', n: 22 },
  { d: '四', n: 23 },
  { d: '五', n: 24 },
  { d: '六', n: 25 },
  { d: '日', n: 26 },
];
const EVENTS: { day: number; label: string; kind: 'mBlue' | 'mPink' | 'mAmber' | 'mPurple' }[] = [
  { day: 1, label: '学到第 9 讲', kind: 'mAmber' },
  { day: 2, label: '答疑时间', kind: 'mPurple' },
  { day: 3, label: 'A2 截止', kind: 'mBlue' },
  { day: 4, label: '复习递归', kind: 'mAmber' },
  { day: 6, label: '期中考试', kind: 'mPink' },
];

export function CalendarMock() {
  return (
    <Window title="日历 · 10 月">
      <div className={styles.calendar}>
        {WEEK.map((w, i) => (
          <div key={w.n} className={`${styles.day} ${w.today ? styles.today : ''}`}>
            <span className={styles.dow}>周{w.d}</span>
            <span className={styles.dateNum}>{w.n}</span>
            {EVENTS.filter((e) => e.day === i).map((e, k) => (
              <span key={e.label} className={`${styles.event} ${styles.pop}`} style={delay(i + k)}>
                <i className={`${styles.marble} ${styles[e.kind]}`} />
                {e.label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.legend}>
        <span>
          <i className={`${styles.marble} ${styles.mBlue}`} />
          作业
        </span>
        <span>
          <i className={`${styles.marble} ${styles.mPink}`} />
          考试
        </span>
        <span>
          <i className={`${styles.marble} ${styles.mAmber}`} />
          学习进度
        </span>
        <span>
          <i className={`${styles.marble} ${styles.mPurple}`} />
          辅导
        </span>
      </div>
    </Window>
  );
}
