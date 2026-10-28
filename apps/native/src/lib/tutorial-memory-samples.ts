import type { LocalStudyMemory } from '../domain/models';
import { PLATFORM_TUTORIAL_COURSE_ID } from '../../../../lib/onboarding/spotlight';
import {
  TUTORIAL_NOTEBOOK_ID,
  tutorialMemorySamples,
} from '../../../../lib/onboarding/tutorial-content';

/** Display-only examples: never persisted or supplied to the learner model. */
export function tutorialMemorySamplesForView(courseId: string): LocalStudyMemory[] {
  if (courseId !== PLATFORM_TUTORIAL_COURSE_ID) return [];
  return tutorialMemorySamples.map(([kind, title, text], index) => ({
    id: `platform-tutorial-example-${index}`,
    courseId,
    notebookId: TUTORIAL_NOTEBOOK_ID,
    targetType: 'course',
    scope: 'private',
    kind,
    status: 'active',
    source: 'platform-tutorial-example',
    title,
    text,
    reason: '平台演示样例，不代表你的真实学习记录。',
    question: null,
    sourceReferences: [],
    confidence: null,
    createdAt: 1793232000000,
    updatedAt: 1793232000000,
  }));
}
