/**
 * 新手引导的共用部分（网页和 App 都用，不依赖 React）：
 * 步骤、进度存储、在页面上找真按钮、量透镜位置。
 */

/**
 * 先建自己的课，再去商城加「使用教程」，在教程里点默认问题问一句，
 * 最后把教程删掉（顺便学会删课）。
 */
export const ONBOARDING_STEPS = ['course', 'store', 'ask', 'delete'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingState = {
  status: 'active' | 'done' | 'skipped';
  /** 已经做成的步骤，按 ONBOARDING_STEPS 的顺序。 */
  completed: OnboardingStep[];
  /** 下一步；引导结束时为 null。 */
  next: OnboardingStep | null;
};

/** 进度条上每一步的弹珠颜色。 */
export const ONBOARDING_STEP_MARBLES = {
  course: 'blue',
  store: 'pink',
  ask: 'green',
  delete: 'purple',
} as const satisfies Record<OnboardingStep, string>;

/** 商城里平台自己的「使用教程」课程，新手引导会带用户加入、提问、再删掉。 */
export const PLATFORM_TUTORIAL_COURSE_ID = 'syntara-tutorial';
export const PLATFORM_TUTORIAL_QUESTION = '平台AI能做什么？';

/** 引导要预填进输入框的话，由聊天页接住。 */
export const ONBOARDING_PREFILL_EVENT = 'syntara:onboarding-prefill';

const FINISH_MS = 2400;

export type OnboardingSnapshot = OnboardingState & { celebrating?: boolean };

export type OnboardingStore = ReturnType<typeof createOnboardingStore>;

/** 进度先在本机往前走，再写到账号上；读不到就当没有引导，不挡住正常使用。 */
export function createOnboardingStore(api: {
  available: () => boolean;
  load: () => Promise<OnboardingState>;
  act: (
    payload:
      | { action: 'complete'; step: OnboardingStep }
      | { action: 'skip' }
      | { action: 'finish' }
      | { action: 'restart' },
  ) => Promise<OnboardingState>;
}) {
  let state: OnboardingSnapshot | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let generation = 0;

  function publish(next: OnboardingSnapshot | null) {
    // 从进行中变成走完，留一小会儿给「都会了」的动画。
    const celebrating =
      (state?.status === 'active' || Boolean(state?.celebrating)) &&
      next?.status === 'done' &&
      next.celebrating !== false;
    state = next && celebrating ? { ...next, celebrating } : next;
    for (const listener of listeners) listener();
    if (celebrating) {
      window.setTimeout(() => {
        if (state?.celebrating) publish({ ...state, celebrating: false });
      }, FINISH_MS);
    }
  }

  return {
    reset() {
      generation += 1;
      loading = null;
      publish(null);
    },
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(): Promise<void> {
      if (!api.available()) return Promise.resolve();
      const epoch = generation;
      loading ??= api
        .load()
        .then((next) => {
          if (epoch === generation) publish(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (epoch === generation) loading = null;
        });
      return loading;
    },
    /** 某一步真的做成了；不在引导中时什么都不做。 */
    complete(step: OnboardingStep) {
      if (!state || state.status !== 'active' || state.completed.includes(step)) return;
      const completed = ONBOARDING_STEPS.filter(
        (item) => item === step || state?.completed.includes(item),
      );
      const next = ONBOARDING_STEPS.find((item) => !completed.includes(item)) ?? null;
      publish({ status: next ? 'active' : 'done', completed, next });
      const epoch = generation;
      void api
        .act({ action: 'complete', step })
        .then((next) => {
          if (epoch === generation) publish(next);
        })
        .catch(() => undefined);
    },
    skip() {
      if (!state || state.status !== 'active') return;
      publish({ ...state, status: 'skipped', next: null });
      void api.act({ action: 'skip' }).catch(() => undefined);
    },
    async restart() {
      const epoch = generation;
      const next = await api.act({ action: 'restart' });
      if (epoch !== generation) return;
      publish(next);
      if (typeof window !== 'undefined')
        window.dispatchEvent(new Event('syntara:onboarding-restart'));
    },
    /** Version two finishes after exploring the course menu, without deleting the course. */
    async finish() {
      const epoch = generation;
      const next = await api.act({ action: 'finish' });
      if (epoch === generation) publish(next);
    },
  };
}

export type CoachTarget = {
  /** 页面上的真按钮，引导只圈住它，用户点的就是它。 */
  selector: string;
  text: string;
  /** 圈住输入框时顺手填进去的一句话。 */
  prefill?: string;
  /** 这个元素可见时跳过当前目标（比如已经在聊天页，就不用再圈「聊天」标签）。 */
  unless?: string;
  /** AI 还在回答时先不圈（比如等教程的回答说完再引导删课）。 */
  waitIdle?: boolean;
};

export type CoachTargets = Record<OnboardingStep, CoachTarget[]>;

export type Spot = {
  key: string;
  text: string;
  hole: { top: number; left: number; width: number; height: number; radius: number };
};

const HOLE_PADDING = 6;
const BUBBLE_GAP = 14;
const BUBBLE_WIDTH = 220;

function isLayer(element: Element) {
  return Boolean(element.closest('[data-onboarding-layer]'));
}

/** 元素在屏幕上，而且没被弹窗之类盖住（引导自己的遮罩不算）。 */
function visibleElement(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
    const top = document.elementsFromPoint(x, y).find((item) => !isLayer(item));
    if (top && (element === top || element.contains(top))) return element;
  }
  return null;
}

/** 有尺寸但在屏幕外的元素（比如手机上要往下滚才看得到的课程图标）。 */
function offscreenElement(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.top < 0 || rect.bottom > window.innerHeight) return element;
  }
  return null;
}

/** 当前这一步该圈哪里；正在回答时返回 'hold'，先不打扰。 */
function resolveTarget(targets: CoachTarget[]) {
  for (const target of targets) {
    if (target.waitIdle && document.querySelector('[data-onboarding-busy]')) return 'hold' as const;
    if (target.unless && visibleElement(target.unless)) continue;
    const element = visibleElement(target.selector);
    if (!element) continue;
    if (element.closest('[data-onboarding-busy]')) return 'hold' as const;
    return { target, element };
  }
  return null;
}

/** 哪个目标都看不见时，找一个滚一下就能看见的。 */
function scrollableTarget(targets: CoachTarget[]) {
  for (const target of targets) {
    if (target.unless && visibleElement(target.unless)) continue;
    const element = offscreenElement(target.selector);
    if (element) return { target, element };
  }
  return null;
}

function holeFor(element: HTMLElement): Spot['hole'] {
  const rect = element.getBoundingClientRect();
  const width = rect.width + HOLE_PADDING * 2;
  const height = rect.height + HOLE_PADDING * 2;
  return {
    top: rect.top - HOLE_PADDING,
    left: rect.left - HOLE_PADDING,
    width,
    height,
    radius: Math.min(height / 2, 28),
  };
}

function sameSpot(a: Spot | null, b: Spot | null) {
  if (!a || !b) return a === b;
  return (
    a.key === b.key &&
    Math.abs(a.hole.top - b.hole.top) < 0.5 &&
    Math.abs(a.hole.left - b.hole.left) < 0.5 &&
    Math.abs(a.hole.width - b.hole.width) < 0.5 &&
    Math.abs(a.hole.height - b.hole.height) < 0.5
  );
}

/** 盯着页面找这一步的真按钮，量好透镜位置交给 onSpot。返回停止函数。 */
export function watchSpotlight(
  step: OnboardingStep,
  targets: CoachTargets,
  handlers: {
    onSpot: (update: (current: Spot | null) => Spot | null) => void;
    prefill: (text: string) => void;
  },
) {
  const prefilled = new Set<string>();
  const scrolled = new Set<string>();
  const measure = () => {
    const resolved = resolveTarget(targets[step]);
    if (resolved === 'hold') {
      handlers.onSpot(() => null);
      return;
    }
    if (!resolved) {
      handlers.onSpot(() => null);
      const hidden = scrollableTarget(targets[step]);
      const scrollKey = hidden && `${step}:${hidden.target.selector}`;
      if (hidden && scrollKey && !scrolled.has(scrollKey)) {
        scrolled.add(scrollKey);
        hidden.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    const { target, element } = resolved;
    const key = `${step}:${target.selector}`;
    if (target.prefill && !prefilled.has(key)) {
      prefilled.add(key);
      handlers.prefill(target.prefill);
    }
    const next: Spot = { key, text: target.text, hole: holeFor(element) };
    handlers.onSpot((current) => (sameSpot(current, next) ? current : next));
  };
  measure();
  const timer = window.setInterval(measure, 180);
  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, true);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('resize', measure);
    window.removeEventListener('scroll', measure, true);
  };
}

/** 气泡放在透镜下面，放不下就放上面；左右不出屏幕。 */
export function bubblePlacement(hole: Spot['hole']) {
  const below = window.innerHeight - (hole.top + hole.height) > 120;
  const above = hole.top > 120;
  return {
    below,
    top: below
      ? hole.top + hole.height + BUBBLE_GAP
      : above
        ? undefined
        : hole.top + hole.height - 96,
    bottom: !below && above ? window.innerHeight - hole.top + BUBBLE_GAP : undefined,
    left: Math.min(
      Math.max(12, hole.left + hole.width / 2 - BUBBLE_WIDTH / 2),
      window.innerWidth - BUBBLE_WIDTH - 12,
    ),
  };
}

/** 四块挡板盖住透镜外面，透镜里的真按钮照常能点。 */
export function blockerRects(hole: Spot['hole']) {
  return [
    { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) },
    { top: hole.top + hole.height, left: 0, right: 0, bottom: 0 },
    { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
    { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
  ];
}

export function prefillOnboardingDraft(text: string) {
  window.dispatchEvent(new CustomEvent(ONBOARDING_PREFILL_EVENT, { detail: { text } }));
}
