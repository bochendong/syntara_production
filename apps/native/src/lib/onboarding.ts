import { platformAvailable } from '../data/browser-runtime';
import { getNativeOnboarding, nativeOnboardingAction } from '../data/platform-api-client';
import {
  createOnboardingStore,
  ONBOARDING_PREFILL_EVENT,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../../../../lib/onboarding/spotlight';

export { ONBOARDING_PREFILL_EVENT, ONBOARDING_STEPS };

/** App 的新手引导进度，存在账号上，换设备也接着上一步。 */
export const onboardingStore = createOnboardingStore({
  available: platformAvailable,
  load: getNativeOnboarding,
  act: nativeOnboardingAction,
});

export function completeOnboardingStep(step: OnboardingStep) {
  onboardingStore.complete(step);
}
