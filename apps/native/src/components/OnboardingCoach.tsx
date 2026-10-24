import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { marbleImages } from '../lib/learning-action-marbles';
import { onboardingStore, ONBOARDING_STEPS } from '../lib/onboarding';
import {
  blockerRects,
  bubblePlacement,
  ONBOARDING_STEP_MARBLES,
  prefillOnboardingDraft,
  watchSpotlight,
  type CoachTargets,
  type Spot,
} from '../../../../lib/onboarding/spotlight';
import './onboarding-coach.css';

const CHAT_TAB = {
  selector: '[data-onboarding="chat-tab"]',
  text: '回到聊天',
  unless: '[data-onboarding="composer"]',
};
// 手机和窄窗口没有标签，学习页左上角是返回。
const PAGE_BACK = {
  selector: '[data-onboarding="page-back"]',
  text: '回到聊天',
  unless: '[data-onboarding="composer"]',
};

/** 每一步按顺序找第一个看得见的真按钮（带 data-onboarding）。 */
const TARGETS: CoachTargets = {
  course: [
    { selector: '[data-onboarding="new-course"]', text: '先建一门自己的课' },
    { selector: '[data-onboarding="drawer"]', text: '课程在这里' },
  ],
  materials: [
    { selector: '[data-onboarding="materials-drop"]', text: '把笔记拖进来' },
    { selector: '[data-onboarding="tool-materials"]', text: '打开资料' },
    { selector: '[data-onboarding="course-menu"]', text: '资料在这里' },
    { selector: '[data-onboarding="course-tools"]', text: '资料在这里' },
    { selector: '[data-onboarding="drawer"]', text: '资料在这里' },
  ],
  ask: [
    {
      selector: '[data-onboarding="composer"]',
      text: '问它一句',
      prefill: '用我的资料，讲讲第一部分',
    },
    CHAT_TAB,
    PAGE_BACK,
  ],
  remember: [
    { selector: '[data-onboarding="remember"]', text: '接住它' },
    {
      selector: '[data-onboarding="composer"]',
      text: '让它记住你',
      prefill: '记住：我刚开始学这门课，讲慢一点',
    },
    CHAT_TAB,
    PAGE_BACK,
  ],
  store: [
    { selector: '[data-onboarding="store"]', text: '学校的课在这' },
    { selector: '[data-onboarding="drawer"]', text: '商城在这里' },
  ],
};

/**
 * 新手引导：暗色遮罩上开一个玻璃透镜，只圈住真按钮，只有透镜里能点。
 * 真的做成了（建好课、资料入库、发出第一句、记住、打开商城）才走到下一步。
 */
export function OnboardingCoach() {
  const state = useSyncExternalStore(onboardingStore.subscribe, onboardingStore.snapshot);
  const [spot, setSpot] = useState<Spot | null>(null);
  const step = state?.status === 'active' ? state.next : null;

  useEffect(() => {
    void onboardingStore.load();
    // 换回窗口时再读一次：可能在别的设备上已经走完了。
    const reload = () => {
      if (document.visibilityState === 'visible') void onboardingStore.load();
    };
    document.addEventListener('visibilitychange', reload);
    return () => document.removeEventListener('visibilitychange', reload);
  }, []);

  useLayoutEffect(() => {
    if (!step) return;
    return watchSpotlight(step, TARGETS, {
      onSpot: setSpot,
      prefill: prefillOnboardingDraft,
      complete: onboardingStore.complete,
    });
  }, [step]);

  if (state?.celebrating) {
    return createPortal(
      <div className="onboarding-finish" data-onboarding-layer role="status">
        <span className="onboarding-finish-marbles" aria-hidden>
          {ONBOARDING_STEPS.map((item) => (
            <img key={item} src={marbleImages[ONBOARDING_STEP_MARBLES[item]]} alt="" />
          ))}
        </span>
        <strong>都会了</strong>
      </div>,
      document.body,
    );
  }
  // 换了一步还没量到新位置时，不显示上一步的透镜。
  if (!step || !spot || !state || !spot.key.startsWith(`${step}:`)) return null;

  const { hole } = spot;
  const bubble = bubblePlacement(hole);
  return createPortal(
    <div className="onboarding-coach" data-onboarding-layer>
      {blockerRects(hole).map((rect, index) => (
        <div key={index} className="onboarding-blocker" style={rect} />
      ))}
      <div
        className="onboarding-lens"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          borderRadius: hole.radius,
        }}
        aria-hidden
      />
      <div
        key={spot.key}
        className={`onboarding-bubble${bubble.below ? ' is-below' : ' is-above'}`}
        style={{ top: bubble.top, bottom: bubble.bottom, left: bubble.left }}
        role="dialog"
        aria-live="polite"
        aria-label="新手引导"
      >
        <strong>{spot.text}</strong>
        <span className="onboarding-bubble-row">
          <span
            className="onboarding-progress"
            aria-label={`第 ${state.completed.length + 1} 步，共 ${ONBOARDING_STEPS.length} 步`}
          >
            {ONBOARDING_STEPS.map((item) =>
              state.completed.includes(item) ? (
                <img key={item} src={marbleImages[ONBOARDING_STEP_MARBLES[item]]} alt="" />
              ) : (
                <i key={item} className={item === step ? 'is-current' : undefined} />
              ),
            )}
          </span>
          <button type="button" onClick={onboardingStore.skip}>
            跳过
          </button>
        </span>
      </div>
    </div>,
    document.body,
  );
}
