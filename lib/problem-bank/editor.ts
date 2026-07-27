import type { NotebookProblemImportDraft } from './schema';
import { notebookProblemImportDraftSchema } from './schema';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';

export function problemRecordToDraft(
  problem: NotebookProblemClientRecord,
): NotebookProblemImportDraft {
  return notebookProblemImportDraftSchema.parse({
    draftId: problem.id,
    notebookId: problem.notebookId ?? null,
    title: problem.title,
    type: problem.type,
    status: problem.status,
    source: problem.source,
    points: problem.points,
    tags: problem.tags,
    difficulty: problem.difficulty,
    publicContent: problem.publicContent,
    grading: problem.grading,
    secretJudge:
      'secretJudge' in problem ? (problem as { secretJudge?: unknown }).secretJudge : undefined,
    sourceMeta: {
      ...(problem.sourceMeta || {}),
      importMode: 'problem_edit',
      preserveExistingSecretJudge:
        problem.type === 'code' &&
        problem.publicContent.type === 'code' &&
        problem.publicContent.secretConfigPresent,
    },
    validationErrors: [],
  });
}

export function problemDraftToPatch(draft: NotebookProblemImportDraft) {
  const patch: {
    title: string;
    status: NotebookProblemImportDraft['status'];
    points: number;
    tags: string[];
    difficulty: NotebookProblemImportDraft['difficulty'];
    publicContent: NotebookProblemImportDraft['publicContent'];
    grading: NotebookProblemImportDraft['grading'];
    secretJudge?: NotebookProblemImportDraft['secretJudge'] | null;
  } = {
    title: draft.title,
    status: draft.status,
    points: draft.points,
    tags: draft.tags,
    difficulty: draft.difficulty,
    publicContent: draft.publicContent,
    grading: draft.grading,
  };
  const preserveExistingSecretJudge =
    draft.sourceMeta &&
    typeof draft.sourceMeta === 'object' &&
    draft.sourceMeta.preserveExistingSecretJudge === true;
  const hasProvidedSecretTests =
    draft.secretJudge &&
    Array.isArray(draft.secretJudge.secretTests) &&
    draft.secretJudge.secretTests.length > 0;

  if (draft.type === 'code') {
    if (hasProvidedSecretTests) {
      patch.secretJudge = draft.secretJudge;
    } else if (!preserveExistingSecretJudge) {
      patch.secretJudge = null;
    }
  } else if (draft.secretJudge) {
    patch.secretJudge = draft.secretJudge;
  }

  return patch;
}
