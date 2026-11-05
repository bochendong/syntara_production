'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { SyntaraMark } from '@/components/brand/syntara-mark';
import landing from '@/components/home/landing/landing.module.css';
import { LANDING_MARBLE_STYLE } from '@/components/home/landing/marble-art';
import { FEATURES } from '@/components/home/landing/syntara-landing';

import type { WorldEngine, WorldFrame } from './world-engine';
import {
  CHAPTERS,
  CLOSING_START,
  COPY_WINDOWS,
  COURSE_NAME,
  featureStart,
  MEMORY_FEATURE,
  RAIL_STOPS,
  railIndexAt,
  TIMELINE_END,
} from './world-timeline';
import s from './world.module.css';

const MEMORY_LABELS = [
  { title: '递归的基本情况', kind: '错题' },
  { title: 'trace table 怎么画', kind: '没弄懂' },
  { title: '先看例子再讲定义', kind: '偏好' },
];
const RAIL = [
  { label: '首页', color: 'purple' },
  { label: '学习星图', color: 'pink' },
  ...FEATURES.map((f) => ({ label: f.label, color: f.color })),
  { label: '开始', color: 'purple' },
];

/** One glyph per span so headlines can assemble letter by letter. */
function Split({ text, offset = 0 }: { text: string; offset?: number }) {
  return (
    <span aria-hidden>
      {[...text].map((ch, i) => (
        <span key={i} className={s.ch} style={{ '--i': i + offset } as CSSProperties}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** First line assembles glyph by glyph, the second line sweeps in with the brand gradient. */
function Headline({
  text,
  as: Tag,
  className,
}: {
  text: string;
  as: 'h1' | 'h2';
  className: string;
}) {
  const [first, ...rest] = text.split('\n');
  const second = rest.join('');
  return (
    <Tag className={className} aria-label={text.replace('\n', '')}>
      <Split text={first} />
      {second ? (
        <>
          <br />
          <span className={s.gradLine} aria-hidden>
            {second}
          </span>
        </>
      ) : null}
    </Tag>
  );
}

type ChapterKey = 'hero' | 'map' | 'closing' | `feature-${number}`;

export function SyntaraWorldLanding({
  googleTest = false,
  onFallback,
}: {
  googleTest?: boolean;
  onFallback: () => void;
}) {
  const loginHref = googleTest ? '/test?as=student' : '/login';
  const teacherLoginHref = googleTest ? '/test?as=teacher' : null;
  const loginLabel = googleTest ? '学生登录' : '开始学习';
  const loginHint = googleTest
    ? '测试版用 Google 账号登录。老师登录后先认领自己教的课。'
    : '用 SpeedUp 账号登录，再从课程页进入 Syntara。';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLDivElement | null)[]>([]);
  const chapterRefs = useRef(new Map<ChapterKey, HTMLElement>());
  const mockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const engineRef = useRef<WorldEngine | null>(null);
  const navFrame = useRef(0);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  const setChapterRef = (key: ChapterKey) => (el: HTMLElement | null) => {
    if (el) chapterRefs.current.set(key, el);
    else chapterRefs.current.delete(key);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let lastRail = -1;
    const vh = () => window.innerHeight;
    const shown = new Map<ChapterKey, boolean>();

    const inWindow = (u: number, [a, b]: readonly [number, number]) => u >= a && u < b;
    const setOn = (key: ChapterKey, on: boolean) => {
      if (shown.get(key) === on) return;
      shown.set(key, on);
      const el = chapterRefs.current.get(key);
      if (!el) return;
      el.dataset.on = on ? 'true' : 'false';
      el.inert = !on;
      if (key.startsWith('feature-')) {
        const host = mockRefs.current[Number(key.slice(8))];
        if (host) {
          host.dataset.revealed = on ? 'true' : 'false';
          host.dataset.active = on ? 'true' : 'false';
        }
      }
    };

    const cursor = { x: -100, y: -100, cx: -100, cy: -100 };
    const onFrame = (f: WorldFrame) => {
      const { u } = f;
      setOn('hero', inWindow(u, COPY_WINDOWS.hero));
      setOn('map', inWindow(u, COPY_WINDOWS.map));
      FEATURES.forEach((_, i) => setOn(`feature-${i}`, inWindow(u, COPY_WINDOWS.feature(i))));
      setOn('closing', inWindow(u, COPY_WINDOWS.closing));

      const scrim = scrimRef.current;
      if (scrim) {
        const mode = u >= CLOSING_START + 0.3 ? 'bottom' : u > 0.6 ? 'side' : 'none';
        if (scrim.dataset.mode !== mode) scrim.dataset.mode = mode;
      }

      const rail = railIndexAt(u);
      if (rail !== lastRail) {
        lastRail = rail;
        setActive(rail);
      }

      const tip = tipRef.current;
      if (tip) {
        const hc = f.hoverChapter;
        if (hc >= 0) {
          const text =
            hc === 0
              ? `<b>${COURSE_NAME}</b><i>整门课</i>`
              : `<b>第 ${hc} 章 · ${CHAPTERS[hc - 1]}</b><i>${8 + ((hc * 7) % 13)} 颗记忆</i>`;
          if (tip.dataset.text !== text) {
            tip.dataset.text = text;
            tip.innerHTML = text;
          }
          tip.style.transform = `translate(${cursor.x + 16}px, ${cursor.y - 14}px)`;
          tip.dataset.on = 'true';
        } else if (tip.dataset.on === 'true') tip.dataset.on = 'false';
      }

      const memStart = featureStart(MEMORY_FEATURE);
      const showTags = u > memStart + 0.3 && u < memStart + 1.55;
      f.labels.forEach((pos, i) => {
        const el = tagRefs.current[i];
        if (!el) return;
        const on = showTags && !!pos && pos.x > 70 && pos.x < window.innerWidth - 70;
        el.dataset.on = on ? 'true' : 'false';
        if (pos) el.style.transform = `translate(calc(${pos.x}px - 50%), ${pos.y - 44}px)`;
      });

      const ring = cursorRef.current;
      if (ring) {
        cursor.cx += (cursor.x - cursor.cx) * 0.22;
        cursor.cy += (cursor.y - cursor.cy) * 0.22;
        ring.style.transform = `translate(${cursor.cx}px, ${cursor.cy}px)`;
        const big =
          f.hoverChapter >= 0 ||
          f.hoverMemory >= 0 ||
          !!document.querySelector(`.${s.chapter} a:hover, .${s.chapter} button:hover`);
        ring.dataset.big = big ? 'true' : 'false';
      }
    };

    const onScroll = () => engineRef.current?.setTarget(window.scrollY / vh());
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      if (cursorRef.current) cursorRef.current.dataset.on = 'true';
      // Glass windows lean toward the pointer.
      const tx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ty = (e.clientY / window.innerHeight - 0.5) * 2;
      for (const host of mockRefs.current) {
        host?.style.setProperty('--tx', tx.toFixed(3));
        host?.style.setProperty('--ty', ty.toFixed(3));
      }
    };
    const onLeave = () => {
      if (cursorRef.current) cursorRef.current.dataset.on = 'false';
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button')) return;
      engineRef.current?.tap(e.clientX, e.clientY);
    };

    import('./world-engine')
      .then(({ createWorldEngine }) => {
        if (disposed) return;
        const engine = createWorldEngine(canvas, {
          compact: window.matchMedia('(max-width: 700px), (pointer: coarse)').matches,
          onFrame,
          onContextLost: () => fallbackRef.current(),
        });
        engineRef.current = engine;
        engine.setTarget(window.scrollY / vh(), true);
        setReady(true);
      })
      .catch(() => fallbackRef.current());

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('click', onClick);
    return () => {
      disposed = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      cancelAnimationFrame(navFrame.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('click', onClick);
    };
  }, []);

  // Rail buttons glide to a chapter; any manual input takes over.
  useEffect(() => {
    const cancel = () => {
      cancelAnimationFrame(navFrame.current);
      navFrame.current = 0;
    };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, []);

  const goTo = useCallback((index: number) => {
    cancelAnimationFrame(navFrame.current);
    const from = window.scrollY;
    const to = RAIL_STOPS[index] * window.innerHeight;
    const distance = Math.abs(to - from) / window.innerHeight;
    // Long jumps skip ahead instead of replaying every chapter in between.
    if (distance > 4) {
      window.scrollTo({ top: to, behavior: 'instant' });
      engineRef.current?.setTarget(RAIL_STOPS[index], true);
      return;
    }
    const duration = 900 + distance * 450;
    const started = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / duration);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo({ top: from + (to - from) * e, behavior: 'instant' });
      navFrame.current = p < 1 ? requestAnimationFrame(step) : 0;
    };
    navFrame.current = requestAnimationFrame(step);
  }, []);

  return (
    <main className={`${landing.root} ${s.world}`} style={LANDING_MARBLE_STYLE}>
      <canvas ref={canvasRef} className={s.canvas} data-ready={ready} aria-hidden />
      <div ref={scrimRef} className={s.scrim} data-mode="none" aria-hidden />

      <header className={landing.nav}>
        <Link href="/" className={landing.brand} aria-label="Syntara 首页">
          <SyntaraMark className="size-8 rounded-xl" />
          <span>Syntara</span>
        </Link>
        <div className={landing.navActions}>
          <Link href="/download" className={`${landing.navDownload} ${s.hideNarrow}`}>
            下载桌面版
          </Link>
          <Link href={loginHref} className={landing.navLogin}>
            {teacherLoginHref ? '学生登录' : '登录'}
          </Link>
          {teacherLoginHref ? (
            <Link href={teacherLoginHref} className={`${landing.navLogin} ${s.hideNarrow}`}>
              老师登录
            </Link>
          ) : null}
        </div>
      </header>

      <div className={s.track} style={{ height: `${(TIMELINE_END + 1) * 100}vh` }} aria-hidden />

      <div className={s.copyLayer}>
        <section
          ref={setChapterRef('hero')}
          className={`${s.chapter} ${s.hero}`}
          data-on="true"
          aria-labelledby="world-title"
        >
          <div className={s.copy}>
            <span className={s.kicker} data-color="purple">
              <i className={s.dotMarble} />
              课程 AI 学习助手
            </span>
            <Headline as="h1" text={'没听懂的，\n回来再问。'} className={s.title} />
            <p className={s.lede}>
              上传课件或 PDF，Syntara 帮你整理成笔记、出练习题，还会记下你做错过什么。
            </p>
            <div className={landing.heroActions}>
              <Link href={loginHref} className={landing.primary}>
                {loginLabel}
              </Link>
              {teacherLoginHref ? (
                <Link href={teacherLoginHref} className={landing.ghost}>
                  老师登录
                </Link>
              ) : (
                <button type="button" className={landing.ghost} onClick={() => goTo(1)}>
                  先看看
                </button>
              )}
            </div>
            <p className={landing.loginHint}>{loginHint}</p>
          </div>
        </section>

        <section
          ref={setChapterRef('map')}
          className={`${s.chapter} ${s.bottomNarrow}`}
          data-on="false"
          aria-labelledby="world-map"
        >
          <div className={s.copy}>
            <span className={s.kicker} data-color="pink">
              <i className={s.dotMarble} />
              学习星图
            </span>
            <h2 id="world-map" className={s.h2} aria-label="一门课，一团星云">
              <Split text="一门课，" />
              <br />
              <span className={s.gradLine} aria-hidden>
                一团星云
              </span>
            </h2>
            <p className={s.lede}>
              每个章节是一颗大弹珠。错题、没弄懂的概念、你喜欢的讲法，都绕着它转。
            </p>
            <p className={`${s.hint} ${s.hideNarrow}`}>把鼠标放到大弹珠上，看看是哪一章</p>
          </div>
        </section>

        {FEATURES.map((f, i) => (
          <section
            key={f.key}
            ref={setChapterRef(`feature-${i}`)}
            className={`${s.chapter} ${s.feature}`}
            data-color={f.color}
            data-on="false"
            aria-labelledby={`world-feature-${f.key}`}
          >
            <div className={s.featureCopy}>
              <div className={s.copy}>
                <span className={s.kicker}>
                  <i className={s.dotMarble} />
                  {f.label}
                  <span className={s.count}>
                    {i + 1} / {FEATURES.length}
                  </span>
                </span>
                <h2
                  id={`world-feature-${f.key}`}
                  className={s.h2}
                  aria-label={f.title.replace('\n', '')}
                >
                  {f.title.split('\n').map((line, li) => (
                    <Fragment key={li}>
                      {li > 0 ? <br /> : null}
                      {li === 0 ? (
                        <Split text={line} />
                      ) : (
                        <span className={s.gradLine} aria-hidden>
                          {line}
                        </span>
                      )}
                    </Fragment>
                  ))}
                </h2>
                <p className={s.lede}>{f.body}</p>
                <ul className={s.points}>
                  {f.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
                {i === MEMORY_FEATURE ? (
                  <p className={s.hint}>点一下起雾的弹珠，它会亮回来</p>
                ) : null}
              </div>
            </div>
            {/* The memory chapter's demo is the 3D marbles themselves. */}
            {i === MEMORY_FEATURE ? null : (
              <div
                ref={(el) => {
                  mockRefs.current[i] = el;
                }}
                className={`${landing.feature} ${s.mockHost}`}
                data-color={f.color}
                data-revealed="false"
                data-active="false"
              >
                <div className={s.mockTilt}>
                  <div className={landing.featureMock}>
                    <f.Mock />
                  </div>
                </div>
              </div>
            )}
          </section>
        ))}

        <section
          ref={setChapterRef('closing')}
          className={`${s.chapter} ${s.closing}`}
          data-on="false"
          aria-labelledby="world-closing"
        >
          <div className={s.copy}>
            <Headline as="h2" text={'考前复习，\n从错题开始。'} className={s.h2} />
            <p className={s.lede}>
              {googleTest
                ? '不用下载，用 Google 账号登录就能在浏览器里用。'
                : '在网页上领一个激活码，手机上就能接着聊天、看笔记和小课堂。'}
            </p>
            <div className={landing.heroActions}>
              <Link href={loginHref} className={landing.primary}>
                {loginLabel}
              </Link>
              {teacherLoginHref ? (
                <Link href={teacherLoginHref} className={landing.ghost}>
                  老师登录
                </Link>
              ) : null}
            </div>
            <p className={landing.loginHint}>{loginHint}</p>
          </div>
          <footer className={s.footer}>© {new Date().getFullYear()} Syntara</footer>
        </section>
      </div>

      {MEMORY_LABELS.map((m, i) => (
        <div
          key={m.title}
          ref={(el) => {
            tagRefs.current[i] = el;
          }}
          className={s.tag}
          data-on="false"
          aria-hidden
        >
          <b>{m.title}</b>
          <i>{m.kind}</i>
        </div>
      ))}
      <div ref={tipRef} className={s.tag} data-on="false" aria-hidden />

      <nav className={s.rail} aria-label="页面导航">
        {RAIL.map(({ label, color }, i) => (
          <button
            key={label}
            type="button"
            className={s.railDot}
            data-color={color}
            aria-label={label}
            aria-current={active === i ? 'step' : undefined}
            onClick={() => goTo(i)}
          >
            <i />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div ref={cursorRef} className={s.cursor} data-on="false" aria-hidden />
    </main>
  );
}
