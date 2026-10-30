export type ProblemContentLanguage = 'zh-CN' | 'en-US';

/** Structural contract shared with the native client, without server schema dependencies. */
export type LocalizableProblemContent = {
  type: string;
  stem?: string;
  stemTemplate?: string;
  explanation?: string;
  options?: Array<{ id: string; label: string }>;
  parts?: Array<{ label: string; content: LocalizableProblemContent }>;
  translations?: Partial<
    Record<
      ProblemContentLanguage,
      {
        title?: string;
        chapterName?: string;
        stem?: string;
        stemTemplate?: string;
        explanation?: string;
        options?: Array<{ id: string; label: string }>;
      }
    >
  >;
};

export type LocalizableProblemRecord = {
  title: string;
  publicContent: LocalizableProblemContent;
  sourceMeta?: Record<string, unknown> | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readTitleTranslation(
  sourceMeta: Record<string, unknown> | null | undefined,
  language: ProblemContentLanguage,
): string | null {
  const meta = readRecord(sourceMeta);
  const translations = readRecord(meta?.translations);
  const languageTranslations = readRecord(translations?.[language]);
  const title = languageTranslations?.title;
  return typeof title === 'string' && title.trim() ? title : null;
}

export function getLocalizedProblemTitle(
  problem: LocalizableProblemRecord,
  language: ProblemContentLanguage,
): string {
  return (
    problem.publicContent.translations?.[language]?.title ??
    readTitleTranslation(problem.sourceMeta, language) ??
    problem.title
  );
}

export function getLocalizedProblemContent<T extends LocalizableProblemContent>(
  content: T,
  language: ProblemContentLanguage,
): T {
  const translation = content.translations?.[language];
  const next = { ...content };
  if (content.type === 'multipart' && content.parts)
    next.parts = content.parts.map((part) => ({
      ...part,
      content: getLocalizedProblemContent(part.content, language),
    }));
  if (!translation) return next as T;
  if ('stem' in next && translation.stem) {
    next.stem = translation.stem;
  }
  if (next.type === 'fill_blank' && (translation.stemTemplate || translation.stem)) {
    next.stemTemplate = translation.stemTemplate || translation.stem;
  }
  if (translation.explanation) {
    next.explanation = translation.explanation;
  }
  if (next.type === 'choice' && translation.options?.length) {
    const labelsById = new Map(translation.options.map((option) => [option.id, option.label]));
    next.options = next.options?.map((option) => ({
      ...option,
      label: labelsById.get(option.id) ?? option.label,
    }));
  }

  return next as T;
}

function contentHasTranslation(
  content: LocalizableProblemContent,
  language: ProblemContentLanguage,
): boolean {
  const translation = content.translations?.[language];
  return Boolean(
    translation?.title ||
    translation?.chapterName ||
    translation?.stem ||
    translation?.stemTemplate ||
    translation?.explanation ||
    translation?.options?.length ||
    content.parts?.some((part) => contentHasTranslation(part.content, language)),
  );
}

/** With no language specified, detect either translation so both kinds of base work. */
export function hasProblemTranslation(
  problem: LocalizableProblemRecord | null | undefined,
  language?: ProblemContentLanguage,
): boolean {
  if (!problem) return false;
  const languages: ProblemContentLanguage[] = language ? [language] : ['zh-CN', 'en-US'];
  return languages.some(
    (locale) =>
      Boolean(readTitleTranslation(problem.sourceMeta, locale)) ||
      contentHasTranslation(problem.publicContent, locale),
  );
}
