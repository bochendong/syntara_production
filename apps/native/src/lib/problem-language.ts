import {
  getLocalizedProblemContent,
  hasProblemTranslation,
  type ProblemContentLanguage,
  type LocalizableProblemContent,
} from '../../../../lib/problem-bank/i18n';
import type { LocalProblem } from '../domain/models';

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
  const translation = language === 'zh-CN' ? publicContent.translations?.[language] : undefined;
  return {
    ...problem,
    publicContent,
    ...(translation?.chapterName ? { chapterName: translation.chapterName } : {}),
    title:
      translation?.title ??
      (language === 'zh-CN' &&
      typeof translatedStem === 'string' &&
      translatedStem !== problem.publicContent.stem
        ? translatedStem.replace(/\s+/g, ' ')
        : problem.title),
  };
}
