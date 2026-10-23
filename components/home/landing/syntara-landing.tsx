'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { SyntaraMark } from '@/components/brand/syntara-mark';

import { createClosingRain } from './closing-rain';
import { CalendarMock, ClassroomMock, MemoryMock, NotesMock, ProblemsMock } from './feature-mocks';
import { computeHeroLayout, createGalaxy, createHeroTitle, MARBLE_PALETTE } from './hero-canvas';
import styles from './landing.module.css';
import { computeLensLayout, createLensScene } from './lens-scene';
import { CLOSING_MARBLES, LANDING_MARBLE_STYLE } from './marble-art';
import { ScreenBackdrop, type LandingScene } from './screen-backdrop';
import {
  COVER_SWITCH,
  createMarbleSprites,
  drawPixel,
  drawRain,
  drawRoll,
  drawVortex,
  RAIN_SWITCH,
  type TransitionKind,
} from './transitions';

type MarbleColor = keyof typeof MARBLE_PALETTE;

const FEATURES: {
  key: Exclude<LandingScene, 'hero' | 'closing'>;
  color: MarbleColor;
  label: string;
  title: string;
  body: string;
  points: string[];
  transition: { kind: TransitionKind; duration: number };
  Mock: () => React.JSX.Element;
}[] = [
  {
    key: 'notes',
    color: 'blue',
    label: 'AI 笔记本',
    title: '讲义放进来，\n笔记按章节长出来',
    body: '课件、PDF 和网页整理成一章一章的笔记，每句话都标着出处，点一下就回到原文。',
    points: ['按章节整理', '每句都能找到出处', '看不懂就直接问'],
    transition: { kind: 'lens', duration: 0.6 },
    Mock: NotesMock,
  },
  {
    key: 'classroom',
    color: 'purple',
    label: 'AI 课堂',
    title: '一个知识点，\n一节几分钟的小课',
    body: '幻灯片、讲解旁白和字幕一起播放，像老师在旁边一步一步带你走。',
    points: ['讲解配旁白和字幕', '随时暂停提问', '手机上也能看'],
    transition: { kind: 'roll', duration: 0.65 },
    Mock: ClassroomMock,
  },
  {
    key: 'problems',
    color: 'amber',
    label: '题库练习',
    title: '按难度练，\n练到真的会',
    body: '基础、进阶、挑战三档题目，做完马上看到解析，错在哪里一眼就清楚。',
    points: ['三档难度', '即时解析', '错题自动记下'],
    transition: { kind: 'pixel', duration: 0.7 },
    Mock: ProblemsMock,
  },
  {
    key: 'memory',
    color: 'pink',
    label: '学习记忆',
    title: '每一次卡住，\n都变成一颗弹珠',
    body: '错题、知识盲点和你的学习偏好都会被记住。太久没复习，弹珠就会慢慢起雾。',
    points: ['错题和盲点分颜色', '久不复习会起雾', 'AI 聊天时会想起它们'],
    transition: { kind: 'rain', duration: 0.8 },
    Mock: MemoryMock,
  },
  {
    key: 'calendar',
    color: 'green',
    label: '学习日历',
    title: '作业、考试和进度，\n排在同一张日历上',
    body: '这周要交什么、哪天考试、学到第几讲，打开就知道今天该做什么。',
    points: ['作业和考试提醒', '学习进度同步', '网页和手机一起用'],
    transition: { kind: 'vortex', duration: 0.75 },
    Mock: CalendarMock,
  },
];

/** Transition into each screen: [hero, lens, ...features]. */
const SCREEN_TRANSITIONS: ({ kind: TransitionKind; duration: number } | null)[] = [
  null,
  { kind: 'galaxy', duration: 0.6 },
  ...FEATURES.map((f) => f.transition),
];
const SCREENS = SCREEN_TRANSITIONS.length;
const FIRST_FEATURE = 2;
const HOLD_TAIL = 0.5;
const RAIL: { label: string; color: MarbleColor }[] = [
  { label: '首页', color: 'purple' },
  { label: '放大', color: 'blue' },
  ...FEATURES.map((f) => ({ label: f.label, color: f.color })),
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
/** Transitions that cover the stage and swap screens underneath at a fixed point. */
const coverSwitch = (kind: TransitionKind | undefined) =>
  kind === 'rain' ? RAIN_SWITCH : kind === 'pixel' || kind === 'vortex' ? COVER_SWITCH : null;

export function SyntaraLanding({ googleTest = false }: { googleTest?: boolean }) {
  const loginHref = googleTest ? '/test' : '/login';
  const loginLabel = googleTest ? 'Google 登录体验' : 'SpeedUp 登录';
  const loginHint = googleTest
    ? '测试版使用 Google 账号登录，登录后即可进入 App。'
    : '使用 SpeedUp 账号登录后，从课程页面进入 Syntara。';
  const storyRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const galaxyCanvasRef = useRef<HTMLCanvasElement>(null);
  const titleCanvasRef = useRef<HTMLCanvasElement>(null);
  const heroCopyRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const lensCanvasRef = useRef<HTMLCanvasElement>(null);
  const lensCopyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef<HTMLElement>(null);
  const closingCanvasRef = useRef<HTMLCanvasElement>(null);
  const layerRefs = useRef<(HTMLElement | null)[]>([]);
  const heroRunning = useRef(true);
  const lensRunning = useRef(false);
  const lensFrozen = useRef(false);
  const lensApi = useRef<ReturnType<typeof createLensScene> | null>(null);
  const galaxyCenter = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Hero: galaxy + title, drawn every frame while the hero is on screen.
  useEffect(() => {
    const hero = heroRef.current;
    const galaxyCanvas = galaxyCanvasRef.current;
    const titleCanvas = titleCanvasRef.current;
    if (!hero || !galaxyCanvas || !titleCanvas) return;
    const gctx = galaxyCanvas.getContext('2d');
    const tctx = titleCanvas.getContext('2d');
    if (!gctx || !tctx) return;

    const pointer = { x: -999, y: -999, inside: false };
    let layout = computeHeroLayout(1, 1);
    let dragX: number | null = null;
    let t = 0;
    let last = performance.now();
    let raf = 0;
    let disposed = false;

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (heroRunning.current || reduced) {
        t += reduced ? 0 : dt;
        galaxy.draw(gctx, layout, t, reduced ? 0 : dt, pointer);
        tctx.clearRect(0, 0, layout.w, layout.h);
        title.draw(tctx, layout, t, reduced);
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    const schedule = () => {
      if (!disposed && !raf) raf = requestAnimationFrame(frame);
    };
    const galaxy = createGalaxy(schedule);
    const title = createHeroTitle();

    const resize = () => {
      const rect = hero.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      layout = computeHeroLayout(rect.width, rect.height);
      galaxyCenter.current = { x: layout.gx, y: layout.gy };
      for (const [canvas, ctx] of [
        [galaxyCanvas, gctx],
        [titleCanvas, tctx],
      ] as const) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      title.invalidate();
      heroCopyRef.current?.style.setProperty('--copy-top', `${title.titleBottom(layout)}px`);
      heroCopyRef.current?.style.setProperty('--copy-left', `${layout.tx}px`);
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(hero);
    resize();

    const onMove = (e: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = e.pointerType === 'mouse';
      if (dragX !== null) {
        galaxy.nudge(e.clientX - dragX);
        dragX = e.clientX;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.isPrimary && e.button === 0 && !reduced) dragX = e.clientX;
    };
    const onUp = () => {
      dragX = null;
    };
    const onLeave = () => {
      pointer.inside = false;
      dragX = null;
    };
    hero.addEventListener('pointermove', onMove);
    hero.addEventListener('pointerdown', onDown);
    hero.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    document.fonts?.ready.then(() => {
      if (disposed) return;
      title.invalidate();
      schedule();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      galaxy.dispose();
      ro.disconnect();
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerdown', onDown);
      hero.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
    };
  }, [reduced]);

  // Lens screen: a lecture page you read through a glass marble.
  useEffect(() => {
    const box = lensRef.current;
    const canvas = lensCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!box || !canvas || !ctx) return;

    const pointer = { x: -999, y: -999, inside: false };
    let layout = computeLensLayout(1, 1);
    let t = 0;
    let last = performance.now();
    let raf = 0;
    let disposed = false;

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (lensRunning.current || reduced) {
        t += reduced ? 0 : dt;
        scene.draw(ctx, layout, t, pointer, { reduced, frozen: lensFrozen.current });
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    const schedule = () => {
      if (!disposed && !raf) raf = requestAnimationFrame(frame);
    };
    const scene = createLensScene(schedule);
    lensApi.current = scene;

    const resize = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      layout = computeLensLayout(rect.width, rect.height);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene.invalidate();
      lensCopyRef.current?.style.setProperty('--copy-top', `${scene.headlineBottom(layout)}px`);
      lensCopyRef.current?.style.setProperty('--copy-left', `${layout.tx}px`);
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const onMove = (e: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = e.pointerType === 'mouse';
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerleave', onLeave);
    document.fonts?.ready.then(() => {
      if (disposed) return;
      scene.invalidate();
      schedule();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      scene.dispose();
      lensApi.current = null;
      ro.disconnect();
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced]);

  // Pinned story: every screen change is a marble moment, scrubbed by scroll (reversible).
  useEffect(() => {
    const story = storyRef.current;
    const overlay = overlayRef.current;
    const octx = overlay?.getContext('2d');
    if (!story || !overlay || !octx || reduced) return;
    let vh = window.innerHeight;
    let vw = window.innerWidth;
    let storyTop = 0;
    let raf = 0;
    let current = -1;
    const layers = layerRefs.current;
    const galaxyCanvas = galaxyCanvasRef.current;
    const titleCanvas = titleCanvasRef.current;
    const heroCopy = heroCopyRef.current;

    const measure = () => {
      vh = document.documentElement.clientHeight;
      vw = document.documentElement.clientWidth;
      story.style.setProperty('--vh', `${vh}px`);
      story.style.height = `${(SCREENS + HOLD_TAIL) * vh}px`;
      storyTop = story.getBoundingClientRect().top + window.scrollY;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      overlay.width = Math.round(vw * dpr);
      overlay.height = Math.round(vh * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const progressFor = (to: number, scroll: number) => {
      const tr = SCREEN_TRANSITIONS[to];
      if (!tr) return 1;
      return easeInOut(clamp01((scroll - to + tr.duration) / tr.duration));
    };

    const update = () => {
      raf = 0;
      const p = Math.min(SCREENS - 1 + HOLD_TAIL, Math.max(0, (window.scrollY - storyTop) / vh));
      const w = vw;
      const far = Math.hypot(w, vh);
      const from = Math.min(SCREENS - 1, Math.floor(p));
      const next = from < SCREENS - 1 && progressFor(from + 1, p) >= 0.5 ? from + 1 : from;
      const lens = lensApi.current?.position() ?? { x: w / 2, y: vh / 2, r: 80 };
      let ringShown = false;

      // Overlay marbles first: the roll wipe needs the marble's position.
      octx.clearRect(0, 0, w, vh);
      const stage = { ctx: octx, w, h: vh, sprites };
      const edges: Record<number, number> = {};
      for (let i = 1; i < SCREENS; i++) {
        const e = progressFor(i, p);
        if (e <= 0 || e >= 1) continue;
        const kind = SCREEN_TRANSITIONS[i]!.kind;
        if (kind === 'roll') edges[i] = drawRoll(stage, e);
        else if (kind === 'pixel') drawPixel(stage, e);
        else if (kind === 'rain') drawRain(stage, e);
        else if (kind === 'vortex') drawVortex(stage, e);
        else if (kind === 'lens') {
          const r = lens.r + e * (far - lens.r);
          lensApi.current?.drawShell(octx, lens.x, lens.y, r, 1 - e * 0.8);
        }
      }

      for (let i = 0; i < SCREENS; i++) {
        const layer = layers[i];
        if (!layer) continue;
        const inKind = SCREEN_TRANSITIONS[i]?.kind;
        const outKind = SCREEN_TRANSITIONS[i + 1]?.kind;
        const enter = progressFor(i, p);
        const leave = i === SCREENS - 1 ? 0 : progressFor(i + 1, p);
        const inSwitch = coverSwitch(inKind);
        const outSwitch = coverSwitch(outKind);
        const shown =
          (i === 0 || (inSwitch === null ? enter > 0 : enter >= inSwitch)) &&
          !(outSwitch === null ? leave >= 1 : leave >= outSwitch);
        layer.inert = i !== next;
        layer.setAttribute('aria-hidden', String(i !== next));
        layer.style.visibility = shown ? 'visible' : 'hidden';
        layer.style.clipPath = 'none';
        layer.style.transformOrigin = '50% 50%';
        const transforms: string[] = [];
        let opacity = 1;

        // Coming in.
        if (i > 0 && enter > 0 && enter < 1) {
          if (inKind === 'galaxy') {
            const o = galaxyCenter.current;
            const r = enter * Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, vh - o.y));
            layer.style.clipPath = `circle(${r}px at ${o.x}px ${o.y}px)`;
            const ring = ringRef.current;
            if (ring) {
              ringShown = true;
              ring.style.transform = `translate(${o.x - r}px, ${o.y - r}px)`;
              ring.style.width = ring.style.height = `${r * 2}px`;
              ring.style.opacity = String(Math.sin(enter * Math.PI));
              ring.dataset.color = RAIL[i].color;
            }
          } else if (inKind === 'lens') {
            const r = lens.r + enter * (far - lens.r);
            layer.style.clipPath = `circle(${r}px at ${lens.x}px ${lens.y}px)`;
            layer.style.transformOrigin = `${lens.x}px ${lens.y}px`;
            transforms.push(`scale(${1.4 - 0.4 * enter})`);
          } else if (inKind === 'roll') {
            layer.style.clipPath = `inset(0 ${Math.max(0, w - (edges[i] ?? 0))}px 0 0)`;
          } else if (inKind === 'pixel' && inSwitch !== null) {
            const k = clamp01((enter - inSwitch) / (1 - inSwitch));
            transforms.push(`scale(${1.08 - 0.08 * k})`);
          } else if (inKind === 'vortex' && inSwitch !== null) {
            const k = clamp01((enter - inSwitch) / (1 - inSwitch));
            layer.style.clipPath = `circle(${k * far * 0.6}px at 50% 50%)`;
            transforms.push(`rotate(${(1 - k) * -28}deg) scale(${0.6 + 0.4 * k})`);
          }
        }

        // Going out.
        if (leave > 0 && leave < 1 && i > 0) {
          if (outKind === 'lens') {
            layer.style.transformOrigin = `${lens.x}px ${lens.y}px`;
            transforms.push(`scale(${1 + leave * 0.5})`);
            opacity = 1 - leave * 0.5;
          } else if (outKind === 'roll') {
            transforms.push(`translate3d(${leave * w * 0.1}px, 0, 0)`);
          } else if (outKind === 'pixel' && outSwitch !== null) {
            transforms.push(`scale(${1 - 0.06 * clamp01(leave / outSwitch)})`);
          } else if (outKind === 'rain' && outSwitch !== null) {
            // The pile lands hard: the old screen shakes and sinks.
            const k = clamp01(leave / outSwitch);
            const shake = Math.sin(leave * 120) * 28 * k * (1 - k);
            transforms.push(`translate3d(${shake}px, ${k * vh * 0.05}px, 0)`);
          } else if (outKind === 'vortex' && outSwitch !== null) {
            const k = clamp01(leave / outSwitch);
            transforms.push(`rotate(${k * 40}deg) scale(${1 - 0.9 * k * k})`);
            opacity = 1 - k * k;
          }
        }
        layer.style.transform = transforms.join(' ');
        layer.style.opacity = String(opacity);

        if (i >= FIRST_FEATURE) {
          layer.dataset.active = shown && i === next ? 'true' : 'false';
          // Text and demo introductions play once, even when scrubbing across a boundary.
          if (shown && enter >= 0.5) layer.dataset.revealed = 'true';
        }

        if (i === 0) {
          const c = galaxyCenter.current;
          if (galaxyCanvas) {
            galaxyCanvas.style.transformOrigin = `${c.x}px ${c.y}px`;
            galaxyCanvas.style.transform = `scale(${1 + leave * 4})`;
            galaxyCanvas.style.opacity = String(1 - leave * 0.6);
          }
          const fade = String(clamp01(1 - leave * 1.8));
          if (titleCanvas) titleCanvas.style.opacity = fade;
          if (heroCopy) heroCopy.style.opacity = fade;
          heroRunning.current = leave < 1;
        }
        if (i === 1) {
          lensRunning.current = shown;
          lensFrozen.current = leave > 0;
        }
      }
      if (!ringShown && ringRef.current) ringRef.current.style.opacity = '0';

      if (next !== current) {
        current = next;
        setActive(next);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const sprites = createMarbleSprites(schedule);
    const onResize = () => {
      measure();
      schedule();
    };

    measure();
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      sprites.dispose();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      story.style.height = '';
      heroRunning.current = true;
      lensRunning.current = false;
      lensFrozen.current = false;
      octx.clearRect(0, 0, overlay.width, overlay.height);
      layers.forEach((layer) => {
        if (!layer) return;
        layer.style.clipPath = '';
        layer.style.visibility = '';
        layer.style.transform = '';
        layer.style.transformOrigin = '';
        layer.style.opacity = '';
        layer.inert = false;
        layer.removeAttribute('aria-hidden');
      });
      if (galaxyCanvas) {
        galaxyCanvas.style.transform = '';
        galaxyCanvas.style.opacity = '';
      }
      if (titleCanvas) titleCanvas.style.opacity = '';
      if (heroCopy) heroCopy.style.opacity = '';
    };
  }, [reduced]);

  // Closing: live marble rain you can push around.
  useEffect(() => {
    const section = closingRef.current;
    const canvas = closingCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!section || !canvas || !ctx) return;

    const pointer = { x: -999, y: -999, inside: false };
    let visible = false;
    let raf = 0;
    let last = performance.now();
    let disposed = false;

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.max(0, Math.min(0.033, (now - last) / 1000));
      last = now;
      rain.step(ctx, reduced ? 0 : dt, pointer);
      if (visible && !reduced) raf = requestAnimationFrame(frame);
    };
    const schedule = () => {
      if (!disposed && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const sprites = createMarbleSprites(() => {
      if (reduced) schedule();
    });
    const rain = createClosingRain(sprites);

    const resize = () => {
      const rect = section.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rain.resize(rect.width, rect.height);
      if (reduced) rain.settle();
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(section);
    resize();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
    });
    io.observe(section);

    const onMove = (e: PointerEvent) => {
      const rect = section.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = true;
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button')) return;
      rain.shake();
    };
    section.addEventListener('pointermove', onMove);
    section.addEventListener('pointerleave', onLeave);
    section.addEventListener('click', onClick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      sprites.dispose();
      ro.disconnect();
      io.disconnect();
      section.removeEventListener('pointermove', onMove);
      section.removeEventListener('pointerleave', onLeave);
      section.removeEventListener('click', onClick);
    };
  }, [reduced]);

  const goTo = useCallback(
    (index: number) => {
      const story = storyRef.current;
      if (!story) return;
      const top = story.getBoundingClientRect().top + window.scrollY;
      if (reduced) {
        layerRefs.current[index]?.scrollIntoView({ behavior: 'auto' });
        return;
      }
      window.scrollTo({
        top: top + index * document.documentElement.clientHeight,
        // Distant navigation should not replay all the intervening chapters.
        behavior: Math.abs(index - active) > 1 ? 'auto' : 'smooth',
      });
    },
    [active, reduced],
  );

  return (
    <main
      className={`${styles.root} ${reduced ? styles.reduced : ''}`}
      style={LANDING_MARBLE_STYLE}
    >
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Syntara 首页">
          <SyntaraMark className="size-8 rounded-xl" />
          <span>Syntara</span>
        </Link>
        <Link href={loginHref} className={styles.navLogin}>
          {loginLabel}
        </Link>
      </header>

      <div ref={storyRef} className={styles.story}>
        <div className={styles.stage}>
          <section
            ref={(el) => {
              layerRefs.current[0] = el;
            }}
            className={`${styles.layer} ${styles.hero}`}
            aria-labelledby="landing-title"
          >
            <ScreenBackdrop scene="hero" priority />
            <div ref={heroRef} className={styles.heroCanvasBox}>
              <canvas ref={galaxyCanvasRef} className={styles.canvas} aria-hidden />
              <canvas ref={titleCanvasRef} className={styles.canvas} aria-hidden />
            </div>
            <div ref={heroCopyRef} className={styles.heroCopy}>
              <h1 id="landing-title" className={styles.srOnly}>
                学过的，真的记得住。
              </h1>
              <p className={styles.heroLede}>
                Syntara 把讲义变成笔记和小课堂，把每次卡住记成一颗弹珠，提醒你在忘掉之前回来看看。
              </p>
              <div className={styles.heroActions}>
                <Link href={loginHref} className={styles.primary}>
                  {loginLabel}
                </Link>
                <button type="button" className={styles.ghost} onClick={() => goTo(1)}>
                  看看能做什么
                </button>
              </div>
              <p className={styles.loginHint}>{loginHint}</p>
            </div>
            <div className={styles.scrollCue} aria-hidden>
              <i />
            </div>
          </section>

          <section
            ref={(el) => {
              layerRefs.current[1] = el;
            }}
            className={`${styles.layer} ${styles.lensScreen}`}
            data-color="blue"
            aria-labelledby="lens-title"
          >
            <ScreenBackdrop scene="notes" />
            <div ref={lensRef} className={styles.lensBox}>
              <canvas ref={lensCanvasRef} className={styles.canvas} aria-hidden />
            </div>
            <div ref={lensCopyRef} className={styles.lensCopy}>
              <h2 id="lens-title" className={styles.srOnly}>
                哪一句没看懂，就放大哪一句。
              </h2>
              <p className={styles.heroLede}>
                AI 读过你的每一份讲义。哪一句看不懂就直接问，它会带着出处讲给你听。
              </p>
              <p className={styles.lensHint}>移动鼠标，把弹珠放到你看不清的地方</p>
            </div>
          </section>

          {FEATURES.map((f, i) => (
            <section
              key={f.key}
              ref={(el) => {
                layerRefs.current[i + FIRST_FEATURE] = el;
              }}
              className={`${styles.layer} ${styles.feature}`}
              data-color={f.color}
              data-transition={f.transition.kind}
              data-active={reduced ? 'true' : 'false'}
              aria-labelledby={`feature-${f.key}`}
            >
              {(reduced || Math.abs(active - (i + FIRST_FEATURE)) <= 1) && (
                <ScreenBackdrop scene={f.key} />
              )}
              <div className={styles.featureInner}>
                <div className={styles.featureText}>
                  <span className={styles.eyebrow}>
                    <i
                      className={`${styles.marble} ${styles[`m${f.color[0].toUpperCase()}${f.color.slice(1)}`]}`}
                    />
                    {f.label}
                    <span className={styles.count}>
                      {i + 1} / {FEATURES.length}
                    </span>
                  </span>
                  <h2 id={`feature-${f.key}`}>{f.title}</h2>
                  <p>{f.body}</p>
                  <ul>
                    {f.points.map((pt) => (
                      <li key={pt}>{pt}</li>
                    ))}
                  </ul>
                </div>
                <div className={styles.featureMock}>
                  <f.Mock />
                </div>
              </div>
            </section>
          ))}

          <canvas ref={overlayRef} className={styles.overlay} aria-hidden />
          <div ref={ringRef} className={styles.ring} aria-hidden />

          <nav className={styles.rail} aria-label="页面导航">
            {RAIL.map(({ label, color }, i) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                className={styles.railDot}
                data-color={color}
                aria-current={active === i ? 'step' : undefined}
                onClick={() => goTo(i)}
              >
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <section ref={closingRef} className={styles.closing} aria-labelledby="closing-title">
        <ScreenBackdrop scene="closing" />
        <canvas ref={closingCanvasRef} className={styles.closingRain} aria-hidden />
        <div className={styles.closingMarbles} aria-hidden>
          {CLOSING_MARBLES.map((art, i) => (
            <i
              key={art}
              className={styles.marble}
              style={{ '--i': i, '--marble-art': `var(--marble-${art})` } as CSSProperties}
            />
          ))}
        </div>
        <h2 id="closing-title">
          今天学的，
          <br />
          下周还记得。
        </h2>
        <p>
          {googleTest
            ? '无需下载安装，使用 Google 账号登录，就能在浏览器中体验新版 Syntara App。'
            : '网页和 iPhone 同步：在网页上拿一个激活码，手机上的聊天、笔记和课堂就都接上了。'}
        </p>
        <Link href={loginHref} className={styles.primary}>
          {loginLabel}
        </Link>
        <p className={styles.loginHint}>{loginHint}</p>
        <p className={styles.rainHint}>点一下空白处，摇一摇这些弹珠</p>
        <footer className={styles.footer}>© {new Date().getFullYear()} Syntara</footer>
      </section>
    </main>
  );
}
