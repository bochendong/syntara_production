import type { LocalNotebook } from '../domain/models';

export type NotebookLanguage = 'zh-CN' | 'en';

export function notebookLanguage(notebook: LocalNotebook): NotebookLanguage | null {
  if (notebook.tags.includes('translation-language:zh-CN')) return 'zh-CN';
  if (notebook.tags.includes('translation-language:en')) return 'en';
  return null;
}

function translationKey(notebook: LocalNotebook): string | null {
  const source = notebook.tags.find((tag) => /^translation-source:[a-f0-9]{64}$/.test(tag));
  return source && notebookLanguage(notebook)
    ? `${notebook.courseId}:${notebook.kind}:${source}`
    : null;
}

/** Pair only explicit source matches with exactly one edition per language. */
export function notebookVariants(notebooks: LocalNotebook[], notebookId: string): LocalNotebook[] {
  const notebook = notebooks.find((item) => item.id === notebookId);
  if (!notebook) return [];
  const key = translationKey(notebook);
  if (!key) return [notebook];
  const matches = notebooks.filter((item) => translationKey(item) === key);
  return matches.length === 2 && new Set(matches.map(notebookLanguage)).size === 2
    ? matches.sort((a) => (notebookLanguage(a) === 'zh-CN' ? -1 : 1))
    : [notebook];
}

export function notebookDisplayName(notebook: LocalNotebook): string {
  return notebookLanguage(notebook)
    ? notebook.name.replace(/^\s*\[(?:EN|中文)\]\s*/i, '')
    : notebook.name;
}

/** Keep both stored documents; show each bilingual lecture once in the library. */
export function groupNotebookTranslations(notebooks: LocalNotebook[]): LocalNotebook[] {
  const seen = new Set<string>();
  return notebooks
    .flatMap((notebook) => {
      if (seen.has(notebook.id)) return [];
      const variants = notebookVariants(notebooks, notebook.id);
      for (const variant of variants) seen.add(variant.id);
      const representative = variants[0];
      return [{ ...representative, name: notebookDisplayName(representative) }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

export function notebookSearchText(notebooks: LocalNotebook[], notebookId: string): string {
  return notebookVariants(notebooks, notebookId)
    .map((item) => item.name)
    .join('\n')
    .toLowerCase();
}
