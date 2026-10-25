'use client';

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LANDING_MARBLE_ART } from '@/components/home/landing/marble-art';
import {
  blockerRects,
  bubblePlacement,
  ONBOARDING_STEP_MARBLES,
  ONBOARDING_STEPS,
  PLATFORM_TUTORIAL_COURSE_ID,
  PLATFORM_TUTORIAL_QUESTION,
  prefillOnboardingDraft,
  watchSpotlight,
  type CoachTargets,
  type Spot,
} from '@/lib/onboarding/spotlight';
import { webOnboardingStore } from '@/lib/onboarding/web-store';
import { useAuthStore } from '@/lib/store/auth';
import './web-onboarding-coach.css';

const TUTORIAL_ICON = `[data-home-icon-id="${PLATFORM_TUTORIAL_COURSE_ID}"]`;

/** 和 App 同样的四步，只是圈住网页上的真按钮。 */
const TARGETS: CoachTargets = {
  course: [{ selector: '[data-home-icon-id="create"]', text: '先建一门自己的课' }],
  store: [
    { selector: '[data-onboarding="tutorial-get"]', text: '加「使用教程」' },
    { selector: '[data-home-icon-id="store"]', text: '去商城' },
    { selector: '[data-onboarding="home"]', text: '回到主页' },
  ],
  ask: [
    {
      selector: `[data-onboarding="composer"][data-onboarding-course="${PLATFORM_TUTORIAL_COURSE_ID}"]`,
      text: '问它一句',
      prefill: PLATFORM_TUTORIAL_QUESTION,
    },
    { selector: TUTORIAL_ICON, text: '打开教程' },
    { selector: '[data-onboarding="home"]', text: '回到主页' },
  ],
  delete: [
    { selector: '[data-onboarding="course-delete-confirm"]', text: '删掉它', waitIdle: true },
    { selector: '[data-onboarding="course-delete"]', text: '删除', waitIdle: true },
    { selector: '[data-onboarding="home"]', text: '回到主页', waitIdle: true },
  ],
};

/** 只给学生账号用；老师和没登录时什么都不渲染。 */
export function WebOnboardingCoach() {
  const signedIn = useAuthStore((state) => state.isLoggedIn && Boolean(state.userId));
  const role = useAuthStore((state) => state.role);
  if (!signedIn || role === 'TEACHER') return null;
  return <Coach />;
}

function Coach() {
  const state = useSyncExternalStore(
    webOnboardingStore.subscribe,
    webOnboardingStore.snapshot,
    () => null,
  );
  const [spot, setSpot] = useState<Spot | null>(null);
  const step = state?.status === 'active' ? state.next : null;

  useEffect(() => {
    void webOnboardingStore.load();
    // 回到这个标签页时再读一次：可能在 App 上已经走完了。
    const reload = () => {
      if (document.visibilityState === 'visible') void webOnboardingStore.load();
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
            <img key={item} src={LANDING_MARBLE_ART[ONBOARDING_STEP_MARBLES[item]].src} alt="" />
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
                <img
                  key={item}
                  src={LANDING_MARBLE_ART[ONBOARDING_STEP_MARBLES[item]].src}
                  alt=""
                />
              ) : (
                <i key={item} className={item === step ? 'is-current' : undefined} />
              ),
            )}
          </span>
          <button type="button" onClick={webOnboardingStore.skip}>
            跳过
          </button>
        </span>
      </div>
    </div>,
    document.body,
  );
}
