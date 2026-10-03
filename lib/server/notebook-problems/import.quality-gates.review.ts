/**
 * Import review state stored in problem sourceMeta.importReview. Kept free of LLM and
 * image dependencies so persistence code and UI can read it cheaply.
 */

export const IMPORT_REVIEW_VERSION = 1;

export type ImportReviewIssueCode =
  | 'model_flag'
  | 'prompt_incomplete'
  | 'figure_missing'
  | 'figure_quality'
  | 'math_render'
  | 'math_delimiter'
  | 'source_label_leak'
  | 'drawing_downgraded'
  | 'answer_disagree'
  | 'answer_unsolvable'
  | 'answer_leak';

export type ImportReviewIssue = { code: ImportReviewIssueCode; message: string };

export type ImportReview = {
  version: number;
  status: 'passed' | 'needs_review';
  issues: ImportReviewIssue[];
  answerCheck: 'agree' | 'disagree' | 'unsolvable' | 'skipped' | 'error' | 'not_run';
  independentAnswer?: string;
  checkedAt: string;
  acknowledgedAt?: string;
};
