import { createOnboardingStore, type OnboardingState, type OnboardingStep } from './spotlight';

async function request(init?: RequestInit): Promise<OnboardingState> {
  const response = await fetch('/api/onboarding', {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error(`onboarding ${response.status}`);
  const body = (await response.json()) as { onboarding: OnboardingState };
  return body.onboarding;
}

/** 网页的新手引导进度，和 App 共用账号上的同一份。 */
export const webOnboardingStore = createOnboardingStore({
  available: () => typeof window !== 'undefined',
  load: () => request(),
  act: (payload) => request({ method: 'POST', body: JSON.stringify(payload) }),
});

export function completeWebOnboardingStep(step: OnboardingStep) {
  webOnboardingStore.complete(step);
}
