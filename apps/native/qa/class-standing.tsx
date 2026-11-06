import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ClassStandingCard,
  ClassStandingPopup,
  ClassStandingStrip,
  type StandingPeriod,
} from '../src/components/problem-bank/class-standing';
import { CLASS_STANDING_ILLUSTRATIONS } from '../src/components/problem-bank/class-standing-art';
import type { NativeClassStanding } from '../src/data/platform-api-contracts';
import '../src/components/marble-tokens.css';
import './class-standing.css';

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) {
  throw new Error('Local QA only');
}

type PreviewState = 'start' | 'practice' | 'progress' | 'leader';

function fixture(state: PreviewState, period: StandingPeriod): NativeClassStanding {
  const solved = { start: 0, practice: 12, progress: 16, leader: 30 }[state];
  const multiplier = period === 'all' ? 3 : 1;
  return {
    courseId: 'class-standing-art-qa',
    period,
    scope: 'class',
    className: '演示班级',
    size: 23,
    rank: { start: 23, practice: 9, progress: 7, leader: 1 }[state],
    metrics: {
      solved: {
        me: solved * multiplier,
        average: 9 * multiplier,
        top: 30 * multiplier,
        max: 100 * multiplier,
      },
      firstTry: {
        me: solved === 0 ? 0 : state === 'leader' ? 0.91 : 0.62,
        average: 0.55,
        top: 0.91,
        max: null,
      },
      streak: {
        me: solved === 0 ? 0 : state === 'leader' ? 14 : 3,
        average: 2,
        top: 14,
        max: null,
      },
      chapters: { me: solved === 0 ? 0 : state === 'leader' ? 8 : 4, average: 3, top: 8, max: 12 },
    },
    hint:
      state === 'leader'
        ? null
        : {
            chapterId: 'qa-lists',
            notebookId: null,
            chapterName: '05 列表',
            ahead: 6,
            problemIds: ['qa-1', 'qa-2', 'qa-3', 'qa-4', 'qa-5', 'qa-6'],
          },
    generatedAt: 0,
  };
}

function Preview() {
  const [state, setState] = useState<PreviewState>('practice');
  const [period, setPeriod] = useState<StandingPeriod>('week');
  const [expanded, setExpanded] = useState(true);
  const [popup, setPopup] = useState(false);
  const [artId, setArtId] = useState('');
  const [message, setMessage] = useState('');
  const standing = fixture(state, period);
  const artwork = CLASS_STANDING_ILLUSTRATIONS.find((item) => item.id === artId);
  const card = {
    standing,
    period,
    onPeriod: setPeriod,
    previousRank: state === 'progress' ? 9 : null,
    artwork,
    onChase: () => setMessage('演示：将进入「05 列表」的 6 道练习。本页面不提交作答。'),
  };
  return (
    <main className="qa-standing">
      <header>
        <h1>题库 · 和同班比</h1>
        <p>演示页面 · 模拟数据。这里直接复用题库的实际卡片与练习后弹窗。</p>
      </header>
      <div className="qa-standing-controls">
        <label>
          学习状态
          <select value={state} onChange={(event) => setState(event.target.value as PreviewState)}>
            <option value="start">未开始</option>
            <option value="practice">练习中</option>
            <option value="progress">有进步</option>
            <option value="leader">位于前列</option>
          </select>
        </label>
        <label className="qa-standing-art-picker">
          配图与引用
          <select value={artId} onChange={(event) => setArtId(event.target.value)}>
            <option value="">按当前状态自动选择</option>
            {CLASS_STANDING_ILLUSTRATIONS.map((item, index) => (
              <option key={item.id} value={item.id}>
                {String(index + 1).padStart(2, '0')} · {item.quote}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPopup(true)}>
          预览练习后弹窗
        </button>
      </div>
      <ClassStandingStrip standing={fixture(state, 'week')} onOpen={() => setExpanded(!expanded)} />
      {expanded ? <ClassStandingCard {...card} onCollapse={() => setExpanded(false)} /> : null}
      {message ? <p role="status">{message}</p> : null}
      {popup ? <ClassStandingPopup {...card} onClose={() => setPopup(false)} /> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
