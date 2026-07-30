#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = 'lib/server/notebook-problems/service.ts';
const reviewPlanPath = 'features/teaching-orchestrator/server/review-plan.ts';
const [serviceSource, reviewPlanSource] = await Promise.all([
  readFile(servicePath, 'utf8'),
  readFile(reviewPlanPath, 'utf8'),
]);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

assert.match(
  serviceSource,
  /export const REVIEW_PROBLEM_CANDIDATE_LIMIT = 24;/,
  'review candidate cap must remain fixed at 24',
);
assert.match(
  serviceSource,
  /export const REVIEW_PROBLEM_DETAIL_LIMIT = 20;/,
  'selected detail cap must match the maximum review question count',
);

const candidateSection = section(
  serviceSource,
  'export async function listReviewProblemCandidatesForUser',
  'export async function listReviewProblemDetailsByIdsForUser',
);
assert.match(candidateSection, /LIMIT \$\{limit\}/, 'candidate SQL must apply its bounded LIMIT');
assert.match(
  candidateSection,
  /Math\.min\([\s\S]*REVIEW_PROBLEM_CANDIDATE_LIMIT/,
  'caller-provided candidate limits must be clamped',
);
assert.match(
  candidateSection,
  /LEFT JOIN preferred ON preferred\."id" = p\."id"/,
  'retrieval matches must be prioritized before the SQL limit is applied',
);
assert.match(
  candidateSection,
  /priorityConcepts\?: string\[\]/,
  'bounded candidate ranking must accept evidence-derived focus concepts',
);
assert.match(
  candidateSection,
  /priorityContextText\?: string/,
  'bounded candidate ranking must accept a clipped evidence context',
);
assert.match(
  candidateSection,
  /relevance\."matchedConcepts" DESC/,
  'metadata relevance must be applied before the SQL limit',
);
for (const forbiddenField of [
  'gradingJson',
  'sourceMeta',
  'NotebookProblemSecret',
  'secretJudgeJson',
]) {
  assert.equal(
    candidateSection.includes(forbiddenField),
    false,
    `lean candidate projection must not read ${forbiddenField}`,
  );
}
assert.doesNotMatch(
  candidateSection,
  /p\."publicContentJson"\s*,/,
  'lean candidate projection must not return the full public-content JSON',
);
assert.match(
  candidateSection,
  /p\."publicContentJson"->>'stem'/,
  'candidate relevance may extract the public stem without returning the JSON document',
);
assert.match(
  candidateSection,
  /900[\s\S]*AS "searchText"/,
  'candidate public search text must remain clipped',
);

const detailSection = section(
  serviceSource,
  'export async function listReviewProblemDetailsByIdsForUser',
  'export async function listCourseProblemSummariesForUser',
);
assert.match(
  detailSection,
  /p\."id" IN \(\$\{Prisma\.join\(problemIds\)\}\)/,
  'detail SQL must be constrained to selected problem IDs',
);
assert.match(
  detailSection,
  /\.slice\(0, REVIEW_PROBLEM_DETAIL_LIMIT\)/,
  'selected detail IDs must remain bounded',
);
assert.match(
  detailSection,
  /p\."publicContentJson"/,
  'selected detail read must retain public question content for evidence',
);
for (const secretField of [
  'gradingJson',
  'sourceMeta',
  'NotebookProblemSecret',
  'secretJudgeJson',
]) {
  assert.equal(
    detailSection.includes(secretField),
    false,
    `review detail read must never access private or unnecessary field ${secretField}`,
  );
}

for (const legacyLoader of [
  'listCourseProblemsForUser',
  'listCourseProblemsByIdsForUser',
  'listNotebookProblemsForUser',
  'searchLearnProblemBankForPractice',
]) {
  assert.equal(
    reviewPlanSource.includes(legacyLoader),
    false,
    `review planning must not use unbounded loader ${legacyLoader}`,
  );
}

const planSection = reviewPlanSource.slice(
  reviewPlanSource.indexOf('export async function generateEvidenceBasedReviewPlan'),
);
const candidateCallIndex = planSection.indexOf('listReviewProblemCandidatesForUser({');
const selectIndex = planSection.indexOf('const questions = selectQuestions({');
const detailCallIndex = planSection.indexOf('listReviewProblemDetailsByIdsForUser({');
assert.ok(candidateCallIndex >= 0, 'review plan must read lean problem candidates');
assert.ok(selectIndex > candidateCallIndex, 'review plan must rank candidates after the lean read');
assert.ok(
  detailCallIndex > selectIndex,
  'review plan must fetch full problem detail only after candidate selection',
);
assert.match(
  planSection,
  /problemIds: questions\.map\(\(question\) => question\.problemId\)/,
  'detail read must receive only selected question IDs',
);
assert.match(
  planSection,
  /priorityConcepts: candidatePriorityConcepts,[\s\S]*priorityContextText,[\s\S]*\}\);/,
  'recent evidence must shape the bounded metadata ranking',
);
assert.match(
  planSection,
  /detailByProblemId/,
  'selected public details must remain attached to the evidence ledger',
);
assert.match(
  planSection,
  /lean candidates \/\ \$\{selectedProblemDetails\.length\} selected details/,
  'tool-call rationale must expose the bounded two-stage read',
);

console.log('review-plan lean problem contracts: passed');
