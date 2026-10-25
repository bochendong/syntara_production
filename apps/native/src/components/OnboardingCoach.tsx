import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { marbleImages } from '../lib/learning-action-marbles';
import {
  onboardingStore,
  ONBOARDING_STEPS,
  PLATFORM_TUTORIAL_COURSE_ID,
  PLATFORM_TUTORIAL_QUESTION,
} from '../lib/onboarding';
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

const TUTORIAL_COMPOSER = `[data-onboarding="composer"][data-onboarding-course="${PLATFORM_TUTORIAL_COURSE_ID}"]`;

/** 每一步按顺序找第一个看得见的真按钮（带 data-onboarding）。 */
const TARGETS: CoachTargets = {
  course: [
    { selector: '[data-onboarding="new-course"]', text: '先建一门自己的课' },
    { selector: '[data-onboarding="drawer"]', text: '课程在这里' },
  ],
  store: [
    { selector: '[data-onboarding="tutorial-get"]', text: '加「使用教程」' },
    { selector: '[data-onboarding="store"]', text: '去商城' },
    { selector: '[data-onboarding="drawer"]', text: '商城在这里' },
  ],
  ask: [
    { selector: '[data-onboarding="tutorial-ask"]', text: '点它问问' },
    { selector: TUTORIAL_COMPOSER, text: '问它一句', prefill: PLATFORM_TUTORIAL_QUESTION },
    { selector: '[data-onboarding="tutorial-open"]', text: '打开教程' },
    { selector: '[data-onboarding="tutorial-chat"]', text: '打开教程' },
    { selector: '[data-onboarding="tutorial-course-menu"]', text: '打开教程' },
    { selector: '[data-onboarding="drawer"]', text: '教程在这里' },
  ],
  // 等教程回答完再引导删掉它，顺便学会删课。
  delete: [
    { selector: '[data-onboarding="course-delete-confirm"]', text: '删掉它', waitIdle: true },
    { selector: '[data-onboarding="course-delete"]', text: '删除', waitIdle: true },
    {
      selector: '[data-onboarding="tutorial-course-menu"]',
      text: '用完就删掉',
      waitIdle: true,
    },
    { selector: '[data-onboarding="drawer"]', text: '用完就删掉', waitIdle: true },
  ],
};

/**
 * 新手引导：暗色遮罩上开一个玻璃透镜，只圈住真按钮，只有透镜里能点。
 * 真的做成了（建好课、加入教程、在教程里问一句、删掉教程）才走到下一步。
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
