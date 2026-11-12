'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { SyntaraMark } from '@/components/brand/syntara-mark';
import landing from '@/components/home/landing/landing.module.css';
import { LANDING_MARBLE_STYLE } from '@/components/home/landing/marble-art';

import type { WorldEngine, WorldFrame } from './world-engine';
import { createWheelGesture, swipeDirection } from './scroll-gesture';
import {
  AGENTS,
  CHAPTERS,
  CLOSING_START,
  COPY_WINDOWS,
  COURSE_NAME,
  COURSES,
  featureStart,
  FEATURE_LEN,
  RAIL_STOPS,
  railIndexAt,
  TIMELINE_END,
  type WorldColor,
} from './world-timeline';
import s from './world.module.css';

/** Real App pages, built from apps/native (pnpm home:showcase). */
const SHOWCASE_URL =
  process.env.NEXT_PUBLIC_HOME_SHOWCASE_URL || '/home-showcase/home-showcase.html';

type ShowcaseView = 'notes' | 'classroom' | 'problems' | 'memory' | 'calendar';

const FEATURES: {
  key: ShowcaseView;
  color: WorldColor;
  label: string;
  windowTitle: string;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    key: 'notes',
    color: 'blue',
    label: '笔记',
    windowTitle: 'CSC148 · 笔记',
    title: '上传课件，\n按章节出笔记',
    body: 'PPT、PDF、Word 和网页都能传。笔记按章节排好，每一段都能点回原文那一页。',
    points: ['按章节分好', '点一下回到原文', '读到哪记到哪'],
  },
  {
    key: 'classroom',
    color: 'purple',
    label: '课堂',
    windowTitle: 'MAT136 · 课堂',
    title: '一个知识点，\n讲五分钟',
    body: '讲解助手把难点做成幻灯片，配上语音，边讲边圈出重点。听不懂就暂停，直接问。',
    points: ['语音讲解', '重点跟着圈', '随时暂停提问'],
  },
  {
    key: 'problems',
    color: 'amber',
    label: '题库',
    windowTitle: 'CSC108 · 做题',
    title: '代码直接跑，\n提交马上批改',
    body: '真题按章节分好，分基础、进阶、挑战三档。代码在浏览器里就能运行，测试一条条对给你看；卡住了先给提示，不直接给答案。',
    points: ['代码在线运行', '测试逐条对照', '先提示再给答案', '错题自动收集'],
  },
  {
    key: 'memory',
    color: 'pink',
    label: '学习记忆',
    windowTitle: 'CSC148 · 学习记忆',
    title: '做错过什么，\n它都记着',
    body: '错题、没弄懂的概念、你喜欢的讲法，各存成一颗弹珠，按章节连成星图。几天不复习，弹珠会起雾。',
    points: ['按章节连成星图', '不复习会起雾', '问 AI 时先翻这些'],
  },
  {
    key: 'calendar',
    color: 'green',
    label: '日历',
    windowTitle: 'MAT136 · 日历',
    title: '作业和考试，\n放在一张日历上',
    body: '截止日期、考试和复习计划排在一起，打开就知道今天要做什么。',
    points: ['截止前提醒', '复习计划自动排', '网页和手机同步'],
  },
];

const RAIL: { label: string; color: WorldColor }[] = [
  { label: '首页', color: 'purple' },
  { label: '很多门课', color: 'blue' },
  { label: 'AI 助手', color: 'green' },
  ...FEATURES.map((f) => ({ label: f.label, color: f.color })),
  { label: '开始', color: 'purple' },
];

/** One glyph per span so headlines can assemble letter by letter. */
function Split({ text }: { text: string }) {
  return (
    <span aria-hidden>
      {[...text].map((ch, i) => (
        <span key={i} className={s.ch} style={{ '--i': i } as CSSProperties}>
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
  id,
}: {
  text: string;
  as: 'h1' | 'h2';
  className: string;
  id?: string;
}) {
  const lines = text.split('\n');
  return (
    <Tag id={id} className={className} aria-label={lines.join('')}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {i === 0 ? (
            <Split text={line} />
          ) : (
            <span className={s.gradLine} aria-hidden>
              {line}
            </span>
          )}
        </Fragment>
      ))}
    </Tag>
  );
}

/**
 * A glass window holding a real App page. Scrolling over it still moves the
 * story; a click lets the visitor use the page until the pointer leaves.
 */
function LiveWindow({
  view,
  title,
  mounted,
}: {
  view: ShowcaseView;
  title: string;
  mounted: boolean;
}) {
  const [using, setUsing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // A window that leaves the page starts fresh next time.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when unmounted from view
    if (!mounted) setLoaded(false);
  }, [mounted]);
  return (
    <div className={s.window} data-using={using} onPointerLeave={() => setUsing(false)}>
      <div className={s.windowBar}>
        <i />
        <i />
        <i />
        <span className={s.windowTitle}>{title}</span>
        {using ? (
          <button type="button" className={s.windowBadge} onClick={() => setUsing(false)}>
            用完了，继续往下看
          </button>
        ) : (
          <span className={s.windowBadge} aria-hidden>
            真实页面
          </span>
        )}
      </div>
      <div className={s.windowBody}>
        {mounted ? (
          <iframe
            src={`${SHOWCASE_URL}?view=${view}`}
            title={`${title}（示例数据）`}
            className={s.frame}
            data-loaded={loaded}
            onLoad={() => setLoaded(true)}
            tabIndex={using ? 0 : -1}
          />
        ) : null}
        {!loaded ? <div className={s.frameLoading} aria-hidden /> : null}
        {using ? null : (
          <button type="button" className={s.shield} onClick={() => setUsing(true)}>
            <span>点一下，直接在这里试</span>
          </button>
        )}
      </div>
    </div>
  );
}

type ChapterKey = 'hero' | 'map' | 'agents' | 'closing' | `feature-${number}`;

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
    ? '测试版用 Google 账号登录。老师可在「教学」里认领课程。'
    : '用 SpeedUp 账号登录，再从课程页进入 Syntara。';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const agentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const courseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const chapterRefs = useRef(new Map<ChapterKey, HTMLElement>());
  const tiltRefs = useRef<(HTMLDivElement | null)[]>([]);
  const engineRef = useRef<WorldEngine | null>(null);
  const navFrame = useRef(0);
  const navTarget = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState<number[]>([]);
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  const setChapterRef = (key: ChapterKey) => (el: HTMLElement | null) => {
    if (el) chapterRefs.current.set(key, el);
    else chapterRefs.current.delete(key);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let lastRail = -1;
    let lastMounted = '';
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
    };

    const cursor = { x: -100, y: -100, cx: -100, cy: -100 };
    const showTip = (html: string) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (tip.dataset.text !== html) {
        tip.dataset.text = html;
        tip.innerHTML = html;
      }
      tip.style.transform = `translate(${cursor.x + 16}px, ${cursor.y - 14}px)`;
      tip.dataset.on = 'true';
    };
    const onFrame = (f: WorldFrame) => {
      const { u } = f;
      setOn('hero', inWindow(u, COPY_WINDOWS.hero));
      setOn('map', inWindow(u, COPY_WINDOWS.map));
      setOn('agents', inWindow(u, COPY_WINDOWS.agents));
      FEATURES.forEach((_, i) => setOn(`feature-${i}`, inWindow(u, COPY_WINDOWS.feature(i))));
      setOn('closing', inWindow(u, COPY_WINDOWS.closing));

      // Real pages load a little before their chapter and leave after it.
      const near = FEATURES.flatMap((_, i) => {
        const start = featureStart(i);
        return u > start - 1.1 && u < start + FEATURE_LEN + 0.4 ? [i] : [];
      });
      const key = near.join(',');
      if (key !== lastMounted) {
        lastMounted = key;
        setMounted(near);
      }

      const scrim = scrimRef.current;
      if (scrim) {
        const mode = u >= CLOSING_START + 0.4 ? 'bottom' : u > 0.6 ? 'side' : 'none';
        if (scrim.dataset.mode !== mode) scrim.dataset.mode = mode;
      }

      const rail = railIndexAt(u);
      if (rail !== lastRail) {
        lastRail = rail;
        setActive(rail);
      }

      if (f.hoverCourse >= 0) {
        const c = COURSES[f.hoverCourse];
        showTip(`<b>${c.code} · ${c.name}</b><i>${c.note}</i>`);
      } else if (f.hoverChapter >= 0) {
        showTip(
          `<b>${COURSE_NAME} 第 ${f.hoverChapter + 1} 章 · ${CHAPTERS[f.hoverChapter]}</b><i>${8 + ((f.hoverChapter * 7) % 13)} 颗记忆</i>`,
        );
      } else if (tipRef.current?.dataset.on === 'true') tipRef.current.dataset.on = 'false';

      const coursesOn = inWindow(u, COPY_WINDOWS.map);
      f.courses.forEach((pos, i) => {
        const el = courseRefs.current[i];
        if (!el) return;
        const on = coursesOn && !!pos && pos.x > 40 && pos.x < window.innerWidth - 60 && pos.y > 70;
        el.dataset.on = on ? 'true' : 'false';
        if (pos) el.style.transform = `translate(calc(${pos.x}px - 50%), ${pos.y + 26}px)`;
      });
      const agentsOn = inWindow(u, COPY_WINDOWS.agents);
      f.agents.forEach((pos, i) => {
        const el = agentRefs.current[i];
        if (!el) return;
        const on = agentsOn && !!pos && pos.x > 60 && pos.x < window.innerWidth - 60 && pos.y > 70;
        el.dataset.on = on ? 'true' : 'false';
        if (pos) el.style.transform = `translate(calc(${pos.x}px - 50%), ${pos.y - 46}px)`;
      });

      const ring = cursorRef.current;
      if (ring) {
        cursor.cx += (cursor.x - cursor.cx) * 0.22;
        cursor.cy += (cursor.y - cursor.cy) * 0.22;
        ring.style.transform = `translate(${cursor.cx}px, ${cursor.cy}px)`;
        const big =
          f.hoverCourse >= 0 ||
          f.hoverChapter >= 0 ||
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
      for (const el of tiltRefs.current) {
        el?.style.setProperty('--tx', tx.toFixed(3));
        el?.style.setProperty('--ty', ty.toFixed(3));
      }
    };
    const onLeave = () => {
      if (cursorRef.current) cursorRef.current.dataset.on = 'false';
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
    return () => {
      disposed = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      cancelAnimationFrame(navFrame.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const goTo = useCallback((index: number) => {
    index = Math.max(0, Math.min(RAIL_STOPS.length - 1, index));
    navTarget.current = index;
    cancelAnimationFrame(navFrame.current);
    navFrame.current = 0;
    const from = window.scrollY;
    const to = RAIL_STOPS[index] * window.innerHeight;
    const distance = Math.abs(to - from) / window.innerHeight;
    // Long jumps skip ahead instead of replaying every chapter in between.
    if (distance > 6 || Math.abs(to - from) < 1) {
      window.scrollTo({ top: to, behavior: 'instant' });
      engineRef.current?.setTarget(RAIL_STOPS[index], true);
      return;
    }
    const duration = 1400 + distance * 600;
    const started = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / duration);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo({ top: from + (to - from) * e, behavior: 'instant' });
      navFrame.current = p < 1 ? requestAnimationFrame(step) : 0;
      if (p === 1) engineRef.current?.setTarget(RAIL_STOPS[index], true);
    };
    navFrame.current = requestAnimationFrame(step);
  }, []);

  // Wheel, swipe and keyboard navigation use the same resting points as the rail.
  useEffect(() => {
    const wheelStep = createWheelGesture();
    let touch: { x: number; y: number; blocked: boolean } | null = null;
    const editable = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]');
    const advance = (direction: number) => {
      if (!navFrame.current) goTo(railIndexAt(window.scrollY / window.innerHeight) + direction);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || editable(event.target) || !event.deltaY) return;
      event.preventDefault();
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const direction = wheelStep(event.deltaY * unit, performance.now(), !!navFrame.current);
      if (direction) advance(direction);
    };
    const onTouchStart = (event: TouchEvent) => {
      const first = event.touches[0];
      touch =
        event.touches.length === 1 && first && !editable(event.target)
          ? { x: first.clientX, y: first.clientY, blocked: !!navFrame.current }
          : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touch = null;
        return;
      }
      const first = event.touches[0];
      if (touch && first && Math.abs(first.clientY - touch.y) > Math.abs(first.clientX - touch.x))
        event.preventDefault();
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touch;
      touch = null;
      const end = event.changedTouches[0];
      if (!start || start.blocked || !end) return;
      const direction = swipeDirection(end.clientX - start.x, end.clientY - start.y);
      if (direction) advance(direction);
    };
    const onTouchCancel = () => {
      touch = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        editable(event.target)
      )
        return;
      if (
        event.key === ' ' &&
        event.target instanceof Element &&
        event.target.closest('button, a, [role="button"]')
      )
        return;
      const direction =
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        (event.key === ' ' && !event.shiftKey)
          ? 1
          : event.key === 'ArrowUp' ||
              event.key === 'PageUp' ||
              (event.key === ' ' && event.shiftKey)
            ? -1
            : 0;
      if (!direction && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      if (event.repeat || navFrame.current) return;
      if (direction) advance(direction);
      else goTo(event.key === 'Home' ? 0 : RAIL_STOPS.length - 1);
    };
    const onScrollEnd = () => {
      if (navFrame.current) return;
      const position = window.scrollY / window.innerHeight;
      const nearest = RAIL_STOPS.reduce(
        (best, stop, index) =>
          Math.abs(stop - position) < Math.abs(RAIL_STOPS[best] - position) ? index : best,
        0,
      );
      navTarget.current = nearest;
      if (Math.abs(RAIL_STOPS[nearest] - position) * window.innerHeight >= 1) goTo(nearest);
    };
    const onResize = () => {
      cancelAnimationFrame(navFrame.current);
      navFrame.current = 0;
      const stop =
        RAIL_STOPS[navTarget.current ?? railIndexAt(window.scrollY / window.innerHeight)];
      window.scrollTo({ top: stop * window.innerHeight, behavior: 'instant' });
      engineRef.current?.setTarget(stop, true);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('resize', onResize);
    };
  }, [goTo]);

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
            <Headline
              as="h1"
              id="world-title"
              text={'没听懂的，\n回来再问。'}
              className={s.title}
            />
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
            <span className={s.kicker} data-color="blue">
              <i className={s.dotMarble} />
              {COURSES.length} 门课 · 同一片星空
            </span>
            <Headline as="h2" id="world-map" text={'很多门课，\n一片星空'} className={s.h2} />
            <p className={s.lede}>
              每门课是一团星云：章节是大弹珠，笔记、错题和没弄懂的概念绕着它转。CSC108、MAT136、CPSC
              110……课越多，星空越亮。
            </p>
            <p className={`${s.hint} ${s.hideNarrow}`}>把鼠标放到星云上，看看是哪门课</p>
          </div>
        </section>

        <section
          ref={setChapterRef('agents')}
          className={`${s.chapter} ${s.bottomNarrow}`}
          data-on="false"
          aria-labelledby="world-agents"
        >
          <div className={s.copy}>
            <span className={s.kicker} data-color="green">
              <i className={s.dotMarble} />
              AI 助手
            </span>
            <Headline as="h2" id="world-agents" text={'五个 AI，\n一起陪你学'} className={s.h2} />
            <ul className={s.agentList}>
              {AGENTS.map((a) => (
                <li key={a.name} data-color={a.color}>
                  <i className={s.dotMarble} />
                  <b>{a.name}</b>
                  <span>{a.job}</span>
                </li>
              ))}
            </ul>
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
                <Headline as="h2" id={`world-feature-${f.key}`} text={f.title} className={s.h2} />
                <p className={s.lede}>{f.body}</p>
                <ul className={s.points}>
                  {f.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className={s.windowHost}>
              <div
                ref={(el) => {
                  tiltRefs.current[i] = el;
                }}
                className={s.mockTilt}
              >
                <LiveWindow view={f.key} title={f.windowTitle} mounted={mounted.includes(i)} />
              </div>
            </div>
          </section>
        ))}

        <section
          ref={setChapterRef('closing')}
          className={`${s.chapter} ${s.closing}`}
          data-on="false"
          aria-labelledby="world-closing"
        >
          <div className={s.copy}>
            <Headline
              as="h2"
              id="world-closing"
              text={'考前复习，\n从错题开始。'}
              className={s.h2}
            />
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

      {COURSES.map((c, i) => (
        <div
          key={c.code}
          ref={(el) => {
            courseRefs.current[i] = el;
          }}
          className={`${s.tag} ${s.courseTag}`}
          data-on="false"
          aria-hidden
        >
          <b>{c.code}</b>
          <i>{c.name}</i>
        </div>
      ))}
      {AGENTS.map((a, i) => (
        <div
          key={a.name}
          ref={(el) => {
            agentRefs.current[i] = el;
          }}
          className={s.tag}
          data-color={a.color}
          data-on="false"
          aria-hidden
        >
          <i className={s.dotMarble} />
          <b>{a.name}</b>
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
