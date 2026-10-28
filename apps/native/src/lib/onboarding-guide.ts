import type { LocalCourseSummary } from '../domain/models';
import { onboardingStore, PLATFORM_TUTORIAL_COURSE_ID } from './onboarding';
import type { OnboardingState } from '../../../../lib/onboarding/spotlight';

export const GUIDE_STEPS = [
  'welcome',
  'prepare',
  'create-course',
  'upload',
  'return-to-chat',
  'course-added',
  'start-chat',
  'ask',
  'done',
  'memory-tour',
  'course-menu',
] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];
let accountId = '';
let step: GuideStep = 'welcome';
let courseId = PLATFORM_TUTORIAL_COURSE_ID;
let courses: LocalCourseSummary[] = [];
let initialized = false;
const key = () => `syntara:onboarding-guide:v2:${accountId}`;
const emit = () => window.dispatchEvent(new Event('syntara:guide-change'));
export function configureGuide(userId: string, state: OnboardingState, restart = false) {
  if (initialized && accountId === userId && !restart) return;
  accountId = userId;
  initialized = true;
  courseId = PLATFORM_TUTORIAL_COURSE_ID;
  step = state.completed.includes('ask')
    ? 'course-menu'
    : state.completed.includes('store')
      ? 'course-added'
      : 'welcome';
  if (!restart) {
    try {
      const saved = JSON.parse(localStorage.getItem(key()) || 'null');
      if (saved && GUIDE_STEPS.includes(saved.step)) {
        // Creation dialogs do not survive reloads; return to the main tour.
        if (saved.step !== 'create-course') step = saved.step;
        if (typeof saved.courseId === 'string') courseId = saved.courseId;
      }
    } catch {
      /* An unavailable storage must not block the app. */
    }
  } else step = state.completed.includes('store') ? 'course-added' : 'welcome';
  emit();
  if (state.status === 'active') window.dispatchEvent(new Event('syntara:guide-start'));
}
export function setGuideCourses(next: LocalCourseSummary[]) {
  courses = next;
}
export function getGuideStep() {
  return step;
}
export function getGuideCourseId() {
  return courseId;
}
export function getAddedGuideCourse() {
  return courses.find((course) => course.id === courseId);
}
export function setGuideStep(next: GuideStep) {
  step = next;
  try {
    localStorage.setItem(key(), JSON.stringify({ step, courseId }));
  } catch {
    /* Session fallback. */
  }
  emit();
}
export function guideCourseCreated(id: string) {
  courseId = id;
  setGuideStep('upload');
}
export async function finishGuide() {
  await onboardingStore.finish();
}
