import {
  getLocalizedProblemContent,
  hasProblemTranslation,
  type ProblemContentLanguage,
  type LocalizableProblemContent,
} from '../../../../lib/problem-bank/i18n';
import type { LocalProblem } from '../domain/models';
import { splitNotebookName } from './notebook-reading';

export type { ProblemContentLanguage } from '../../../../lib/problem-bank/i18n';

export function hasBilingualProblem(problem: LocalProblem): boolean {
  return hasProblemTranslation({
    title: problem.title,
    publicContent: problem.publicContent as LocalizableProblemContent,
  });
}

/** Localize only the presentation; attempts and grading keep the original record. */
export function localizeProblem(
  problem: LocalProblem,
  language: ProblemContentLanguage,
): LocalProblem {
  const publicContent = getLocalizedProblemContent(
    problem.publicContent as LocalizableProblemContent,
    language,
  );
  const translatedStem = 'stem' in publicContent ? publicContent.stem : undefined;
  const translation = publicContent.translations?.[language];
  // 课程已按教学顺序编号时，以当前章节为准，旧题面中的译名不能覆盖重新归类的结果。
  const numberedCourseChapter = Boolean(
    problem.chapterId && problem.chapterName && splitNotebookName(problem.chapterName).number,
  );
  return {
    ...problem,
    publicContent,
    ...(translation?.chapterName && !numberedCourseChapter
      ? { chapterName: translation.chapterName }
      : {}),
    title:
      translation?.title ??
      (typeof translatedStem === 'string' && translatedStem !== problem.publicContent.stem
        ? translatedStem.replace(/\s+/g, ' ')
        : problem.title),
  };
}
