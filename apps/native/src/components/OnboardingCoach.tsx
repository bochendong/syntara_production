import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { useCompactLayout } from '../lib/use-phone-layout';
import { marbleImages } from '../lib/learning-action-marbles';
import { loadNativeAuthSession, subscribeNativeAuth } from '../data/native-auth';
import { onboardingStore, PLATFORM_TUTORIAL_COURSE_ID } from '../lib/onboarding';
import { tutorialQuestion as PLATFORM_TUTORIAL_QUESTION } from '../../../../lib/onboarding/tutorial-content';
import {
  blockerRects,
  watchSpotlight,
  type CoachTarget,
  type Spot,
} from '../../../../lib/onboarding/spotlight';
import {
  configureGuide,
  finishGuide,
  getGuideStep,
  getGuideCourseId,
  setGuideStep,
  getAddedGuideCourse,
  setGuideCourses,
  type GuideStep,
} from '../lib/onboarding-guide';
import type { LocalCourseSummary } from '../domain/models';
import './onboarding-coach.css';

/** Account scope also isolates first-use feature tours on a shared device. */
export function OnboardingCoach({ courses }: { courses: LocalCourseSummary[] }) {
  const [userId, setUserId] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const update = (session: Awaited<ReturnType<typeof loadNativeAuthSession>>) => {
      const nextId = session?.user.id ?? null;
      if (cancelled || account.current === nextId) return;
      account.current = nextId;
      onboardingStore.reset();
      setUserId(nextId);
    };
    void loadNativeAuthSession()
      .then(update)
      .catch(() => undefined);
    const unsubscribe = subscribeNativeAuth(update);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  // The standalone QA page has its own explicit fixture controller.
  if (import.meta.env.DEV && location.pathname === '/onboarding-preview.html') return null;
  return userId ? <AccountCoach key={userId} userId={userId} courses={courses} /> : null;
}
function AccountCoach({ userId, courses }: { userId: string; courses: LocalCourseSummary[] }) {
  const state = useSyncExternalStore(onboardingStore.subscribe, onboardingStore.snapshot);
  useEffect(() => {
    setGuideCourses(courses);
  }, [courses]);
  useEffect(() => {
    void onboardingStore.load();
    const reload = () => {
      if (document.visibilityState === 'visible') void onboardingStore.load();
    };
    const restart = () => {
      const current = onboardingStore.snapshot();
      if (current) configureGuide(userId, current, true);
    };
    document.addEventListener('visibilitychange', reload);
    window.addEventListener('syntara:onboarding-restart', restart);
    return () => {
      document.removeEventListener('visibilitychange', reload);
      window.removeEventListener('syntara:onboarding-restart', restart);
    };
  }, [userId]);
  useEffect(() => {
    if (state) configureGuide(userId, state);
  }, [userId, state]);
  return <GuidedCoach userId={userId} />;
}

function clickVisible(selector: string) {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => {
    const rect = e.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      !e.closest('[hidden], [inert]')
    );
  });
  element?.click();
  return Boolean(element);
}
function coachPosition(hole: Spot['hole'] | undefined, width: number, height: number) {
  const pad = innerWidth <= 600 ? 12 : 18;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? innerWidth;
  const viewportHeight = viewport?.height ?? innerHeight;
  const minLeft = viewportLeft + pad;
  const minTop = viewportTop + pad;
  const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - width - pad);
  const maxTop = Math.max(minTop, viewportTop + viewportHeight - height - pad);
  if (!hole)
    return {
      left: Math.max(minLeft, viewportLeft + (viewportWidth - width) / 2),
      top: Math.max(minTop, viewportTop + (viewportHeight - height) / 2),
    };
  const candidates = [
    { left: hole.left + hole.width + pad, top: hole.top },
    { left: hole.left - width - pad, top: hole.top },
    { left: hole.left + (hole.width - width) / 2, top: hole.top + hole.height + pad },
    { left: hole.left + (hole.width - width) / 2, top: hole.top - height - pad },
  ].map((p) => ({
    left: Math.min(maxLeft, Math.max(minLeft, p.left)),
    top: Math.min(maxTop, Math.max(minTop, p.top)),
  }));
  const overlap = (p: { left: number; top: number }) =>
    Math.max(0, Math.min(p.left + width, hole.left + hole.width) - Math.max(p.left, hole.left)) *
    Math.max(0, Math.min(p.top + height, hole.top + hole.height) - Math.max(p.top, hole.top));
  return candidates.sort((a, b) => overlap(a) - overlap(b))[0];
}
const SIDEBAR_NEW_CHAT = '.phone-drawer-primary > .phone-drawer-tool:first-child';
const STORE_BACK = '.phone-page:has(.st-page) > .phone-page-header button[aria-label="返回"]';
const COURSE_TITLE = '[data-onboarding="course-menu"]';
const LEARNING_BACK =
  '.phone-page:not(:has(.st-page)) > .phone-page-header button[aria-label="返回"], [data-onboarding="page-back"]';
const CHAT_HOME = '.app-navigation-rail > button[aria-label="聊天"]';
function addedCourseHeading() {
  return `[data-guide-course-id="${CSS.escape(getGuideCourseId())}"]`;
}
type FeatureTour = 'memory' | 'progress';
type FeatureTip = { selector: string; title: string; text: string };
const featurePages: Record<FeatureTour, string> = {
  memory: '.phone-page[aria-label="学习记忆"]',
  progress: '.phone-page[aria-label="学习进度"]',
};
function visiblePage(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.closest('[hidden], [inert]');
  });
}
function featureTips(kind: FeatureTour): FeatureTip[] {
  const page = featurePages[kind];
  if (kind === 'memory') {
    if (!visiblePage(`${page} .phone-memory-layout`))
      return [
        {
          selector: page,
          title: '这里会积累你的学习记忆。',
          text: '记忆球记录错题、薄弱点、偏好、反思和学习状态。现在还没有记录，之后可以在聊天中按提示保存学习记忆，再回到这里查看。',
        },
      ];
    return [
      {
        selector: `${page} .phone-memory-visual`,
        title: '每颗球，都是一条学习记忆。',
        text: '拖动星图、缩放视图，点击记忆球查看内容；点击章节，可以聚焦那一份笔记。演示课程里的记忆球都是预置样例。',
      },
      {
        selector: `${page} .phone-memory-legend`,
        title: '按颜色找到要复习的内容。',
        text: '粉色是错题、琥珀色是薄弱点、蓝色是偏好、绿色是反思，紫色是学习状态。点击类型筛选，再点一次取消。',
      },
      {
        selector: `${page} .phone-memory-side`,
        title: '在这里查看和搜索记忆。',
        text: '点开条目看完整内容，也可以搜索关键词。学习记忆帮助后续讲解和复习更贴合你的情况，不是把全部资料抄一遍。',
      },
    ];
  }
  if (!visiblePage(`${page} .phone-progress-summary`))
    return [
      {
        selector: page,
        title: '先有笔记，再标记学习进度。',
        text: '课程中还没有笔记时，可以先上传资料。整理出笔记后，这里就能记录你学到哪一本。',
      },
    ];
  return [
    {
      selector: `${page} .phone-progress-summary`,
      title: '这里显示你已经学到哪里。',
      text: '百分比和弹珠表示已学完的笔记数量。AI 会参考你标记的学习位置和对应记忆，调整讲解与复习建议。',
    },
    {
      selector: `${page} .phone-progress-row`,
      title: '点一下笔记，标记学到这里。',
      text: '选择你实际学到的笔记，会把进度更新到这一份；再次点击当前笔记，可以退回一步。右侧书本按钮用于打开笔记，不会直接修改进度。进度由你自己标记，可以随时调整。',
    },
  ];
}
function FeatureGuide({
  onActive,
  userId,
}: {
  onActive: (value: boolean) => void;
  userId: string;
}) {
  const [tour, setTour] = useState<{ kind: FeatureTour; tips: FeatureTip[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [position, setPosition] = useState({ left: 18, top: 100 });
  const card = useRef<HTMLElement>(null);
  const current = useRef<FeatureTour | null>(null);
  const seen = useRef(new Set<FeatureTour>());
  useEffect(() => {
    const storageKey = (kind: FeatureTour) => `syntara:feature-guide:v1:${userId}:${kind}`;
    for (const kind of ['memory', 'progress'] as const) {
      try {
        if (localStorage.getItem(storageKey(kind))) seen.current.add(kind);
      } catch {
        /* Session fallback. */
      }
    }
    const scan = () => {
      if (current.current) {
        if (!visiblePage(featurePages[current.current])) {
          current.current = null;
          setTour(null);
          onActive(false);
        } else return;
      }
      for (const kind of ['memory', 'progress'] as const) {
        if (seen.current.has(kind) || !visiblePage(featurePages[kind])) continue;
        seen.current.add(kind);
        try {
          localStorage.setItem(storageKey(kind), 'seen');
        } catch {
          /* Session fallback. */
        }
        current.current = kind;
        setIndex(0);
        setSpot(null);
        setTour({ kind, tips: featureTips(kind) });
        onActive(true);
        break;
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'inert'],
    });
    scan();
    return () => observer.disconnect();
  }, [onActive, userId]);
  const finish = () => {
    if (tour?.kind === 'memory' && getGuideStep() === 'memory-tour') setGuideStep('course-menu');
    current.current = null;
    setTour(null);
    setSpot(null);
    onActive(false);
  };
  useEffect(() => {
    if (!tour) return;
    return watchSpotlight(
      'course',
      { course: [tour.tips[index]], store: [], ask: [], delete: [] },
      { onSpot: setSpot, prefill: () => undefined },
    );
  }, [tour, index]);
  useLayoutEffect(() => {
    if (!tour) return;
    const measure = () => {
      const rect = card.current?.getBoundingClientRect();
      if (rect) setPosition(coachPosition(spot?.hole, rect.width, rect.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [tour, spot]);
  useEffect(() => {
    if (!tour) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  if (!tour || !spot) return null;
  return (
    <>
      <div className="guided-mask" data-onboarding-layer="" aria-hidden="true">
        {blockerRects(spot.hole).map((rect, n) => (
          <div key={n} className="guided-blocker" style={rect} />
        ))}
        <div className="guided-lens" style={{ ...spot.hole, borderRadius: spot.hole.radius }} />
      </div>
      <aside
        ref={card}
        style={position}
        className="guided-coach"
        data-onboarding-layer=""
        aria-label={`${tour.kind === 'memory' ? '学习记忆' : '学习进度'}首次使用引导`}
      >
        <img src={marbleImages[tour.kind === 'memory' ? 'purple' : 'green']} alt="" />
        <div className="guided-coach-copy">
          <small>
            {tour.kind === 'memory' ? '学习记忆' : '学习进度'} · {index + 1} / {tour.tips.length}
          </small>
          <strong>{tour.tips[index].title}</strong>
          <p>{tour.tips[index].text}</p>
          <div className="guided-actions">
            {index > 0 && <button onClick={() => setIndex(index - 1)}>上一步</button>}
            <button onClick={() => (index + 1 < tour.tips.length ? setIndex(index + 1) : finish())}>
              {index + 1 < tour.tips.length ? '下一步' : '知道了'}
            </button>
            <button className="guided-skip" onClick={finish}>
              跳过
            </button>
          </div>
        </div>
        <button className="guided-close" aria-label="关闭首次使用引导" onClick={finish}>
          <X size={14} />
        </button>
      </aside>
    </>
  );
}
function GuidedCoach({ userId }: { userId: string }) {
  const compact = useCompactLayout();

  const [createEditing, setCreateEditing] = useState(false);
  const [step, setStep] = useState<GuideStep>(getGuideStep);
  const state = useSyncExternalStore(onboardingStore.subscribe, onboardingStore.snapshot);
  const [closed, setClosed] = useState(state?.status !== 'active');
  const [featureGuideActive, setFeatureGuideActive] = useState(false);
  const [message, setMessage] = useState('');
  const [chatReady, setChatReady] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const card = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 18, top: 100 });
  const dismiss = () => {
    if (!['create-course', 'upload'].includes(getGuideStep())) onboardingStore.skip();
    setClosed(true);
  };
  const finish = () => {
    void finishGuide()
      .then(() => setClosed(true))
      .catch(() => setMessage('保存失败，请重试。'));
  };
  useEffect(() => {
    const start = () => setClosed(false);
    window.addEventListener('syntara:guide-start', start);
    return () => window.removeEventListener('syntara:guide-start', start);
  }, []);
  useEffect(() => {
    if (state?.status !== 'active') return;
    if (state.completed.includes('store') && ['welcome', 'prepare'].includes(getGuideStep()))
      setGuideStep('return-to-chat');
  }, [state, step]);
  const enabled = state?.status === 'active' || ['create-course', 'upload'].includes(step);
  const guideVisible =
    enabled &&
    !closed &&
    !featureGuideActive &&
    !(step === 'done' && chatBusy) &&
    (step === 'create-course'
      ? !createEditing && spot?.key.includes(':.create-course-dialog')
      : step !== 'ask' || Boolean(spot));
  useLayoutEffect(() => {
    if (closed) return;
    const measure = () => {
      const rect = card.current?.getBoundingClientRect();
      if (rect) setPosition(coachPosition(spot?.hole, rect.width, rect.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [spot, closed]);
  useEffect(() => {
    if (!enabled || closed || featureGuideActive) return;
    const targets: CoachTarget[] =
      step === 'welcome'
        ? [
            {
              selector: '[data-onboarding="store"]',
              text: '去商城添加演示课程，认识平台的主要功能。',
            },
            { selector: '[data-onboarding="drawer"]', text: '先展开左侧菜单，商城入口就在里面。' },
          ]
        : step === 'create-course'
          ? [
              {
                selector: '.create-course-dialog',
                text: '给这门课起个名字。创建后，带你找到资料上传入口。',
              },
            ]
          : step === 'prepare'
            ? [
                {
                  selector: '[data-onboarding="tutorial-get"]',
                  text: '获取「Syntara 演示课程」，先认识平台的资料、聊天、练习和记忆球。',
                },
                {
                  selector: '[data-onboarding="tutorial-open"]',
                  text: '演示课程已添加，可以回到左侧课程列表查看。',
                },
                {
                  selector: '[data-onboarding="store"]',
                  text: '点击商城，添加 Syntara 演示课程。',
                },
                { selector: '[data-onboarding="drawer"]', text: '展开菜单，点击「商城」。' },
              ]
            : step === 'upload'
              ? [
                  {
                    selector: '[data-onboarding="materials-drop"]',
                    text: compact
                      ? '点击「笔记」选择课程资料。上传并整理完成后，AI 就能结合这门课里的资料回答你的问题。之后随时从课程的「资料」回到这里。'
                      : '把讲义、课件或课堂笔记拖进来，也可以点击选择文件。上传并整理完成后，AI 就能结合这门课里的资料回答你的问题。之后随时从课程的「资料」回到这里。',
                  },
                  {
                    selector: '.learning-float-stack button[aria-label="上传资料"]',
                    text: '点击这里的「＋」，就能进入课程资料上传页。',
                  },
                  {
                    selector: '[data-onboarding="tool-materials"]',
                    text: '点击「资料」，查看这门课的上传入口。',
                  },
                  {
                    selector: compact
                      ? COURSE_TITLE
                      : `${addedCourseHeading()} button[title="学习工具"]`,
                    text: compact
                      ? '课程已创建。点击顶部的课程名，再选择「资料」，就能找到上传入口。'
                      : '课程已创建。点击课程旁的「⋯」，再选择「资料」，就能找到上传入口。',
                  },
                  {
                    selector: '[data-onboarding="drawer"]',
                    text: '展开侧边栏，找到这门课旁的「⋯」学习工具。',
                  },
                ]
              : step === 'return-to-chat'
                ? [
                    { selector: CHAT_HOME, text: '点击左侧最上方的首页按钮，回到聊天和课程列表。' },
                    { selector: STORE_BACK, text: '点击左上角返回，回到课程列表。' },
                  ]
                : step === 'course-added'
                  ? [
                      {
                        selector: addedCourseHeading(),
                        text: `「${getAddedGuideCourse()?.name ?? '这门课'}」已经添加到左侧课程列表。以后都可以从这里找到它。`,
                      },
                      {
                        selector: '[data-onboarding="drawer"]',
                        text: '展开侧边栏，查看刚添加的课程。',
                      },
                    ]
                  : step === 'start-chat'
                    ? [
                        {
                          selector: SIDEBAR_NEW_CHAT,
                          text: '点击侧边栏上方的「新聊天」，开始一次新的提问。',
                        },
                        {
                          selector: '[data-onboarding="drawer"]',
                          text: '展开侧边栏，找到上方的「新聊天」。',
                        },
                      ]
                    : step === 'course-menu'
                      ? [
                          {
                            selector: '.course-tools-menu:has([data-onboarding="tool-materials"])',
                            text: compact
                              ? '课程的资料、笔记、学习进度、记忆球和课堂都在这里。以后点顶部的课程名，就能打开这个菜单。'
                              : '课程的资料、笔记和题目都在这里，也可以查看学习进度、记忆球和课堂。以后需要时，点课程旁的「⋯」就能找到。',
                          },
                          {
                            selector: compact
                              ? COURSE_TITLE
                              : `${addedCourseHeading()} button[title="学习工具"]`,
                            text: compact
                              ? '点击顶部的课程名，看看资料和学习工具都在哪里。'
                              : '最后认识一下课程菜单：点击课程旁的「⋯」，看看资料和学习工具都在哪里。',
                          },
                          {
                            selector: '[data-onboarding="drawer"]',
                            text: '展开侧边栏，找到课程旁的「⋯」。',
                          },
                          {
                            selector: LEARNING_BACK,
                            text: '先返回课程，再点顶部课程名，打开资料菜单。',
                          },
                        ]
                      : step === 'memory-tour'
                        ? [
                            {
                              selector: '.phone-memory-layout',
                              text: '这里有五颗预置示例记忆球。按颜色筛选，或点击珠子查看错题、薄弱点、偏好、反思和学习状态；这些样例不是你的真实学习记录。',
                            },
                            {
                              selector: '.learning-float-row[data-tool="memory"]',
                              text: '点击「学习记忆」，看看演示课程里的记忆球。',
                            },
                            {
                              selector: '.course-tools-menu > [role="menuitem"]:nth-child(4)',
                              text: '点击「学习记忆」，看看五种颜色的示例记忆球。',
                            },
                            {
                              selector: compact
                                ? COURSE_TITLE
                                : `${addedCourseHeading()} button[title="学习工具"]`,
                              text: compact
                                ? '点击顶部课程名，再选「学习记忆」。'
                                : '从课程旁的「⋯ → 学习记忆」查看记忆球。',
                            },
                          ]
                        : step === 'ask'
                          ? [
                              {
                                selector: `[data-onboarding="composer"][data-onboarding-course="${PLATFORM_TUTORIAL_COURSE_ID}"]`,
                                text: '写下你不理解的地方，然后点击发送。也可以先试试下面的示例。',
                                waitIdle: true,
                              },
                              {
                                selector: '.chat-scope-popover',
                                text: `选择刚添加的「${getAddedGuideCourse()?.courseCode || getAddedGuideCourse()?.name || '课程'}」，让这次聊天结合课程资料。`,
                              },
                              {
                                selector: '.general-composer .chat-scope-picker',
                                text: '先选择这次聊天所属的课程，再开始提问。',
                              },
                            ]
                          : [
                              {
                                selector: '.chat-cite',
                                text: '点一下回答里的引用，就能回到资料原文核对。',
                                waitIdle: true,
                              },
                            ];
    return watchSpotlight(
      'course',
      { course: targets, store: [], ask: [], delete: [] },
      { onSpot: setSpot, prefill: () => undefined },
    );
  }, [step, closed, featureGuideActive, compact, enabled]);
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[data-onboarding-layer]')) return;
      if (target.closest('[data-onboarding="new-course"]')) {
        setCreateEditing(false);
        setClosed(false);
        setGuideStep('create-course');
      }
      if (getGuideStep() === 'welcome' && target.closest('[data-onboarding="store"]'))
        setGuideStep('prepare');
      if (getGuideStep() === 'return-to-chat' && target.closest(`${CHAT_HOME}, ${STORE_BACK}`))
        setGuideStep('course-added');
      if (getGuideStep() === 'start-chat' && target.closest(SIDEBAR_NEW_CHAT)) setGuideStep('ask');
      if (getGuideStep() === 'done' && target.closest('.chat-cite')) setGuideStep('course-menu');
      if (
        getGuideStep() === 'course-menu' &&
        target.closest('.course-tools-menu [role="menuitem"]')
      )
        void finishGuide()
          .then(() => setClosed(true))
          .catch(() => setMessage('保存失败，请重试。'));
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('[aria-label$="首次使用引导"]')) return;
        if (!['create-course', 'upload'].includes(getGuideStep())) onboardingStore.skip();
        setClosed(true);
      }
    };
    const editing = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.create-course-dialog'))
        setCreateEditing(true);
    };
    const questionSent = () => {
      if (getGuideStep() === 'ask') setGuideStep('done');
    };
    document.addEventListener('click', follow, true);
    document.addEventListener('input', editing, true);
    window.addEventListener('syntara:onboarding-question-sent', questionSent);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', follow, true);
      document.removeEventListener('input', editing, true);
      window.removeEventListener('syntara:onboarding-question-sent', questionSent);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    const measure = () => {
      setChatReady(
        Boolean(
          document.querySelector(
            `[data-onboarding="composer"][data-onboarding-course="${PLATFORM_TUTORIAL_COURSE_ID}"]`,
          ),
        ),
      );
      setChatBusy(Boolean(document.querySelector('[data-onboarding-busy]')));
    };
    const observer = new MutationObserver(measure);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-onboarding-busy'],
    });
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => {
      setStep(getGuideStep());
      setMessage('');
    };
    window.addEventListener('syntara:guide-change', update);
    return () => window.removeEventListener('syntara:guide-change', update);
  }, []);
  const findCourse = () => {
    setGuideStep('prepare');
    if (
      !clickVisible('[data-onboarding="store"]') &&
      !clickVisible('.launch-empty-links button:first-child')
    )
      clickVisible('[data-onboarding="drawer"]');
  };
  return (
    <>
      <FeatureGuide onActive={setFeatureGuideActive} userId={userId} />
      {guideVisible && spot && (
        <div className="guided-mask" data-onboarding-layer="" aria-hidden="true">
          {blockerRects(spot.hole).map((rect, index) => (
            <div key={index} className="guided-blocker" style={rect} />
          ))}
          <div className="guided-lens" style={{ ...spot.hole, borderRadius: spot.hole.radius }} />
        </div>
      )}
      {guideVisible && (
        <aside
          ref={card}
          style={position}
          className={`guided-coach guided-coach-${step}`}
          data-onboarding-layer=""
          aria-label="新手引导"
        >
          <img src={marbleImages[step === 'done' ? 'green' : 'blue']} alt="" />
          <div className="guided-coach-copy">
            <small>
              {step === 'course-menu'
                ? '最后 · 课程菜单'
                : step === 'memory-tour'
                  ? '探索 · 记忆球'
                  : step === 'welcome'
                    ? '欢迎来到 Syntara'
                    : step === 'create-course'
                      ? '1 / 2 · 创建课程'
                      : step === 'upload'
                        ? '2 / 2 · 上传资料'
                        : step === 'prepare'
                          ? '1 / 3 · 准备一门课'
                          : step === 'return-to-chat' || step === 'course-added'
                            ? '1 / 3 · 找到你的课程'
                            : step === 'start-chat' || step === 'ask'
                              ? '2 / 3 · 问一个问题'
                              : '3 / 3 · 已经开始了'}
            </small>
            <strong>
              {step === 'course-menu'
                ? '课程资料都在这里。'
                : step === 'memory-tour'
                  ? '认识你的记忆球。'
                  : step === 'welcome'
                    ? '先用演示课程认识平台。'
                    : step === 'prepare'
                      ? '先添加一门演示课程。'
                      : step === 'create-course'
                        ? '准备你正在学的一门课。'
                        : step === 'upload'
                          ? spot?.key.includes('materials-drop')
                            ? '资料从这里上传。'
                            : '找到课程的上传入口。'
                          : step === 'return-to-chat'
                            ? '回到你的课程列表。'
                            : step === 'course-added'
                              ? '课程已添加，就在这里。'
                              : step === 'start-chat'
                                ? '从这里开始新聊天。'
                                : step === 'ask'
                                  ? chatReady
                                    ? '从你不懂的地方，问一句。'
                                    : '在这门课里开启聊天。'
                                  : '接下来，看看记忆球怎么用。'}
            </strong>
            <p>
              {message ||
                (step === 'welcome'
                  ? spot?.text || '去商城添加演示课程，体验资料、AI 聊天和记忆球。'
                  : step === 'prepare' || step === 'create-course'
                    ? spot?.text || '选一门课程，或创建自己的课程。'
                    : step === 'upload' ||
                        step === 'return-to-chat' ||
                        step === 'course-added' ||
                        step === 'start-chat'
                      ? spot?.text
                      : step === 'ask'
                        ? spot?.text || '从一个具体的问题开始。'
                        : spot?.text || '试试回答里的引用，回到原文核对。之后按需要探索其他功能。')}
            </p>
            <div className="guided-actions">
              {step === 'welcome' ? (
                <button onClick={findCourse}>
                  去商城体验 <ArrowRight size={13} />
                </button>
              ) : step === 'upload' && spot?.key.includes('materials-drop') ? (
                <button onClick={() => setClosed(true)}>
                  <Check size={13} />
                  知道了
                </button>
              ) : step === 'course-added' ? (
                <button onClick={() => setGuideStep('start-chat')}>
                  开始提问 <ArrowRight size={13} />
                </button>
              ) : step === 'ask' && chatReady ? (
                <button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('syntara:onboarding-prefill', {
                        detail: { text: PLATFORM_TUTORIAL_QUESTION },
                      }),
                    )
                  }
                >
                  填入一个示例问题 <ArrowRight size={13} />
                </button>
              ) : step === 'done' ? (
                <>
                  <button onClick={() => setGuideStep('memory-tour')}>
                    看看记忆球 <ArrowRight size={13} />
                  </button>
                  <button onClick={() => setGuideStep('course-menu')}>
                    看看课程菜单 <ArrowRight size={13} />
                  </button>
                </>
              ) : step === 'memory-tour' && spot?.key.includes('phone-memory-layout') ? (
                <button onClick={() => setGuideStep('course-menu')}>
                  看看课程菜单 <ArrowRight size={13} />
                </button>
              ) : step === 'course-menu' && spot?.key.includes('course-tools-menu:has') ? (
                <button onClick={finish}>
                  <Check size={13} />
                  完成引导
                </button>
              ) : null}
              <button className="guided-skip" onClick={dismiss}>
                稍后再说
              </button>
            </div>
          </div>
          <button className="guided-close" aria-label="收起新手引导" onClick={dismiss}>
            <X size={14} />
          </button>
        </aside>
      )}
    </>
  );
}
