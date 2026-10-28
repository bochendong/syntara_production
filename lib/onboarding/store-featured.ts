import { PLATFORM_TUTORIAL_COURSE_ID } from './spotlight';

/** The real catalog can rank many popular courses above the zero-enrollment tutorial. */
export function onboardingFeaturedCourses<T extends { id: string }>(ranked: T[], active: boolean) {
  const tutorial = active
    ? ranked.find((course) => course.id === PLATFORM_TUTORIAL_COURSE_ID)
    : null;
  return (
    tutorial ? [tutorial, ...ranked.filter((course) => course.id !== tutorial.id)] : ranked
  ).slice(0, 5);
}
