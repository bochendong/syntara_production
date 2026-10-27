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

/** Interpret either language's stored checkpoint as the same completed lecture. */
export function notebookProgressCount(
  notebooks: LocalNotebook[],
  state: { completedNotebookCount: number; currentNotebookId: string | null } | null,
): number {
  if (!state || state.completedNotebookCount <= 0) return 0;
  const groups = groupNotebookTranslations(notebooks);
  const index = state.currentNotebookId
    ? groups.findIndex((notebook) =>
        notebookVariants(notebooks, notebook.id).some(
          (variant) => variant.id === state.currentNotebookId,
        ),
      )
    : -1;
  return index >= 0 ? index + 1 : Math.min(groups.length, state.completedNotebookCount);
}

/** A completed bilingual lecture makes both language editions readable to the AI. */
export function readableProgressNotebooks(
  notebooks: LocalNotebook[],
  count: number,
): LocalNotebook[] {
  return groupNotebookTranslations(notebooks)
    .slice(0, Math.max(0, count))
    .flatMap((notebook) => notebookVariants(notebooks, notebook.id));
}

/** Map a server checkpoint, including an English edition ID, to the lecture count. */
export function checkpointProgressCount(
  notebooks: LocalNotebook[],
  kind: string,
  notebookId: string | null,
): number {
  const groups = groupNotebookTranslations(notebooks);
  if (kind === 'completed_all') return groups.length;
  if (kind !== 'notebook' || !notebookId) return 0;
  const index = groups.findIndex((notebook) =>
    notebookVariants(notebooks, notebook.id).some((variant) => variant.id === notebookId),
  );
  return index < 0 ? 0 : index + 1;
}
