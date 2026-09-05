'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Code2,
  History,
  ImagePlus,
  Loader2,
  Maximize2,
  Play,
  Save,
  Search,
  Sparkles,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { cn } from '@/lib/utils';
import {
  getLocalizedProblemContent,
  getLocalizedProblemTitle,
  type NotebookProblemAttemptAnswer,
  type NotebookProblemAttemptRecord,
  type NotebookProblemPublicContent,
  type NotebookProblemPublicFillBlank,
} from '@/lib/problem-bank';
import { Button } from '@/components/ui/button';
import { MessageResponse } from '@/components/ai-elements/message';
import { AnswerComposer, AnswerComposerToolbar } from '@/components/problem-bank/answer-composer';
import { ProblemDraftForm } from '@/components/problem-bank/problem-draft-form';
import { ProblemLanguageToggle } from '@/components/problem-bank/problem-language-toggle';
import { ProblemChapterManagerDialog } from '@/components/problem-bank/problem-chapter-manager-dialog';
import { ProblemForumPublishDialog } from '@/components/problem-bank/problem-forum-publish-dialog';
import { RecentProblemSubmissionsDialog } from '@/components/problem-bank/recent-problem-submissions-dialog';
import { CodeAnswerEditor, highlightPython } from '@/components/problem-bank/code-answer-editor';
import { CodeProblemStatement } from '@/components/problem-bank/code-problem-statement';
import { CommonMathSymbols } from '@/components/problem-bank/common-math-symbols';
import {
  ProblemImageAssets,
  ProblemRichText,
  ProblemTitleText,
} from '@/components/problem-bank/problem-rich-text';
import { problemDraftToPatch } from '@/lib/problem-bank/editor';
import { Input } from '@/components/ui/input';
import {
  AnswerFeedbackSummaryBadge,
  AnswerPreviewPanel,
  AttemptHistoryPanel,
  AttemptHistoryList,
  ChoiceAnswerPreviewPanel,
  FormulaReferencePanel,
  PROBLEM_BANK_EMERALD_ACTION_BUTTON_CLASS,
  PROBLEM_BANK_EMERALD_OUTLINE_BUTTON_CLASS,
  PROBLEM_BANK_LIST_GRID_CLASS,
  PROBLEM_BANK_PRIMARY_BUTTON_CLASS,
  PhotoAnswerUploader,
  ProblemDraftPreviewPanel,
  ProblemMetaChip,
  answerComposerPlaceholder,
  difficultyLabel,
  difficultyTextClassName,
  formatProblemNumber,
  latestScoreLabel,
  practiceStateClassName,
  practiceStateLabel,
  problemMetaChips,
  problemTypeVisual,
  renderProblemContentStem,
  supportsPhotoAnswer,
  typeLabel,
  type AnswerPanelTab,
  type ProblemInfoTab,
} from '@/components/problem-bank/course-problem-bank-helpers';
import {
  useCourseProblemBankController,
  type CourseCodeRunResult,
  type CourseCodeRunTarget,
  type CourseProblemBankInitialFilters,
  type CourseProblemPracticeAttemptResolvedEvent,
} from '@/components/problem-bank/use-course-problem-bank-controller';
import { CourseSpaceHeader } from '@/components/course-space/course-space-header';
import { useCourseSpaceShell } from '@/components/course-space/course-space-shell-context';
import {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  resolveCourseSpaceHeaderFields,
} from '@/lib/course-space/format-course-space-header';
import { findLocalDemoTeacherHomeCourse } from '@/lib/teacher/local-demo-fixtures';
import {
  hasLimitedSubmissions,
  maxScoreForAttempt,
  remainingSubmissions,
} from '@/lib/problem-bank/scoring-policy';
import { isLocalDemoProblemBankCourse } from '@/lib/teacher/local-demo-problem-bank';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';

type PracticePaneId = 'left' | 'right';
type CodePracticeTab = 'testcase' | 'secret' | 'code' | 'output';
type PracticeAiHelpTab = 'ai-help';
type PracticePanelTab = ProblemInfoTab | AnswerPanelTab | CodePracticeTab | PracticeAiHelpTab;
type PracticePaneTabs = Record<PracticePaneId, PracticePanelTab[]>;
type PracticePaneActive = Record<PracticePaneId, PracticePanelTab>;
type CodeProblemPublicContent = Extract<NotebookProblemPublicContent, { type: 'code' }>;
type CodeProblemTestCase = CodeProblemPublicContent['publicTests'][number];
type CodeTestFile = {
  fileName: string;
  code: string;
};

function classPassRatePresentation(
  problem: NotebookProblemClientRecord,
  locale: 'zh-CN' | 'en-US',
) {
  const stats = problem.classStats;
  if (!stats || stats.studentCount === 0) {
    return {
      value: '—',
      detail: locale === 'zh-CN' ? '暂无班级学生数据' : 'No class data yet',
    };
  }
  const percent = Math.round((stats.passedStudentCount / stats.studentCount) * 100);
  return {
    value: `${percent}%`,
    detail:
      locale === 'zh-CN'
        ? `全班 ${stats.passedStudentCount}/${stats.studentCount} 人已通过，${stats.attemptedStudentCount} 人作答过`
        : `${stats.passedStudentCount}/${stats.studentCount} students passed; ${stats.attemptedStudentCount} attempted`,
  };
}

function InlineFillBlankPrompt({
  content,
  values,
  disabled,
  locale,
  onFocusBlank,
  onChangeBlank,
}: {
  content: NotebookProblemPublicFillBlank;
  values: Record<string, string>;
  disabled: boolean;
  locale: 'zh-CN' | 'en-US';
  onFocusBlank: (blankId: string) => void;
  onChangeBlank: (blankId: string, value: string) => void;
}) {
  const parts = content.stemTemplate.split(/(\{\{\s*[^{}]+?\s*\}\})/g).filter(Boolean);

  return (
    <div className="text-[15px] leading-9 text-slate-800 dark:text-slate-200">
      {parts.map((part, partIndex) => {
        const marker = part.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
        if (!marker) {
          return (
            <ProblemRichText
              key={`${partIndex}-${part}`}
              content={part}
              className="inline text-[15px] leading-9 [&_p]:inline"
            />
          );
        }

        const blankId = marker[1].trim();
        const blankIndex = content.blanks.findIndex((blank) => blank.id === blankId);
        const blank = content.blanks[blankIndex];
        if (!blank) return <span key={`${partIndex}-${part}`}>______</span>;

        const label =
          blank.placeholder?.trim() ||
          (locale === 'zh-CN' ? `第 ${blankIndex + 1} 空` : `Blank ${blankIndex + 1}`);
        return (
          <Input
            key={blank.id}
            value={values[blank.id] ?? ''}
            disabled={disabled}
            aria-label={label}
            title={label}
            placeholder={locale === 'zh-CN' ? `空 ${blankIndex + 1}` : `Blank ${blankIndex + 1}`}
            onFocus={() => onFocusBlank(blank.id)}
            onChange={(event) => onChangeBlank(blank.id, event.target.value)}
            className="mx-1 inline-flex h-8 w-24 rounded-md border-sky-200 bg-sky-50/70 px-2 text-center text-sm font-semibold align-middle text-slate-900 shadow-none focus-visible:bg-white dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-white dark:focus-visible:bg-slate-950"
          />
        );
      })}
    </div>
  );
}

type ProblemBankStats = {
  total: number;
  attempted: number;
  mastered: number;
  review: number;
  wrong: number;
  unattempted: number;
  masteryPercent: number;
  chapterProgress: Array<{
    chapter: string;
    attemptedCount: number;
    totalCount: number;
    percent: number;
  }>;
};

function chapterProgressBarClass(percent: number): string {
  if (percent >= 80) return 'bg-emerald-500';
  if (percent >= 50) return 'bg-sky-500';
  if (percent > 0) return 'bg-amber-500';
  return 'bg-slate-300 dark:bg-slate-600';
}

function ProblemBankStatsSidebar({
  stats,
  loading,
  canEditProblems,
  locale,
}: {
  stats: ProblemBankStats;
  loading: boolean;
  canEditProblems: boolean;
  locale: 'zh-CN' | 'en-US';
}) {
  if (loading) {
    return (
      <aside
        className="absolute inset-y-0 right-0 hidden min-h-0 w-[304px] xl:flex"
        aria-label={locale === 'zh-CN' ? '题库学习统计' : 'Problem bank learning stats'}
      >
        <div
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/60"
          aria-busy="true"
        >
          <div className="h-36 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-900" />
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-16 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-900"
              />
            ))}
          </div>
          <div className="mt-5 h-4 w-24 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-900" />
          <div className="mt-3 space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-9 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-900"
              />
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (stats.total === 0) {
    return (
      <aside
        className="absolute inset-y-0 right-0 hidden min-h-0 w-[304px] xl:flex"
        aria-label={locale === 'zh-CN' ? '题库学习统计' : 'Problem bank learning stats'}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span className="grid size-8 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
              <BookOpen className="size-4" />
            </span>
            {locale === 'zh-CN' ? '学习进度' : 'Learning progress'}
          </div>
          <div className="flex min-h-[24rem] flex-1 flex-col items-center justify-center text-center">
            <span className="relative grid size-20 place-items-center rounded-[24px] bg-[linear-gradient(145deg,#f0f9ff,#eef2ff)] text-sky-600 shadow-[0_18px_45px_rgba(14,165,233,0.14)] ring-1 ring-sky-100 dark:bg-[linear-gradient(145deg,rgba(14,165,233,0.14),rgba(99,102,241,0.12))] dark:text-sky-300 dark:ring-sky-500/20">
              <BookOpen className="size-8" strokeWidth={1.7} />
            </span>
            <p className="mt-6 text-base font-semibold text-slate-900 dark:text-slate-100">
              {locale === 'zh-CN' ? '暂无题目可统计' : 'No problems to summarize'}
            </p>
            <p className="mt-2 max-w-[14rem] text-xs leading-5 text-slate-500 dark:text-slate-400">
              {locale === 'zh-CN'
                ? canEditProblems
                  ? '导入第一批题目后，这里会自动生成完成率、练习状态和章节进度。'
                  : '老师发布题目后，这里会自动展示你的练习进度。'
                : canEditProblems
                  ? 'Import the first problems to generate completion, practice, and chapter insights.'
                  : 'Your learning progress will appear after the teacher publishes problems.'}
            </p>
          </div>
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-center text-[11px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-500">
            {locale === 'zh-CN' ? '有题目后才计算完成率' : 'Completion starts when problems exist'}
          </div>
        </div>
      </aside>
    );
  }

  const overviewItems = [
    {
      label: locale === 'zh-CN' ? '已做完' : 'Completed',
      count: stats.mastered,
      Icon: CheckCircle2,
      className:
        'border-emerald-100 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
    },
    {
      label: locale === 'zh-CN' ? '已尝试' : 'Attempted',
      count: stats.attempted,
      Icon: Play,
      className:
        'border-sky-100 bg-sky-50/70 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200',
    },
    {
      label: locale === 'zh-CN' ? '错题' : 'Incorrect',
      count: stats.wrong,
      Icon: AlertCircle,
      className:
        'border-rose-100 bg-rose-50/70 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200',
    },
    {
      label: locale === 'zh-CN' ? '未完成' : 'Not completed',
      count: stats.unattempted,
      Icon: BookOpen,
      className:
        'border-slate-200 bg-slate-50/80 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300',
    },
  ];

  return (
    <aside
      className="absolute inset-y-0 right-0 hidden min-h-0 w-[304px] xl:flex"
      aria-label={locale === 'zh-CN' ? '题库学习统计' : 'Problem bank learning stats'}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_16px_40px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/60">
        <div className="relative overflow-hidden bg-[linear-gradient(145deg,#082f49_0%,#0f4c81_52%,#4338ca_120%)] px-4 pb-4 pt-3.5 text-white dark:bg-[linear-gradient(145deg,#020617_0%,#0c4a6e_58%,#312e81_120%)]">
          <div className="pointer-events-none absolute -right-12 -top-14 size-36 rounded-full bg-cyan-300/20 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 size-32 rounded-full bg-indigo-300/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100/80">
                {locale === 'zh-CN' ? '学习进度' : 'Learning progress'}
              </p>
              <p className="mt-1 text-sm font-semibold">
                {locale === 'zh-CN' ? '题库总完成度' : 'Overall completion'}
              </p>
            </div>
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-medium text-sky-50 backdrop-blur-sm">
              {stats.mastered}/{stats.total}
            </span>
          </div>
          <div className="relative mt-3 flex items-center gap-3">
            <div
              className="grid size-[86px] shrink-0 place-items-center rounded-full p-[7px] shadow-[0_14px_34px_rgba(2,6,23,0.25)]"
              style={{
                background: `conic-gradient(#6ee7b7 0deg ${stats.masteryPercent * 3.6}deg, rgba(255,255,255,0.14) ${stats.masteryPercent * 3.6}deg 360deg)`,
              }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={stats.masteryPercent}
              aria-label={locale === 'zh-CN' ? '题库完成率' : 'Problem bank completion'}
            >
              <div className="grid size-full place-items-center rounded-full bg-slate-950/90 text-center ring-1 ring-white/10">
                <div>
                  <span className="text-[25px] font-bold leading-none tracking-[-0.05em]">
                    {stats.masteryPercent}
                  </span>
                  <span className="ml-0.5 text-sm font-semibold text-emerald-200">%</span>
                  <p className="mt-0.5 text-[9px] font-medium text-slate-300">
                    {locale === 'zh-CN' ? '已正确完成' : 'solved'}
                  </p>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold tracking-[-0.03em]">
                {stats.masteryPercent >= 80
                  ? locale === 'zh-CN'
                    ? '状态很好'
                    : 'Great progress'
                  : stats.masteryPercent >= 40
                    ? locale === 'zh-CN'
                      ? '稳步推进'
                      : 'Building momentum'
                    : locale === 'zh-CN'
                      ? '继续积累'
                      : 'Keep going'}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-sky-100/75">
                {locale === 'zh-CN'
                  ? `还有 ${stats.total - stats.mastered} 道题等待掌握`
                  : `${stats.total - stats.mastered} problems left to master`}
              </p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-4 gap-1.5 p-3">
          {overviewItems.map(({ label, count, Icon, className }) => (
            <div
              key={label}
              className={cn('min-w-0 rounded-xl border px-1 py-2 text-center', className)}
            >
              <dt className="flex items-center justify-center gap-1 whitespace-nowrap text-[10px] font-medium opacity-80">
                <Icon className="size-3 shrink-0" />
                <span>{label}</span>
              </dt>
              <dd className="mt-1.5 text-xl font-bold leading-none tracking-[-0.04em]">{count}</dd>
            </div>
          ))}
        </dl>

        <div className="mx-3 border-t border-slate-100 dark:border-slate-800" />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3 pt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <BookOpen className="size-3.5 text-sky-600 dark:text-sky-300" />
                {locale === 'zh-CN' ? '章节完成度' : 'Progress by chapter'}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                {locale === 'zh-CN'
                  ? '按章节展示题目的已尝试比例'
                  : 'Attempt rate for each chapter'}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-medium text-slate-400">
              {locale === 'zh-CN'
                ? `前 ${stats.chapterProgress.length} 个`
                : `Top ${stats.chapterProgress.length}`}
            </span>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-hidden">
            {stats.chapterProgress.length > 0 ? (
              <div className="space-y-3">
                {stats.chapterProgress.map((item) => (
                  <div key={item.chapter}>
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <span
                        className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-200"
                        title={item.chapter}
                      >
                        {item.chapter}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                        {item.percent}%
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.percent}
                      aria-label={`${item.chapter} ${item.percent}%`}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
                          chapterProgressBarClass(item.percent),
                        )}
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                {locale === 'zh-CN'
                  ? '题目归入章节后，会在这里显示章节进度。'
                  : 'Chapter progress will appear after problems are filed.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export type CourseProblemPracticeHeaderState = {
  problemId: string;
  problem: NotebookProblemClientRecord;
  problemTitle: string;
  problemContent: NotebookProblemPublicContent | null;
  currentAnswer: NotebookProblemAttemptAnswer | null;
  latestAttempt: NotebookProblemAttemptRecord | null;
  progressLabel: string;
  progressCurrent: number;
  progressTotal: number;
  notebookLabel: string | null;
  difficultyLabel: string;
  difficultyClassName: string;
  previousLabel: string;
  previousTitle: string;
  previousDisabled: boolean;
  nextLabel: string;
  nextTitle: string;
  nextDisabled: boolean;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
};

const FORMULA_PRACTICE_TAB = 'formula' satisfies PracticePanelTab;
const AI_HELP_PRACTICE_TAB = 'ai-help' satisfies PracticeAiHelpTab;
const PROBLEM_INFO_TABS = [
  'description',
  FORMULA_PRACTICE_TAB,
  'edit',
] as const satisfies readonly ProblemInfoTab[];
const ANSWER_PANE_TABS = [
  'answer',
  'preview',
  'solution',
  'history',
] as const satisfies readonly AnswerPanelTab[];
const CODE_PRACTICE_TABS: CodePracticeTab[] = ['testcase', 'secret', 'code', 'output'];
const PRACTICE_TAB_DRAG_TYPE = 'application/x-syntara-practice-tab';
const DEFAULT_PRACTICE_PANE_TABS: PracticePaneTabs = {
  left: ['description', FORMULA_PRACTICE_TAB, 'edit'],
  right: ['answer', 'preview', 'history'],
};

type PracticeAiHelpState = {
  problemId: string;
  title: string;
  answer: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
};

type PracticeAiHelpController = {
  state: PracticeAiHelpState | null;
  hasHelp: boolean;
  active: boolean;
  onActiveChange: (active: boolean) => void;
};

const practiceAiHelpMarkdownClassName = cn(
  'max-w-none text-sm leading-7 text-slate-800 dark:text-slate-100',
  '[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1',
  '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold',
  '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_code]:rounded [&_code]:bg-white [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono dark:[&_code]:bg-slate-900',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-white [&_pre]:p-3 dark:[&_pre]:border-slate-800 dark:[&_pre]:bg-slate-950',
);

function isProblemInfoPracticeTab(tab: PracticePanelTab): tab is ProblemInfoTab {
  return (PROBLEM_INFO_TABS as readonly string[]).includes(tab);
}

function isAnswerPracticeTab(tab: PracticePanelTab): tab is AnswerPanelTab {
  return (ANSWER_PANE_TABS as readonly string[]).includes(tab);
}

function isCodePracticeTab(tab: PracticePanelTab): tab is CodePracticeTab {
  return (CODE_PRACTICE_TABS as readonly string[]).includes(tab);
}

function normalizePracticePaneTabs(
  tabs: PracticePaneTabs,
  supportsFormulaTab: boolean,
  canEditProblems: boolean,
  supportsPreviewTab: boolean,
  codeTabs: CodePracticeTab[],
  hideEditTab = false,
  hideSolutionTab = false,
  supportsAiHelpTab = false,
): PracticePaneTabs {
  const nextTabs: PracticePaneTabs = {
    left: [...tabs.left],
    right: [...tabs.right],
  };

  const removeTab = (tab: PracticePanelTab) => {
    nextTabs.left = nextTabs.left.filter((item) => item !== tab);
    nextTabs.right = nextTabs.right.filter((item) => item !== tab);
  };

  const hasTab = (tab: PracticePanelTab) =>
    nextTabs.left.includes(tab) || nextTabs.right.includes(tab);

  const ensureLeftTabAfter = (tab: PracticePanelTab, anchor: PracticePanelTab) => {
    if (hasTab(tab)) return;
    const anchorIndex = nextTabs.left.indexOf(anchor);
    nextTabs.left =
      anchorIndex >= 0
        ? [...nextTabs.left.slice(0, anchorIndex + 1), tab, ...nextTabs.left.slice(anchorIndex + 1)]
        : [...nextTabs.left, tab];
  };

  const ensureRightTabAfter = (tab: PracticePanelTab, anchor: PracticePanelTab) => {
    if (hasTab(tab)) return;
    const anchorIndex = nextTabs.right.indexOf(anchor);
    nextTabs.right =
      anchorIndex >= 0
        ? [
            ...nextTabs.right.slice(0, anchorIndex + 1),
            tab,
            ...nextTabs.right.slice(anchorIndex + 1),
          ]
        : [...nextTabs.right, tab];
  };

  if (supportsFormulaTab) {
    ensureLeftTabAfter(FORMULA_PRACTICE_TAB, 'description');
  } else {
    removeTab(FORMULA_PRACTICE_TAB);
  }

  if (canEditProblems && !hideEditTab) {
    ensureLeftTabAfter('edit', hasTab(FORMULA_PRACTICE_TAB) ? FORMULA_PRACTICE_TAB : 'description');
  } else {
    removeTab('edit');
  }

  if (hideSolutionTab) {
    removeTab('solution');
  }

  if (supportsPreviewTab) {
    ensureRightTabAfter('preview', 'answer');
  } else {
    removeTab('preview');
  }

  if (codeTabs.length > 0) {
    removeTab('answer');
    CODE_PRACTICE_TABS.forEach((tab) => {
      if (!codeTabs.includes(tab)) removeTab(tab);
    });
    const missingCodeTestTabs = codeTabs.filter(
      (tab) => tab !== 'code' && tab !== 'output' && !hasTab(tab),
    );
    missingCodeTestTabs.forEach((tab) => {
      ensureLeftTabAfter(tab, tab === 'secret' ? 'testcase' : 'description');
    });
    const missingCodeActionTabs = codeTabs.filter(
      (tab) => (tab === 'code' || tab === 'output') && !hasTab(tab),
    );
    if (missingCodeActionTabs.length > 0) {
      nextTabs.right = [...missingCodeActionTabs, ...nextTabs.right];
    }
  } else {
    CODE_PRACTICE_TABS.forEach(removeTab);
    if (!hasTab('answer')) {
      nextTabs.right = ['answer', ...nextTabs.right];
    }
  }

  if (supportsAiHelpTab) {
    ensureRightTabAfter(AI_HELP_PRACTICE_TAB, codeTabs.includes('code') ? 'code' : 'answer');
  } else {
    removeTab(AI_HELP_PRACTICE_TAB);
  }

  if (nextTabs.left.length === 0) {
    nextTabs.left = ['description'];
    nextTabs.right = nextTabs.right.filter((tab) => tab !== 'description');
  }
  if (nextTabs.right.length === 0) {
    const fallbackRightTab = codeTabs.includes('code') ? 'code' : 'answer';
    nextTabs.right = [fallbackRightTab];
    nextTabs.left = nextTabs.left.filter((tab) => tab !== fallbackRightTab);
  }
  return nextTabs;
}

function normalizePracticePaneActive(
  active: PracticePaneActive,
  tabs: PracticePaneTabs,
): PracticePaneActive {
  return {
    left: tabs.left.includes(active.left) ? active.left : (tabs.left[0] ?? 'description'),
    right: tabs.right.includes(active.right) ? active.right : (tabs.right[0] ?? 'answer'),
  };
}

function extractExecBody(expression: string) {
  const match = expression.match(/exec\(("(?:(?:\\.)|[^"\\])*")\s*,/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}

function sanitizePythonIdentifier(value: string | undefined, fallback: string) {
  const normalized = (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = normalized || fallback;
  const prefixed = /^[a-z_]/.test(safe) ? safe : `case_${safe}`;
  return prefixed.startsWith('test_') ? prefixed : `test_${prefixed}`;
}

function pythonLiteral(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, item]) => `${pythonLiteral(key)}: ${pythonLiteral(item)}`)
      .join(', ')}}`;
  }
  return 'None';
}

function formatExpectedForPython(expected: string) {
  try {
    return pythonLiteral(JSON.parse(expected));
  } catch {
    return expected.trim() || 'None';
  }
}

function indentPythonBlock(source: string, spaces = 8) {
  const prefix = ' '.repeat(spaces);
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `${prefix}${line}` : ''))
    .join('\n');
}

function codeTestMethodSource(testCase: CodeProblemTestCase, index: number) {
  const methodName = sanitizePythonIdentifier(
    testCase.id || testCase.description,
    `case_${index + 1}`,
  );
  const recoveredBody = extractExecBody(testCase.expression);
  const body =
    recoveredBody?.trim() ||
    `self.assertEqual(${testCase.expression.trim()}, ${formatExpectedForPython(testCase.expected)})`;

  return [`    def ${methodName}(self):`, indentPythonBlock(body)].join('\n');
}

function buildCodeTestFile(
  testCases: CodeProblemTestCase[],
  fileName: string,
  className: 'PublicTests' | 'SecretTests',
) {
  if (testCases.length === 0) {
    return [`# ${fileName}`, '', '# No tests available.'].join('\n');
  }

  return [
    `# ${fileName}`,
    'import unittest',
    'from submission import *',
    '',
    '',
    `class ${className}(unittest.TestCase):`,
    testCases.map(codeTestMethodSource).join('\n\n'),
    '',
    '',
    'if __name__ == "__main__":',
    '    unittest.main()',
  ].join('\n');
}

function buildCodeTestFiles(
  content: CodeProblemPublicContent,
  secretTests?: CodeProblemTestCase[],
) {
  return {
    publicFile: {
      fileName: 'public_tests.py',
      code: buildCodeTestFile(content.publicTests, 'public_tests.py', 'PublicTests'),
    },
    secretFile: secretTests?.length
      ? {
          fileName: 'secret_tests.py',
          code: buildCodeTestFile(secretTests, 'secret_tests.py', 'SecretTests'),
        }
      : undefined,
  };
}

function CodeTestcasePanel({ file, locale }: { file?: CodeTestFile; locale: 'zh-CN' | 'en-US' }) {
  const lineNumbers = file
    ? Array.from({ length: Math.max(1, file.code.split('\n').length) }, (_, index) => index + 1)
    : [];

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-slate-950">
      {file ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid min-h-0 flex-1 grid-cols-[3.25rem_minmax(0,1fr)] overflow-auto bg-white font-mono text-[13px] leading-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <pre className="select-none border-r border-slate-200 bg-slate-50 px-3 py-4 text-right text-slate-400 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-500">
              {lineNumbers.join('\n')}
            </pre>
            <pre className="min-w-max whitespace-pre px-4 py-4">
              <code>{highlightPython(file.code)}</code>
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-slate-400">
          {locale === 'zh-CN' ? '暂无测试用例。' : 'No test cases yet.'}
        </div>
      )}
    </div>
  );
}

function SolutionCodeBlock({ code, language }: { code: string; language?: string }) {
  const isPython = !language || language.toLowerCase() === 'python';

  return (
    <pre
      className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[13px] leading-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-100"
      style={{ tabSize: 4 }}
    >
      <code className="block min-w-max whitespace-pre">
        {isPython ? highlightPython(code) : code}
      </code>
    </pre>
  );
}

const CODE_OPTION_LANGUAGE_ALIASES: Record<string, string> = {
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  css: 'css',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  py: 'python',
  python: 'python',
  racket: 'racket',
  scheme: 'scheme',
  sql: 'sql',
  ts: 'typescript',
  typescript: 'typescript',
};

function looksLikeCodeLine(line: string): boolean {
  return /^(?:class|def|elif|else|for|from|if|import|return|while)\b|[=(){}\[\]:;]|^\s{2,}\S/.test(
    line,
  );
}

function parseCodeChoiceLabel(label: string): { code: string; language?: string } | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```([A-Za-z0-9+#-]*)\s*\n([\s\S]*?)\n?```$/);
  if (fenced) {
    return {
      language: CODE_OPTION_LANGUAGE_ALIASES[fenced[1]?.toLowerCase() ?? ''] ?? fenced[1],
      code: fenced[2].trim(),
    };
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.replace(/\s+$/g, ''));
  const firstLine = lines[0]?.trim().replace(/:$/, '').toLowerCase() ?? '';
  const language = CODE_OPTION_LANGUAGE_ALIASES[firstLine];
  if (language && lines.length > 1) {
    const code = lines.slice(1).join('\n').trim();
    return code ? { language, code } : null;
  }

  if (lines.length > 1 && lines.some(looksLikeCodeLine)) {
    return { code: trimmed };
  }

  return null;
}

function SolutionChoiceOptions({
  options,
  locale,
}: {
  options: Array<{ id: string; label: string }>;
  locale: 'zh-CN' | 'en-US';
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const parsedCode = parseCodeChoiceLabel(option.label);

        return (
          <div
            key={option.id}
            className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10"
          >
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-100">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-emerald-600 px-2 font-mono text-xs font-bold text-white shadow-sm shadow-emerald-950/10">
                {option.id}
              </span>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="text-xs font-semibold">
                {locale === 'zh-CN' ? '正确选项' : 'Correct option'}
              </span>
            </div>
            {parsedCode ? (
              <div className="mt-3 space-y-2">
                {parsedCode.language ? (
                  <span className="inline-flex rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    {parsedCode.language}
                  </span>
                ) : null}
                <SolutionCodeBlock code={parsedCode.code} language={parsedCode.language} />
              </div>
            ) : (
              <ProblemRichText
                content={option.label}
                className="mt-3 text-slate-800 dark:text-slate-100 [&_.problem-rich-code-block]:my-0 [&_.problem-rich-code-block]:max-w-full"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CodeAnswerWorkspace({
  value,
  onChange,
  disabled,
  locale,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  locale: 'zh-CN' | 'en-US';
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeAnswerEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          locale={locale}
          className="h-full min-h-0 rounded-none border-0 shadow-none focus-within:ring-0"
          placeholder={
            locale === 'zh-CN' ? '在这里编写代码并提交。' : 'Write code here and submit.'
          }
        />
      </div>
    </div>
  );
}

function CodeRunOutputPanel({
  result,
  running,
  locale,
}: {
  result?: CourseCodeRunResult;
  running: boolean;
  locale: 'zh-CN' | 'en-US';
}) {
  const attempt = result?.attempt;
  const outputResult = attempt?.result;
  const runTarget = result?.target ?? outputResult?.runTarget ?? 'public';
  const caseResults = outputResult?.caseResults ?? outputResult?.publicCases ?? [];
  const testSummary =
    runTarget === 'secret'
      ? (outputResult?.secretSummary ?? null)
      : (outputResult?.publicSummary ?? null);
  const testSummaryLabel =
    runTarget === 'secret'
      ? locale === 'zh-CN'
        ? '隐藏测试'
        : 'Secret tests'
      : locale === 'zh-CN'
        ? '公开测试'
        : 'Public tests';
  const error = result?.error;
  const status = attempt?.status ?? (error ? 'error' : null);
  const allPassed = status === 'passed';
  const statusLabel = running
    ? locale === 'zh-CN'
      ? '正在运行'
      : 'Running'
    : status === 'passed'
      ? runTarget === 'code'
        ? locale === 'zh-CN'
          ? '运行完成'
          : 'Finished'
        : locale === 'zh-CN'
          ? '测试通过'
          : 'Passed'
      : status
        ? locale === 'zh-CN'
          ? runTarget === 'code'
            ? '运行出错'
            : '测试未通过'
          : 'Failed'
        : locale === 'zh-CN'
          ? '等待运行'
          : 'Ready';
  const scriptStdout = outputResult?.stdout ?? '';
  const scriptError = outputResult?.error ?? '';
  const hasScriptOutput = Boolean(scriptStdout || scriptError);
  const feedback =
    error ||
    scriptError ||
    (locale === 'zh-CN'
      ? outputResult?.feedback
          ?.replaceAll('Public tests', '公开测试')
          .replaceAll('Secret tests', '隐藏测试')
      : outputResult?.feedback) ||
    (locale === 'zh-CN' ? '点击运行查看运行结果。' : 'Run code to see output.');

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-slate-950">
      <div className="flex min-h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-semibold ring-1',
              running
                ? 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20'
                : allPassed
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20'
                  : status
                    ? 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/20'
                    : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800',
            )}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : allPassed ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : status ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : (
              <Terminal className="h-3.5 w-3.5" />
            )}
            {statusLabel}
          </span>
          {testSummary ? (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {testSummaryLabel}: {testSummary.passed}/{testSummary.total}
            </span>
          ) : null}
          {result?.ranAt ? (
            <span className="ml-auto text-xs text-slate-400">
              {new Date(result.ranAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          ) : null}
        </div>

        <div className="border-b border-slate-100 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:text-slate-200">
          {feedback}
        </div>

        {hasScriptOutput ? (
          <div className="space-y-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            {scriptStdout ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {locale === 'zh-CN' ? '标准输出' : 'stdout'}
                </p>
                <pre className="overflow-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-100">
                  {scriptStdout}
                </pre>
              </div>
            ) : null}
            {scriptError ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-400">
                  {locale === 'zh-CN' ? '错误' : 'error'}
                </p>
                <pre className="overflow-auto rounded-md border border-rose-100 bg-rose-50 px-3 py-2 font-mono text-xs leading-5 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
                  {scriptError}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {caseResults.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {caseResults.map((testCase, index) => {
              const hasDetails = Boolean(testCase.stdout || testCase.error || testCase.actual);
              return (
                <section key={`${testCase.id}-${index}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex size-5 items-center justify-center rounded-full',
                        testCase.passed
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                          : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200',
                      )}
                    >
                      {testCase.passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <h3 className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {testCase.description || testCase.id || `case_${index + 1}`}
                    </h3>
                  </div>

                  {hasDetails ? (
                    <div className="mt-3 space-y-2">
                      {testCase.stdout ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {locale === 'zh-CN' ? '标准输出' : 'stdout'}
                          </p>
                          <pre className="overflow-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-100">
                            {testCase.stdout}
                          </pre>
                        </div>
                      ) : null}
                      {testCase.error ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-400">
                            {locale === 'zh-CN' ? '错误' : 'error'}
                          </p>
                          <pre className="overflow-auto rounded-md border border-rose-100 bg-rose-50 px-3 py-2 font-mono text-xs leading-5 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
                            {testCase.error}
                          </pre>
                        </div>
                      ) : null}
                      {testCase.actual ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {locale === 'zh-CN' ? '实际输出' : 'actual'}
                          </p>
                          <pre className="overflow-auto rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                            {testCase.actual}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">
                      {locale === 'zh-CN' ? '没有额外输出。' : 'No additional output.'}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[220px] flex-1 items-center justify-center px-4 text-center text-sm text-slate-400">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {locale === 'zh-CN' ? '正在运行代码…' : 'Running code...'}
              </>
            ) : runTarget === 'code' && status === 'passed' ? (
              <span>
                {locale === 'zh-CN'
                  ? '代码运行完成，没有标准输出。'
                  : 'Code finished with no stdout.'}
              </span>
            ) : (
              <span>
                {locale === 'zh-CN' ? '点击运行查看运行结果。' : 'Run code to see output.'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CourseProblemBankView({
  courseId,
  initialNotebookId,
  initialProblemId,
  initialFilters,
  mode = 'bank',
  practiceBackLabel: _practiceBackLabel,
  practiceHeaderPlacement = 'internal',
  practiceProblemIds,
  initialPracticeAnswers,
  onPracticeBack: _onPracticeBack,
  onPracticeProblemChange,
  onPracticeAnswerDraftChange,
  onPracticeAttemptResolved,
  onPracticeHeaderStateChange,
  practiceAiHelp,
  showCourseTitle = true,
  showChromeBackground = true,
  showCourseNavigation = false,
  previewMode = false,
  previewAsTeacher = false,
  forumCount,
}: {
  courseId: string;
  initialNotebookId?: string;
  initialProblemId?: string;
  initialFilters?: CourseProblemBankInitialFilters;
  mode?: 'bank' | 'practice';
  practiceBackLabel?: string;
  practiceHeaderPlacement?: 'internal' | 'external';
  practiceProblemIds?: string[];
  initialPracticeAnswers?: Record<string, NotebookProblemAttemptAnswer | null | undefined>;
  onPracticeBack?: () => void;
  onPracticeProblemChange?: (problemId: string) => void;
  onPracticeAnswerDraftChange?: (
    problemId: string,
    answer: NotebookProblemAttemptAnswer | null,
  ) => void;
  onPracticeAttemptResolved?: (event: CourseProblemPracticeAttemptResolvedEvent) => void;
  onPracticeHeaderStateChange?: (state: CourseProblemPracticeHeaderState | null) => void;
  practiceAiHelp?: PracticeAiHelpController;
  showCourseTitle?: boolean;
  showChromeBackground?: boolean;
  showCourseNavigation?: boolean;
  previewMode?: boolean;
  previewAsTeacher?: boolean;
  forumCount?: number;
}) {
  const hasSharedShell = useCourseSpaceShell();
  const view = useCourseProblemBankController({
    courseId,
    initialNotebookId,
    initialProblemId,
    initialFilters,
    initialPracticeAnswers,
    practiceProblemIds,
    mode,
    previewMode,
    previewAsTeacher,
    onPracticeAttemptResolved,
  });
  const {
    activeBankFilterCount,
    autoArchiving,
    bankStats,
    blankAnswers,
    canEditProblems,
    choiceAnswers,
    codeAnswers,
    codeRunResults,
    courseAccessRole,
    courseAcademicTerm,
    courseAcademicYear,
    courseCode,
    courseHasTranslations,
    courseName,
    courseProblemCount,
    currentFilteredProblemPosition,
    currentProblemPage,
    deletingProblemId,
    difficultyFilter,
    difficultyFilterOptions,
    filteredProblems,
    filteredProblemCount,
    handleAddPhotoAnswerFiles,
    handleAiFileUnfiledProblems,
    handleChangeProblemChapter,
    handleDeleteProblem,
    handleEditingDraftChange,
    handleProblemInfoTabChange,
    handleRemovePhotoAnswer,
    handleRunCodeAnswer,
    handleSubmitInlineAnswer,
    handleUpdateProblem,
    insertFormulaIntoAnswer,
    isPracticeMode,
    chapterFilter,
    chapterFilterOptions,
    loading,
    locale,
    navigateToPracticeProblem,
    nextPracticeTarget,
    pageEndIndex,
    pageStartIndex,
    paginatedProblems,
    photoAnswers,
    practiceFilter,
    practiceFilterOptions,
    practiceNavigationProblemCount,
    previousPracticeTarget,
    problemLanguage,
    problemChapters,
    reloadProblemChapters,
    problemPageCount,
    problems,
    router,
    runningCode,
    runningCodeTarget,
    savingChapterProblemId,
    searchQuery,
    selectedAnswerMode,
    selectedAnswerController,
    selectedAnswerFeedback,
    selectedProblem,
    selectedProblemAttempts,
    selectedProblemAttemptsLoaded,
    selectedProblemAttemptsLoading,
    selectedProblemContent,
    selectedProblemEditDraft,
    selectedProblemHasTranslation,
    selectedProblemId,
    selectedProblemChapterLabel,
    selectedProblemPoints,
    selectedProblemSolutionSections,
    selectedProblemTitle,
    selectedTextAnswerValue,
    setAnswerFeedbackByProblemId,
    setAnswerModes,
    setAnswerPanelTab,
    setBlankAnswers,
    setChoiceAnswers,
    setCodeAnswers,
    setDifficultyFilter,
    setChapterFilter,
    setProblemLanguage,
    setPracticeFilter,
    setProblemPage,
    setSearchQuery,
    setSelectedProblemId,
    setSelectedTextAnswer,
    setStatusFilter,
    setTypeFilter,
    showSidebarAnswerTools,
    statusFilter,
    statusFilterOptions,
    submittingAnswer,
    textAnswers,
    typeFilter,
    typeFilterOptions,
    visibleProblemPreviewDraft,
  } = view;
  const [chapterManagerOpen, setChapterManagerOpen] = useState(false);
  const [recentSubmissionsProblem, setRecentSubmissionsProblem] =
    useState<NotebookProblemClientRecord | null>(null);
  const [activeFillBlankId, setActiveFillBlankId] = useState<string | null>(null);
  const fillBlankAnswerInputRef = useRef<HTMLInputElement>(null);
  const [practicePaneTabs, setPracticePaneTabs] = useState<PracticePaneTabs>(() => ({
    left: [...DEFAULT_PRACTICE_PANE_TABS.left],
    right: [...DEFAULT_PRACTICE_PANE_TABS.right],
  }));
  const [practicePaneActive, setPracticePaneActive] = useState<PracticePaneActive>({
    left: 'description',
    right: 'answer',
  });
  const [draggingPracticeTab, setDraggingPracticeTab] = useState<PracticePanelTab | null>(null);
  const selectedProblemSupportsFormulaTab =
    !selectedProblem || supportsPhotoAnswer(selectedProblem);
  const editingProblemPaneSelected =
    canEditProblems && (practicePaneActive.left === 'edit' || practicePaneActive.right === 'edit');
  const selectedProblemSupportsPreviewTab =
    editingProblemPaneSelected ||
    !selectedProblem ||
    (selectedProblem.type !== 'choice' && selectedProblem.type !== 'code');
  const selectedProblemCurrentAnswer: NotebookProblemAttemptAnswer | null = useMemo(() => {
    if (!selectedProblem) return null;
    if (selectedProblem.type === 'choice') {
      return { selectedOptionIds: choiceAnswers[selectedProblem.id] ?? [] };
    }
    if (selectedProblem.type === 'fill_blank') {
      return { blanks: blankAnswers[selectedProblem.id] ?? {} };
    }
    if (selectedProblem.type === 'code') {
      return {
        code:
          codeAnswers[selectedProblem.id] ??
          (selectedProblemContent?.type === 'code' ? selectedProblemContent.starterCode : '') ??
          '',
      };
    }
    return { text: textAnswers[selectedProblem.id] ?? '' };
  }, [
    blankAnswers,
    choiceAnswers,
    codeAnswers,
    selectedProblem,
    selectedProblemContent,
    textAnswers,
  ]);
  const selectedFillBlankContent =
    selectedProblem?.type === 'fill_blank' && selectedProblemContent?.type === 'fill_blank'
      ? selectedProblemContent
      : null;
  const selectedActiveBlank = selectedFillBlankContent
    ? (selectedFillBlankContent.blanks.find((blank) => blank.id === activeFillBlankId) ??
      selectedFillBlankContent.blanks[0])
    : null;

  const updateSelectedFillBlankAnswer = useCallback(
    (blankId: string, value: string) => {
      if (!selectedProblem || selectedProblem.type !== 'fill_blank') return;
      setBlankAnswers((prev) => ({
        ...prev,
        [selectedProblem.id]: {
          ...(prev[selectedProblem.id] ?? {}),
          [blankId]: value,
        },
      }));
      setAnswerFeedbackByProblemId((prev) => {
        if (!prev[selectedProblem.id]) return prev;
        const next = { ...prev };
        delete next[selectedProblem.id];
        return next;
      });
    },
    [selectedProblem, setAnswerFeedbackByProblemId, setBlankAnswers],
  );

  const insertSymbolIntoActiveBlank = useCallback(
    (symbol: string) => {
      if (!selectedProblem || !selectedActiveBlank) return;
      const currentValue = blankAnswers[selectedProblem.id]?.[selectedActiveBlank.id] ?? '';
      const input = fillBlankAnswerInputRef.current;
      const selectionStart = input?.selectionStart ?? currentValue.length;
      const selectionEnd = input?.selectionEnd ?? selectionStart;
      const nextValue = `${currentValue.slice(0, selectionStart)}${symbol}${currentValue.slice(selectionEnd)}`;
      const nextCaret = selectionStart + symbol.length;
      updateSelectedFillBlankAnswer(selectedActiveBlank.id, nextValue);
      window.setTimeout(() => {
        fillBlankAnswerInputRef.current?.focus();
        fillBlankAnswerInputRef.current?.setSelectionRange(nextCaret, nextCaret);
      }, 0);
    },
    [blankAnswers, selectedActiveBlank, selectedProblem, updateSelectedFillBlankAnswer],
  );
  const latestPracticeDraftSignatureRef = useRef('');

  useEffect(() => {
    if (!isPracticeMode || !selectedProblemId) return;
    onPracticeProblemChange?.(selectedProblemId);
  }, [isPracticeMode, onPracticeProblemChange, selectedProblemId]);

  useEffect(() => {
    if (!isPracticeMode || !selectedProblem?.id) return;
    const signature = `${selectedProblem.id}:${JSON.stringify(selectedProblemCurrentAnswer ?? null)}`;
    if (latestPracticeDraftSignatureRef.current === signature) return;
    latestPracticeDraftSignatureRef.current = signature;
    onPracticeAnswerDraftChange?.(selectedProblem.id, selectedProblemCurrentAnswer);
  }, [
    isPracticeMode,
    onPracticeAnswerDraftChange,
    selectedProblem?.id,
    selectedProblemCurrentAnswer,
  ]);
  const selectedProblemLatestDetailedAttempt = selectedProblemAttempts[0] ?? null;
  const selectedProblemSubmissionCount = selectedProblemAttempts.filter(
    (attempt) => attempt.kind === 'submit' || attempt.kind === 'answer',
  ).length;
  const selectedProblemHasLimitedSubmissions = selectedProblem
    ? hasLimitedSubmissions(selectedProblem.type)
    : false;
  const selectedProblemRemainingSubmissions = remainingSubmissions(selectedProblemSubmissionCount);
  const selectedProblemSubmissionLimitReached =
    selectedProblemHasLimitedSubmissions &&
    selectedProblemAttemptsLoaded &&
    selectedProblemRemainingSubmissions === 0;
  const selectedProblemNextAttemptNumber = Math.min(3, selectedProblemSubmissionCount + 1);
  const problemSubmissionStatus = selectedProblemHasLimitedSubmissions ? (
    <span
      aria-live="polite"
      className="whitespace-nowrap text-[11px] font-medium text-slate-500 dark:text-slate-400"
    >
      {selectedProblemAttemptsLoaded
        ? selectedProblemSubmissionLimitReached
          ? locale === 'zh-CN'
            ? '3 次机会已用完'
            : 'No attempts remaining'
          : locale === 'zh-CN'
            ? `剩余 ${selectedProblemRemainingSubmissions} 次 · 下次最高 ${maxScoreForAttempt(selectedProblemNextAttemptNumber)} 分`
            : `${selectedProblemRemainingSubmissions} left · next max ${maxScoreForAttempt(selectedProblemNextAttemptNumber)}`
        : locale === 'zh-CN'
          ? '正在读取尝试次数…'
          : 'Checking attempts...'}
    </span>
  ) : null;
  const problemSubmissionActions = (
    <div
      data-problem-submission-actions
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
    >
      {!showCourseNavigation ? problemSubmissionStatus : null}
      {selectedProblem && courseAccessRole !== 'owner' && !previewMode ? (
        <ProblemForumPublishDialog
          key={selectedProblem.id}
          courseId={courseId}
          problemId={selectedProblem.id}
          problemTitle={selectedProblemTitle || selectedProblem.title}
          locale={locale}
        />
      ) : null}
    </div>
  );
  const selectedProblemCodeTabs: CodePracticeTab[] =
    selectedProblem?.type === 'code' && selectedProblemContent?.type === 'code'
      ? canEditProblems && (selectedProblem.secretJudge?.secretTests?.length ?? 0) > 0
        ? ['testcase', 'secret', 'code', 'output']
        : ['testcase', 'code', 'output']
      : [];
  const visiblePracticePaneTabs = normalizePracticePaneTabs(
    practicePaneTabs,
    selectedProblemSupportsFormulaTab,
    canEditProblems,
    selectedProblemSupportsPreviewTab,
    selectedProblemCodeTabs,
    practiceHeaderPlacement === 'external',
    true,
    Boolean(practiceAiHelp),
  );
  const normalizedPracticePaneActive = normalizePracticePaneActive(
    practicePaneActive,
    visiblePracticePaneTabs,
  );
  const visiblePracticePaneActive: PracticePaneActive =
    practiceAiHelp?.active && visiblePracticePaneTabs.right.includes(AI_HELP_PRACTICE_TAB)
      ? { ...normalizedPracticePaneActive, right: AI_HELP_PRACTICE_TAB }
      : normalizedPracticePaneActive;
  const visiblePracticePanelTabs = new Set([
    ...visiblePracticePaneTabs.left,
    ...visiblePracticePaneTabs.right,
  ]);
  const visibleDraggingPracticeTab =
    draggingPracticeTab && visiblePracticePanelTabs.has(draggingPracticeTab)
      ? draggingPracticeTab
      : null;
  const problemEditPaneActive =
    canEditProblems &&
    (visiblePracticePaneActive.left === 'edit' || visiblePracticePaneActive.right === 'edit');
  const reviewPracticeProblemIds = Array.from(new Set(practiceProblemIds ?? []));
  const isReviewPracticeMode = isPracticeMode && reviewPracticeProblemIds.length > 0;
  const reviewPracticeProblems = isReviewPracticeMode
    ? reviewPracticeProblemIds
        .map((problemId) => problems.find((problem) => problem.id === problemId))
        .filter((problem): problem is (typeof problems)[number] => Boolean(problem))
    : [];
  const reviewPracticeIndex =
    isReviewPracticeMode && selectedProblem
      ? reviewPracticeProblems.findIndex((problem) => problem.id === selectedProblem.id)
      : -1;
  const headerPreviousPracticeTarget =
    isReviewPracticeMode && reviewPracticeIndex > 0
      ? reviewPracticeProblems[reviewPracticeIndex - 1]
      : isReviewPracticeMode
        ? null
        : previousPracticeTarget;
  const headerNextPracticeTarget =
    isReviewPracticeMode && reviewPracticeIndex >= 0
      ? (reviewPracticeProblems[reviewPracticeIndex + 1] ?? null)
      : isReviewPracticeMode
        ? null
        : nextPracticeTarget;
  const practiceHeaderProgressCurrent =
    isReviewPracticeMode && reviewPracticeIndex >= 0
      ? reviewPracticeIndex + 1
      : currentFilteredProblemPosition > 0
        ? currentFilteredProblemPosition
        : 0;
  const practiceHeaderProgressTotal = isReviewPracticeMode
    ? reviewPracticeProblems.length
    : practiceNavigationProblemCount;
  const handlePracticeTargetChange = useCallback(
    (problem: (typeof problems)[number]) => {
      if (isReviewPracticeMode) {
        setSelectedProblemId(problem.id);
        return;
      }
      navigateToPracticeProblem(problem);
    },
    [isReviewPracticeMode, navigateToPracticeProblem, setSelectedProblemId],
  );
  const practiceHeaderProgressLabel = (() => {
    if (isReviewPracticeMode) {
      return reviewPracticeIndex >= 0
        ? `${reviewPracticeIndex + 1}/${reviewPracticeProblems.length}`
        : '1/1';
    }
    if (currentFilteredProblemPosition > 0) {
      return `${currentFilteredProblemPosition}/${practiceNavigationProblemCount}`;
    }
    return '0/0';
  })();
  const reviewPracticeProblemIdKey = reviewPracticeProblemIds.join('\u001f');
  const handlePracticeStepChange = useCallback(
    (step: -1 | 1) => {
      if (isReviewPracticeMode) {
        const ids = reviewPracticeProblemIdKey.split('\u001f');
        setSelectedProblemId((current) => {
          const index = ids.indexOf(current ?? '');
          return index >= 0 ? (ids[index + step] ?? current) : current;
        });
        return;
      }
      const target = step === -1 ? headerPreviousPracticeTarget : headerNextPracticeTarget;
      if (target) handlePracticeTargetChange(target);
    },
    [
      isReviewPracticeMode,
      reviewPracticeProblemIdKey,
      setSelectedProblemId,
      headerPreviousPracticeTarget,
      headerNextPracticeTarget,
      handlePracticeTargetChange,
    ],
  );
  const previousPracticeHeaderLabel = locale === 'zh-CN' ? '上一题' : 'Prev';
  const nextPracticeHeaderLabel = locale === 'zh-CN' ? '下一题' : 'Next';
  const practiceHeaderState = useMemo<CourseProblemPracticeHeaderState | null>(() => {
    if (!isPracticeMode || !selectedProblem) return null;
    return {
      problemId: selectedProblem.id,
      problem: selectedProblem,
      problemTitle: selectedProblemTitle,
      problemContent: selectedProblemContent,
      currentAnswer: selectedProblemCurrentAnswer,
      latestAttempt: selectedProblemLatestDetailedAttempt,
      progressLabel: practiceHeaderProgressLabel,
      progressCurrent: practiceHeaderProgressCurrent,
      progressTotal: practiceHeaderProgressTotal,
      notebookLabel: selectedProblemChapterLabel || null,
      difficultyLabel: difficultyLabel(selectedProblem.difficulty, locale),
      difficultyClassName: difficultyTextClassName(selectedProblem.difficulty),
      previousLabel: previousPracticeHeaderLabel,
      previousTitle: headerPreviousPracticeTarget
        ? headerPreviousPracticeTarget.title
        : locale === 'zh-CN'
          ? '没有上一题'
          : 'No previous problem',
      previousDisabled: !headerPreviousPracticeTarget,
      nextLabel: nextPracticeHeaderLabel,
      nextTitle: headerNextPracticeTarget
        ? headerNextPracticeTarget.title
        : locale === 'zh-CN'
          ? '没有下一题'
          : 'No next problem',
      nextDisabled: !headerNextPracticeTarget,
      onPrevious: headerPreviousPracticeTarget ? () => handlePracticeStepChange(-1) : null,
      onNext: headerNextPracticeTarget ? () => handlePracticeStepChange(1) : null,
    };
  }, [
    handlePracticeStepChange,
    headerNextPracticeTarget,
    headerPreviousPracticeTarget,
    isPracticeMode,
    locale,
    nextPracticeHeaderLabel,
    practiceHeaderProgressCurrent,
    practiceHeaderProgressLabel,
    practiceHeaderProgressTotal,
    previousPracticeHeaderLabel,
    selectedProblem,
    selectedProblemContent,
    selectedProblemCurrentAnswer,
    selectedProblemLatestDetailedAttempt,
    selectedProblemChapterLabel,
    selectedProblemTitle,
  ]);

  const courseSpaceHeaderActions = useMemo(() => {
    if (!showCourseNavigation) {
      return null;
    }

    if (!isPracticeMode) {
      if (!canEditProblems) return null;

      return (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 shadow-none hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => setChapterManagerOpen(true)}
          >
            {locale === 'zh-CN' ? '管理章节' : 'Manage chapters'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (problemChapters.length === 0) setChapterManagerOpen(true);
              void handleAiFileUnfiledProblems();
            }}
            disabled={autoArchiving || problems.length === 0}
            className="h-8 gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
          >
            {autoArchiving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {locale === 'zh-CN' ? 'AI 归档' : 'AI file'}
          </Button>
        </div>
      );
    }

    if (!selectedProblem || practiceHeaderPlacement === 'external') return null;

    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 shadow-none hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          disabled={!headerPreviousPracticeTarget}
          onClick={() => {
            if (!headerPreviousPracticeTarget) return;
            handlePracticeStepChange(-1);
          }}
          title={
            headerPreviousPracticeTarget
              ? headerPreviousPracticeTarget.title
              : locale === 'zh-CN'
                ? '没有上一题'
                : 'No previous problem'
          }
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {previousPracticeHeaderLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 shadow-none hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          disabled={!headerNextPracticeTarget}
          onClick={() => {
            if (!headerNextPracticeTarget) return;
            handlePracticeStepChange(1);
          }}
          title={
            headerNextPracticeTarget
              ? headerNextPracticeTarget.title
              : locale === 'zh-CN'
                ? '没有下一题'
                : 'No next problem'
          }
        >
          {nextPracticeHeaderLabel}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    );
  }, [
    autoArchiving,
    canEditProblems,
    handlePracticeStepChange,
    handleAiFileUnfiledProblems,
    headerNextPracticeTarget,
    headerPreviousPracticeTarget,
    isPracticeMode,
    locale,
    nextPracticeHeaderLabel,
    practiceHeaderPlacement,
    previousPracticeHeaderLabel,
    problemChapters.length,
    problems.length,
    selectedProblem,
    showCourseNavigation,
  ]);

  useEffect(() => {
    if (!onPracticeHeaderStateChange) return;
    onPracticeHeaderStateChange(practiceHeaderState);
    return () => {
      onPracticeHeaderStateChange(null);
    };
  }, [onPracticeHeaderStateChange, practiceHeaderState]);

  const handleSubmitAndShowHistory = async () => {
    const submitted = await handleSubmitInlineAnswer();
    if (!submitted) return;
    toast.success(
      locale === 'zh-CN'
        ? '答案已提交，可在「提交历史」查看详情。'
        : 'Submitted. Open History to view details.',
    );
  };
  const handleRunCodeAndShowOutput = async (pane: PracticePaneId, target: CourseCodeRunTarget) => {
    const ran = await handleRunCodeAnswer(target);
    if (!ran || !visiblePracticePanelTabs.has('output')) return;
    setPracticePaneActive((prev) => ({
      ...prev,
      [pane]: 'output',
    }));
  };
  const practiceTabLabel = (tab: PracticePanelTab) => {
    switch (tab) {
      case 'description':
        return locale === 'zh-CN' ? '题目描述' : 'Description';
      case 'formula':
        return locale === 'zh-CN' ? '公式表' : 'Formula';
      case 'edit':
        return locale === 'zh-CN' ? '编辑题目' : 'Edit';
      case 'testcase':
        return locale === 'zh-CN' ? '测试用例' : 'Testcase';
      case 'secret':
        return locale === 'zh-CN' ? '隐藏测试' : 'Secret Test';
      case 'code':
        return locale === 'zh-CN' ? '代码' : 'Code';
      case 'output':
        return locale === 'zh-CN' ? '运行结果' : 'Output';
      case 'answer':
        return locale === 'zh-CN' ? '作答' : 'Answer';
      case 'preview':
        return problemEditPaneActive
          ? locale === 'zh-CN'
            ? '预览题目'
            : 'Problem preview'
          : locale === 'zh-CN'
            ? '预览'
            : 'Preview';
      case 'solution':
        return locale === 'zh-CN' ? '题解' : 'Solution';
      case 'history':
        return locale === 'zh-CN' ? '提交历史' : 'History';
      case AI_HELP_PRACTICE_TAB:
        return locale === 'zh-CN' ? 'AI 解答' : 'AI answer';
      default:
        return tab;
    }
  };
  const practiceTabMeta = (tab: PracticePanelTab) => {
    const label = practiceTabLabel(tab);
    switch (tab) {
      case 'description':
        return {
          label,
          Icon: Type,
          iconClassName: 'text-sky-600 dark:text-sky-300',
        };
      case 'formula':
        return {
          label,
          Icon: BookOpen,
          iconClassName: 'text-indigo-500 dark:text-indigo-300',
        };
      case 'edit':
        return {
          label,
          Icon: SlidersHorizontal,
          iconClassName: 'text-violet-500 dark:text-violet-300',
        };
      case 'testcase':
        return {
          label,
          Icon: CheckSquare,
          iconClassName: 'text-emerald-600 dark:text-emerald-300',
        };
      case 'secret':
        return {
          label,
          Icon: CheckSquare,
          iconClassName: 'text-amber-500 dark:text-amber-300',
        };
      case 'code':
        return {
          label,
          Icon: Code2,
          iconClassName: 'text-cyan-600 dark:text-cyan-300',
        };
      case 'answer':
        return {
          label,
          Icon: CheckSquare,
          iconClassName: 'text-emerald-600 dark:text-emerald-300',
        };
      case 'preview':
        return {
          label,
          Icon: Maximize2,
          iconClassName: 'text-blue-500 dark:text-blue-300',
        };
      case 'solution':
        return {
          label,
          Icon: Sparkles,
          iconClassName: 'text-fuchsia-500 dark:text-fuchsia-300',
        };
      case 'history':
        return {
          label,
          Icon: ChevronUp,
          iconClassName: 'text-slate-500 dark:text-slate-300',
        };
      case AI_HELP_PRACTICE_TAB:
        return {
          label,
          Icon: Sparkles,
          iconClassName: 'text-sky-600 dark:text-sky-300',
        };
      case 'output':
        return {
          label,
          Icon: Terminal,
          iconClassName: 'text-slate-500 dark:text-slate-300',
        };
      default:
        return {
          label,
          Icon: Type,
          iconClassName: 'text-slate-400',
        };
    }
  };
  const handlePracticePaneTabSelect = (pane: PracticePaneId, tab: PracticePanelTab) => {
    if (!visiblePracticePanelTabs.has(tab)) return;
    setPracticePaneActive((prev) => ({ ...prev, [pane]: tab }));
    if (tab === AI_HELP_PRACTICE_TAB) {
      practiceAiHelp?.onActiveChange(true);
      return;
    }
    if (pane === 'right') {
      practiceAiHelp?.onActiveChange(false);
    }
    if (isProblemInfoPracticeTab(tab)) {
      handleProblemInfoTabChange(tab);
      return;
    }
    if (isAnswerPracticeTab(tab)) {
      setAnswerPanelTab(tab);
    }
  };
  const handlePracticeTabDragStart =
    (tab: PracticePanelTab) => (event: DragEvent<HTMLButtonElement>) => {
      setDraggingPracticeTab(tab);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(PRACTICE_TAB_DRAG_TYPE, tab);
    };
  const handlePracticeTabDrop =
    (targetPane: PracticePaneId) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const tab = event.dataTransfer.getData(PRACTICE_TAB_DRAG_TYPE) as PracticePanelTab;
      if (!tab || !visiblePracticePanelTabs.has(tab)) return;
      const sourcePane = visiblePracticePaneTabs.left.includes(tab) ? 'left' : 'right';
      if (sourcePane !== targetPane && visiblePracticePaneTabs[sourcePane].length <= 1) {
        setDraggingPracticeTab(null);
        return;
      }
      const nextTabs: PracticePaneTabs = {
        left: visiblePracticePaneTabs.left.filter((item) => item !== tab),
        right: visiblePracticePaneTabs.right.filter((item) => item !== tab),
      };
      nextTabs[targetPane] = [...nextTabs[targetPane], tab];
      setPracticePaneTabs(nextTabs);
      setPracticePaneActive((prev) => ({
        ...prev,
        [sourcePane]: nextTabs[sourcePane][0] ?? prev[sourcePane],
        [targetPane]: tab,
      }));
      if (isProblemInfoPracticeTab(tab)) {
        handleProblemInfoTabChange(tab);
      } else if (isAnswerPracticeTab(tab)) {
        setAnswerPanelTab(tab);
      }
      setDraggingPracticeTab(null);
    };
  const practicePaneHeaderClassName = (pane: PracticePaneId) =>
    cn(
      'flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 px-3.5 dark:border-slate-800',
      visibleDraggingPracticeTab &&
        !visiblePracticePaneTabs[pane].includes(visibleDraggingPracticeTab) &&
        'bg-sky-50/70 dark:bg-sky-500/10',
    );
  const practiceTabClassName = (tab: PracticePanelTab, active: boolean) =>
    cn(
      'inline-flex h-8 cursor-grab items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition active:cursor-grabbing',
      active
        ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100',
    );
  const renderPracticePaneHeader = (pane: PracticePaneId) => {
    const activeTab = visiblePracticePaneActive[pane];
    const activeCodeRunTarget: CourseCodeRunTarget | null =
      activeTab === 'code'
        ? 'code'
        : activeTab === 'testcase'
          ? 'public'
          : activeTab === 'secret'
            ? 'secret'
            : null;
    const activeCodeRunLabel =
      activeCodeRunTarget === 'secret'
        ? locale === 'zh-CN'
          ? '运行隐藏测试'
          : 'Run secret tests'
        : activeCodeRunTarget === 'public'
          ? locale === 'zh-CN'
            ? '运行测试'
            : 'Run tests'
          : locale === 'zh-CN'
            ? '运行'
            : 'Run';
    return (
      <div
        className={practicePaneHeaderClassName(pane)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handlePracticeTabDrop(pane)}
      >
        {visiblePracticePaneTabs[pane].map((tab) =>
          (() => {
            const { Icon, iconClassName, label } = practiceTabMeta(tab);
            return (
              <button
                key={tab}
                type="button"
                draggable={tab !== AI_HELP_PRACTICE_TAB}
                onDragStart={handlePracticeTabDragStart(tab)}
                onDragEnd={() => setDraggingPracticeTab(null)}
                onClick={() => handlePracticePaneTabSelect(pane, tab)}
                className={practiceTabClassName(tab, activeTab === tab)}
              >
                <Icon className={cn('h-4 w-4', iconClassName)} />
                {label}
              </button>
            );
          })(),
        )}
        {selectedProblemHasTranslation && isProblemInfoPracticeTab(activeTab) ? (
          <div className="ml-auto">
            <ProblemLanguageToggle
              value={problemLanguage}
              locale={locale}
              onChange={setProblemLanguage}
            />
          </div>
        ) : null}
        {activeTab === 'answer' || activeCodeRunTarget ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!showCourseNavigation ? problemSubmissionActions : null}
            {activeCodeRunTarget ? (
              <Button
                type="button"
                onClick={() => handleRunCodeAndShowOutput(pane, activeCodeRunTarget)}
                disabled={runningCode || submittingAnswer}
                className={cn(
                  'h-8 shrink-0 rounded-md px-3 text-xs font-semibold',
                  PROBLEM_BANK_EMERALD_OUTLINE_BUTTON_CLASS,
                )}
              >
                {runningCode && runningCodeTarget === activeCodeRunTarget ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                {activeCodeRunLabel}
              </Button>
            ) : null}
            {activeTab === 'answer' || activeTab === 'code' ? (
              <Button
                onClick={handleSubmitAndShowHistory}
                disabled={
                  submittingAnswer ||
                  runningCode ||
                  (selectedProblemHasLimitedSubmissions &&
                    (!selectedProblemAttemptsLoaded || selectedProblemSubmissionLimitReached))
                }
                className={cn(
                  'h-8 shrink-0 rounded-md px-3 text-xs font-semibold',
                  PROBLEM_BANK_EMERALD_ACTION_BUTTON_CLASS,
                )}
              >
                {submittingAnswer ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                {locale === 'zh-CN' ? '提交答案' : 'Submit'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };
  const renderProblemInfoPaneContent = (tab: ProblemInfoTab) => {
    if (!selectedProblem) return null;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 text-[15px] leading-8 text-slate-800 sm:px-5 sm:py-5 dark:text-slate-200">
        {tab === 'description' ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            <div className="pb-8 sm:pb-10">
              <h1
                className="mb-4 border-b border-slate-200 pb-3 text-base font-semibold leading-7 text-slate-950 dark:border-slate-800 dark:text-white"
                title={selectedProblemTitle}
              >
                <ProblemTitleText content={selectedProblemTitle} />
              </h1>
              <div className="mb-4 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
                  {selectedProblem.chapterName || (locale === 'zh-CN' ? '未归档' : 'Unfiled')}
                </span>
                {canEditProblems ? (
                  <button
                    type="button"
                    onClick={() => setRecentSubmissionsProblem(selectedProblem)}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200 dark:hover:bg-violet-400/15"
                  >
                    <History className="size-3.5" />
                    {locale === 'zh-CN' ? '最近提交' : 'Recent submissions'}
                  </button>
                ) : null}
              </div>
              {selectedProblemContent?.type === 'code' ? (
                <CodeProblemStatement content={selectedProblemContent} locale={locale} />
              ) : selectedFillBlankContent ? (
                <InlineFillBlankPrompt
                  content={selectedFillBlankContent}
                  values={blankAnswers[selectedProblem.id] ?? {}}
                  disabled={submittingAnswer}
                  locale={locale}
                  onFocusBlank={setActiveFillBlankId}
                  onChangeBlank={updateSelectedFillBlankAnswer}
                />
              ) : selectedProblemContent && renderProblemContentStem(selectedProblemContent) ? (
                <ProblemRichText content={renderProblemContentStem(selectedProblemContent)} />
              ) : (
                <p>{locale === 'zh-CN' ? '暂无题面。' : 'No stem available.'}</p>
              )}
              <ProblemImageAssets
                content={selectedProblemContent}
                className="mt-6 sm:grid-cols-1 [&_figure]:rounded-lg [&_figure]:bg-white [&_img]:max-h-[360px]"
              />
            </div>
            <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              {problemMetaChips(selectedProblem, locale).map((chip) => (
                <ProblemMetaChip
                  key={chip.key}
                  label={chip.label}
                  Icon={chip.Icon}
                  className={chip.className}
                />
              ))}
            </div>
          </div>
        ) : tab === 'formula' ? (
          <FormulaReferencePanel locale={locale} onInsert={insertFormulaIntoAnswer} />
        ) : canEditProblems && selectedProblemEditDraft ? (
          <ProblemDraftForm
            key={`${selectedProblemEditDraft.draftId}-${selectedProblem.updatedAt}`}
            draft={selectedProblemEditDraft}
            locale={locale}
            saveLabel={locale === 'zh-CN' ? '保存题目' : 'Save problem'}
            onDraftChange={handleEditingDraftChange}
            onSave={async (nextDraft) => {
              await handleUpdateProblem(problemDraftToPatch(nextDraft));
              toast.success(locale === 'zh-CN' ? '题目已更新' : 'Problem updated');
            }}
          />
        ) : null}
      </div>
    );
  };
  const renderAnswerPaneContent = (tab: AnswerPanelTab) => {
    if (!selectedProblem) return null;
    const codeAnswerActive =
      tab === 'answer' &&
      selectedProblem.type === 'code' &&
      selectedProblemContent?.type === 'code';
    return (
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          codeAnswerActive ? 'overflow-hidden p-0' : 'overflow-y-auto p-3 sm:p-4',
        )}
      >
        {tab === 'answer' ? (
          <div className={cn('flex flex-col', codeAnswerActive ? 'min-h-0 flex-1' : 'min-h-full')}>
            {selectedProblem.type === 'choice' && selectedProblemContent?.type === 'choice' ? (
              <div className="space-y-2">
                {selectedProblemContent.options.map((option) => {
                  const selected = choiceAnswers[selectedProblem.id] ?? [];
                  const multi = selectedProblemContent.selectionMode === 'multiple';
                  const correctOptionIds = selectedAnswerFeedback?.correctOptionIds ?? [];
                  const hasAnswerFeedback = Boolean(selectedAnswerFeedback);
                  const isCorrectOption = correctOptionIds.includes(option.id);
                  const isWrongSelected =
                    hasAnswerFeedback && selected.includes(option.id) && !isCorrectOption;
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-[15px] transition dark:border-slate-700',
                        hasAnswerFeedback && isCorrectOption
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-50'
                          : isWrongSelected
                            ? 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-50'
                            : selected.includes(option.id)
                              ? 'border-sky-300 bg-sky-50 text-slate-950 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-white'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900/70',
                      )}
                    >
                      <input
                        className="mt-1 size-4 accent-sky-600"
                        type={multi ? 'checkbox' : 'radio'}
                        checked={selected.includes(option.id)}
                        onChange={(event) => {
                          setChoiceAnswers((prev) => {
                            const current = prev[selectedProblem.id] ?? [];
                            const next = multi
                              ? event.target.checked
                                ? [...current, option.id]
                                : current.filter((item) => item !== option.id)
                              : [option.id];
                            return {
                              ...prev,
                              [selectedProblem.id]: Array.from(new Set(next)),
                            };
                          });
                          setAnswerFeedbackByProblemId((prev) => {
                            if (!prev[selectedProblem.id]) return prev;
                            const next = { ...prev };
                            delete next[selectedProblem.id];
                            return next;
                          });
                        }}
                      />
                      <div className="flex min-w-0 flex-1 items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 font-medium">{option.id}.</span>
                        <ProblemRichText
                          content={option.label}
                          className="min-w-0 flex-1 [&_.problem-rich-code-block]:my-0 [&_.problem-rich-code-block]:max-w-full"
                        />
                      </div>
                      {hasAnswerFeedback && isCorrectOption ? (
                        <CheckCircle2 className="ml-auto mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                      ) : isWrongSelected ? (
                        <X className="ml-auto mt-1 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : selectedProblem.type === 'fill_blank' &&
              selectedProblemContent?.type === 'fill_blank' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-xs leading-5 text-fuchsia-900 dark:border-fuchsia-500/25 dark:bg-fuchsia-500/10 dark:text-fuchsia-100">
                  {locale === 'zh-CN'
                    ? '可以直接在左侧题面填写，也可以在这里集中作答；两边内容会实时同步。'
                    : 'Answer directly in the prompt or use this focused editor; both stay in sync.'}
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    {selectedProblemContent.blanks.map((blank, index) => {
                      const active = selectedActiveBlank?.id === blank.id;
                      const hasValue = Boolean(
                        blankAnswers[selectedProblem.id]?.[blank.id]?.trim(),
                      );
                      return (
                        <button
                          key={blank.id}
                          type="button"
                          onClick={() => {
                            setActiveFillBlankId(blank.id);
                            window.setTimeout(() => fillBlankAnswerInputRef.current?.focus(), 0);
                          }}
                          className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition',
                            active
                              ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200'
                              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
                          )}
                        >
                          <span>{index + 1}</span>
                          <span>
                            {blank.placeholder?.trim() ||
                              (locale === 'zh-CN' ? `第 ${index + 1} 空` : `Blank ${index + 1}`)}
                          </span>
                          {hasValue ? <CheckCircle2 className="size-3" /> : null}
                        </button>
                      );
                    })}
                  </div>
                  {selectedActiveBlank ? (
                    <div className="space-y-2">
                      <label
                        htmlFor={`fill-blank-${selectedProblem.id}-${selectedActiveBlank.id}`}
                        className="block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        {selectedActiveBlank.placeholder?.trim() ||
                          (locale === 'zh-CN' ? '当前空格' : 'Current blank')}
                      </label>
                      <Input
                        ref={fillBlankAnswerInputRef}
                        id={`fill-blank-${selectedProblem.id}-${selectedActiveBlank.id}`}
                        value={blankAnswers[selectedProblem.id]?.[selectedActiveBlank.id] ?? ''}
                        disabled={submittingAnswer}
                        placeholder={locale === 'zh-CN' ? '输入答案' : 'Enter answer'}
                        onChange={(event) =>
                          updateSelectedFillBlankAnswer(selectedActiveBlank.id, event.target.value)
                        }
                        className="h-10 text-base shadow-none"
                      />
                    </div>
                  ) : null}
                  <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      {locale === 'zh-CN' ? '常用数学符号' : 'Common math symbols'}
                    </p>
                    <CommonMathSymbols locale={locale} onInsert={insertSymbolIntoActiveBlank} />
                  </div>
                </div>
              </div>
            ) : selectedProblem.type === 'code' && selectedProblemContent?.type === 'code' ? (
              <CodeAnswerWorkspace
                value={codeAnswers[selectedProblem.id] ?? selectedProblemContent.starterCode ?? ''}
                onChange={(value) =>
                  setCodeAnswers((prev) => ({
                    ...prev,
                    [selectedProblem.id]: value,
                  }))
                }
                disabled={submittingAnswer}
                locale={locale}
              />
            ) : supportsPhotoAnswer(selectedProblem) && selectedAnswerMode === 'photo' ? (
              <PhotoAnswerUploader
                inputId={`photo-answer-${selectedProblem.id}`}
                photos={photoAnswers[selectedProblem.id] ?? []}
                disabled={submittingAnswer}
                locale={locale}
                onAddFiles={handleAddPhotoAnswerFiles}
                onRemovePhoto={handleRemovePhotoAnswer}
              />
            ) : (
              <AnswerComposer
                value={textAnswers[selectedProblem.id] ?? ''}
                onChange={setSelectedTextAnswer}
                controller={selectedAnswerController}
                showToolbar={false}
                showToolbarPanels={!showSidebarAnswerTools}
                locale={locale}
                className="flex min-h-[300px] flex-1 flex-col sm:min-h-[360px]"
                textareaClassName="flex-1"
                placeholder={answerComposerPlaceholder(locale)}
              />
            )}
            {supportsPhotoAnswer(selectedProblem) ? (
              <div className="mt-3 flex w-full flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-8 gap-1.5 rounded-md px-3 text-xs font-semibold',
                    selectedAnswerMode === 'text'
                      ? PROBLEM_BANK_EMERALD_ACTION_BUTTON_CLASS
                      : PROBLEM_BANK_EMERALD_OUTLINE_BUTTON_CLASS,
                  )}
                  onClick={() =>
                    setAnswerModes((prev) => ({
                      ...prev,
                      [selectedProblem.id]: 'text',
                    }))
                  }
                >
                  <Type className="h-4 w-4" />
                  {locale === 'zh-CN' ? '文字输入' : 'Text'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-8 gap-1.5 rounded-md px-3 text-xs font-semibold',
                    selectedAnswerMode === 'photo'
                      ? PROBLEM_BANK_EMERALD_ACTION_BUTTON_CLASS
                      : PROBLEM_BANK_EMERALD_OUTLINE_BUTTON_CLASS,
                  )}
                  onClick={() =>
                    setAnswerModes((prev) => ({
                      ...prev,
                      [selectedProblem.id]: 'photo',
                    }))
                  }
                >
                  <ImagePlus className="h-4 w-4" />
                  {locale === 'zh-CN' ? '照片上传' : 'Photos'}
                </Button>
                {selectedAnswerFeedback ? (
                  <AnswerFeedbackSummaryBadge
                    feedback={selectedAnswerFeedback}
                    points={selectedProblemPoints}
                    locale={locale}
                    className="ml-auto max-w-[min(21rem,100%)]"
                  />
                ) : null}
              </div>
            ) : null}
            {selectedAnswerFeedback && !supportsPhotoAnswer(selectedProblem) ? (
              <AnswerFeedbackSummaryBadge
                feedback={selectedAnswerFeedback}
                points={selectedProblemPoints}
                locale={locale}
                className="mt-3"
              />
            ) : null}
          </div>
        ) : tab === 'preview' && problemEditPaneActive ? (
          visibleProblemPreviewDraft ? (
            <ProblemDraftPreviewPanel draft={visibleProblemPreviewDraft} locale={locale} />
          ) : (
            <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
              {locale === 'zh-CN' ? '暂无可预览的题目。' : 'No problem preview available.'}
            </div>
          )
        ) : tab === 'preview' ? (
          <div className="flex min-h-full flex-col">
            {selectedProblem.type === 'choice' && selectedProblemContent?.type === 'choice' ? (
              <ChoiceAnswerPreviewPanel
                content={selectedProblemContent}
                selectedOptionIds={
                  choiceAnswers[selectedProblem.id] ??
                  selectedAnswerFeedback?.selectedOptionIds ??
                  []
                }
                feedback={selectedAnswerFeedback}
                locale={locale}
              />
            ) : selectedProblem.type === 'code' && selectedProblem.publicContent.type === 'code' ? (
              <pre className="min-h-[180px] overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-50 dark:border-slate-700">
                {codeAnswers[selectedProblem.id] ??
                  selectedProblem.publicContent.starterCode ??
                  (locale === 'zh-CN' ? '还没有代码。' : 'No code yet.')}
              </pre>
            ) : supportsPhotoAnswer(selectedProblem) && selectedAnswerMode === 'photo' ? (
              (photoAnswers[selectedProblem.id] ?? []).length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(photoAnswers[selectedProblem.id] ?? []).map((photo) => (
                    <figure
                      key={photo.id}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60"
                    >
                      <img
                        src={photo.dataUrl}
                        alt={photo.name}
                        className="max-h-72 w-full object-contain"
                      />
                      <figcaption className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {photo.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                  {locale === 'zh-CN' ? '还没有上传照片。' : 'No photos uploaded yet.'}
                </div>
              )
            ) : (
              <AnswerPreviewPanel
                value={selectedTextAnswerValue}
                placeholder={answerComposerPlaceholder(locale)}
              />
            )}
          </div>
        ) : tab === 'history' ? (
          selectedProblem.type === 'code' ? (
            <AttemptHistoryList
              key={selectedProblem.id}
              attempts={selectedProblemAttempts}
              loading={selectedProblemAttemptsLoading}
              points={selectedProblem.points}
              locale={locale}
            />
          ) : (
            <AttemptHistoryPanel
              attempts={selectedProblemAttempts}
              loading={selectedProblemAttemptsLoading}
              points={selectedProblem.points}
              locale={locale}
            />
          )
        ) : selectedProblemSolutionSections.length > 0 ? (
          <div className="space-y-4">
            {selectedProblemSolutionSections.map((section, index) => (
              <section key={`${section.title}-${index}`}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {section.title}
                </p>
                {section.contentKind === 'choice-options' && section.options?.length ? (
                  <SolutionChoiceOptions options={section.options} locale={locale} />
                ) : section.contentKind === 'code' ? (
                  <SolutionCodeBlock code={section.content} language={section.language} />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                    <ProblemRichText content={section.content} />
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
            {locale === 'zh-CN' ? '这道题还没有题解。' : 'No solution has been added yet.'}
          </div>
        )}
      </div>
    );
  };
  const renderCodePracticePaneContent = (tab: CodePracticeTab) => {
    if (
      !selectedProblem ||
      selectedProblem.type !== 'code' ||
      selectedProblemContent?.type !== 'code'
    ) {
      return null;
    }
    if (tab === 'output') {
      return (
        <CodeRunOutputPanel
          result={codeRunResults[selectedProblem.id]}
          running={runningCode}
          locale={locale}
        />
      );
    }
    if (tab === 'code') {
      return (
        <CodeAnswerWorkspace
          value={codeAnswers[selectedProblem.id] ?? selectedProblemContent.starterCode ?? ''}
          onChange={(value) =>
            setCodeAnswers((prev) => ({
              ...prev,
              [selectedProblem.id]: value,
            }))
          }
          disabled={submittingAnswer || runningCode}
          locale={locale}
        />
      );
    }

    const testFiles = buildCodeTestFiles(
      selectedProblemContent,
      canEditProblems ? selectedProblem.secretJudge?.secretTests : undefined,
    );
    return (
      <CodeTestcasePanel
        file={tab === 'secret' ? testFiles.secretFile : testFiles.publicFile}
        locale={locale}
      />
    );
  };
  const renderPracticeAiHelpPaneContent = () => {
    const state = practiceAiHelp?.state;
    const waitingForSavedHelp = practiceAiHelp?.hasHelp && !state;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col">
          {state?.status === 'loading' || waitingForSavedHelp ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                {waitingForSavedHelp
                  ? locale === 'zh-CN'
                    ? '正在读取已保存题解…'
                    : 'Loading saved answer...'
                  : locale === 'zh-CN'
                    ? '正在读取题目、作答和课程记忆…'
                    : 'Reading the problem, answer, and course memory...'}
              </div>
            </div>
          ) : state?.answer ? (
            <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <MessageResponse className={practiceAiHelpMarkdownClassName} mode="static">
                {state.answer}
              </MessageResponse>
              {state.status === 'error' ? (
                <p className="mt-4 text-xs text-rose-600 dark:text-rose-300">
                  {state.error ||
                    (locale === 'zh-CN' ? '题解生成失败' : 'Failed to generate answer')}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[180px] flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
              {locale === 'zh-CN'
                ? '点击弹窗顶部的 AI 解答生成讲解。'
                : 'Click AI answer in the popup header to generate an explanation.'}
            </div>
          )}
        </div>
      </div>
    );
  };
  const renderPracticePaneContent = (tab: PracticePanelTab) =>
    tab === AI_HELP_PRACTICE_TAB
      ? renderPracticeAiHelpPaneContent()
      : isProblemInfoPracticeTab(tab)
        ? renderProblemInfoPaneContent(tab)
        : isCodePracticeTab(tab)
          ? renderCodePracticePaneContent(tab)
          : renderAnswerPaneContent(tab);

  const previewDemoCourse =
    previewMode || isLocalDemoProblemBankCourse(courseId)
      ? findLocalDemoTeacherHomeCourse(courseId)
      : undefined;
  const isTeacherCourseSpace = (previewMode && previewAsTeacher) || courseAccessRole === 'owner';
  const courseHeaderFields = resolveCourseSpaceHeaderFields({
    courseCode: previewDemoCourse?.courseCode ?? courseCode,
    code: previewDemoCourse?.courseCode ?? courseCode,
    name: previewDemoCourse?.name ?? courseName,
    academicYear: previewDemoCourse?.academicYear ?? courseAcademicYear,
    academicTerm: previewDemoCourse?.academicTerm ?? courseAcademicTerm,
  });

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col gap-4 sm:gap-5',
        showCourseNavigation && !isPracticeMode && !hasSharedShell && 'min-h-[calc(100dvh-3rem)]',
        showCourseNavigation && hasSharedShell && 'flex-1',
        isPracticeMode && 'min-h-0',
        showChromeBackground ? 'bg-[#f5f5f5] dark:bg-slate-950' : 'bg-transparent',
      )}
    >
      {showCourseNavigation ? (
        <CourseSpaceHeader
          courseId={courseId}
          {...courseHeaderFields}
          role={isTeacherCourseSpace ? 'teacher' : 'student'}
          active="problem-bank"
          problemCount={problems.length}
          forumCount={forumCount}
          previewMode={previewMode}
          actions={courseSpaceHeaderActions}
          beforeTitleActions={isPracticeMode ? problemSubmissionStatus : undefined}
          trailingActions={isPracticeMode ? problemSubmissionActions : undefined}
        />
      ) : null}

      <div
        className={cn(
          'relative flex min-h-0 w-full flex-1 items-stretch gap-2',
          isPracticeMode && 'h-full min-h-0',
          showCourseNavigation && COURSE_SPACE_BODY_SURFACE_CLASS,
          showChromeBackground
            ? cn(
                isPracticeMode ? 'p-2' : 'p-2.5',
                isPracticeMode && practiceHeaderPlacement === 'external' && 'pt-1',
              )
            : 'p-0',
        )}
      >
        {!isPracticeMode ? (
          <>
            <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-hidden rounded-2xl border border-slate-200 bg-white/92 shadow-[0_16px_40px_rgba(15,23,42,0.05)] xl:mr-[312px] dark:border-slate-800 dark:bg-slate-950/55">
              <div className="grid gap-2.5 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  {showCourseTitle && !showCourseNavigation ? (
                    <span className="min-w-0 truncate text-sm font-semibold text-sky-600 dark:text-sky-300">
                      {courseName || (locale === 'zh-CN' ? '课程空间' : 'Course workspace')}
                    </span>
                  ) : null}

                  <label className="relative flex min-w-[180px] max-w-[320px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={
                        locale === 'zh-CN'
                          ? '搜索题号、题目、章节、来源'
                          : 'Search numbers, problems, chapters, sources'
                      }
                      className="h-9 rounded-lg border-slate-200 bg-white pl-9 text-[13px] shadow-none"
                    />
                  </label>

                  <div className="flex w-full flex-wrap items-center gap-1.5 lg:w-auto lg:shrink-0">
                    {courseHasTranslations ? (
                      <ProblemLanguageToggle
                        value={problemLanguage}
                        locale={locale}
                        onChange={setProblemLanguage}
                      />
                    ) : null}
                    <span className="text-xs font-medium text-slate-400">
                      {filteredProblemCount}/{courseProblemCount}
                    </span>
                    <SlidersHorizontal className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
                    {activeBankFilterCount > 0 ? (
                      <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white dark:bg-sky-400 dark:text-slate-950">
                        {activeBankFilterCount}
                      </span>
                    ) : null}
                    <select
                      value={practiceFilter}
                      onChange={(event) =>
                        setPracticeFilter(event.target.value as typeof practiceFilter)
                      }
                      className="h-9 max-w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      aria-label={locale === 'zh-CN' ? '做题进度筛选' : 'Practice progress filter'}
                    >
                      {practiceFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(event.target.value as typeof statusFilter)
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {statusFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {typeFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {option.count == null ? '' : ` · ${option.count}`}
                        </option>
                      ))}
                    </select>
                    <select
                      value={difficultyFilter}
                      onChange={(event) =>
                        setDifficultyFilter(event.target.value as typeof difficultyFilter)
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {difficultyFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {option.count == null ? '' : ` · ${option.count}`}
                        </option>
                      ))}
                    </select>
                    <select
                      value={chapterFilter}
                      onChange={(event) => setChapterFilter(event.target.value)}
                      className="h-9 max-w-[210px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      aria-label={locale === 'zh-CN' ? '章节筛选' : 'Chapter filter'}
                    >
                      {chapterFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {option.count == null ? '' : ` · ${option.count}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  'flex min-h-0 flex-1 flex-col',
                  loading || filteredProblems.length === 0 ? 'overflow-hidden' : 'overflow-auto',
                )}
              >
                {loading ? (
                  <div
                    className="relative m-3 grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.08),transparent_34%),linear-gradient(to_bottom,#f8fafc_0%,#ffffff_72%)] p-6 text-slate-500 ring-1 ring-inset ring-slate-100 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(56,189,248,0.09),transparent_34%),linear-gradient(to_bottom,#0f172a_0%,#020617_72%)] dark:text-slate-400 dark:ring-white/5"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <div className="flex max-w-sm flex-col items-center text-center">
                      <span className="grid size-14 place-items-center rounded-[18px] bg-white text-sky-600 shadow-[0_12px_35px_rgba(14,165,233,0.14)] ring-1 ring-sky-100 dark:bg-slate-950 dark:text-sky-300 dark:ring-sky-500/20">
                        <Loader2 className="size-5 animate-spin" />
                      </span>
                      <p className="mt-4 text-base font-semibold text-slate-800 dark:text-slate-100">
                        {locale === 'zh-CN' ? '正在加载课程题库' : 'Loading course problem bank'}
                      </p>
                      <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {locale === 'zh-CN'
                          ? '题目、章节与作答记录准备好后会显示在这里。'
                          : 'Problems, chapters, and attempt history will appear here when ready.'}
                      </p>
                      <div className="mt-6 flex items-center gap-2" aria-hidden="true">
                        <span className="size-1.5 animate-pulse rounded-full bg-sky-400 motion-reduce:animate-none" />
                        <span className="size-1.5 animate-pulse rounded-full bg-sky-300 delay-150 motion-reduce:animate-none" />
                        <span className="size-1.5 animate-pulse rounded-full bg-sky-200 delay-300 motion-reduce:animate-none" />
                      </div>
                    </div>
                  </div>
                ) : filteredProblems.length === 0 ? (
                  <div className="relative m-3 grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.08),transparent_34%),linear-gradient(to_bottom,#f8fafc_0%,#ffffff_72%)] p-6 text-sm text-slate-500 ring-1 ring-inset ring-slate-100 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(56,189,248,0.09),transparent_34%),linear-gradient(to_bottom,#0f172a_0%,#020617_72%)] dark:text-slate-400 dark:ring-white/5">
                    <div className="flex max-w-md flex-col items-center text-center">
                      <span className="grid size-14 place-items-center rounded-[18px] bg-white text-sky-600 shadow-[0_12px_35px_rgba(14,165,233,0.14)] ring-1 ring-sky-100 dark:bg-slate-950 dark:text-sky-300 dark:ring-sky-500/20">
                        <BookOpen className="size-6" strokeWidth={1.8} />
                      </span>
                      <p className="mt-5 text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-slate-100">
                        {problems.length === 0
                          ? locale === 'zh-CN'
                            ? '题库还没有题目'
                            : 'This problem bank is empty'
                          : locale === 'zh-CN'
                            ? '当前筛选下没有题目'
                            : 'No problems match this filter'}
                      </p>
                      <p className="mt-2 max-w-sm text-[13px] leading-6 text-slate-500 dark:text-slate-400">
                        {problems.length === 0
                          ? locale === 'zh-CN'
                            ? canEditProblems
                              ? '请前往课程资料库，在“题库”分类中上传原始文件并导入。'
                              : '老师上传题目后，会在这里显示课程题库。'
                            : canEditProblems
                              ? 'Upload the source file from the Problem bank category in course resources.'
                              : 'Course problems will appear here after the teacher uploads them.'
                          : locale === 'zh-CN'
                            ? '尝试调整搜索词或筛选条件。'
                            : 'Try changing the search or filters.'}
                      </p>
                      {problems.length === 0 && canEditProblems ? (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/teacher/courses/${encodeURIComponent(courseId)}${previewMode ? '?mock=1' : ''}`,
                            )
                          }
                          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_12px_26px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 motion-reduce:hover:translate-y-0 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                        >
                          <BookOpen className="size-4" />
                          {locale === 'zh-CN' ? '前往资料库' : 'Open resources'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 p-3 lg:hidden">
                      {paginatedProblems.map((problem) => {
                        const selected = selectedProblemId === problem.id;
                        const typeVisual = problemTypeVisual(problem.type);
                        const ProblemTypeIcon = typeVisual.Icon;
                        const localizedContent = getLocalizedProblemContent(
                          problem.publicContent,
                          problemLanguage,
                        );
                        const localizedTitle = getLocalizedProblemTitle(problem, problemLanguage);
                        const classPassRate = classPassRatePresentation(problem, locale);
                        return (
                          <div
                            key={problem.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => navigateToPracticeProblem(problem)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                navigateToPracticeProblem(problem);
                              }
                            }}
                            className={cn(
                              'rounded-xl border p-3 text-sm shadow-sm transition',
                              selected
                                ? 'border-sky-200 bg-sky-50/90 dark:border-sky-500/30 dark:bg-sky-500/10'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900/60',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                    {formatProblemNumber(problem)}
                                  </span>
                                  <span
                                    className={cn(
                                      'inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold',
                                      practiceStateClassName(problem),
                                    )}
                                  >
                                    {practiceStateLabel(problem, locale)}
                                  </span>
                                  <span
                                    className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                                    title={classPassRate.detail}
                                  >
                                    {locale === 'zh-CN' ? '全班' : 'Class'} {classPassRate.value}
                                  </span>
                                  {canEditProblems ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setRecentSubmissionsProblem(problem);
                                      }}
                                      className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200 dark:hover:bg-violet-400/15"
                                    >
                                      <History className="size-3" />
                                      {locale === 'zh-CN' ? '最近提交' : 'Recent'}
                                    </button>
                                  ) : null}
                                  <span
                                    className={cn(
                                      'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold',
                                      typeVisual.className,
                                    )}
                                  >
                                    <ProblemTypeIcon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                      {typeLabel(problem.type, locale)}
                                    </span>
                                  </span>
                                </div>
                                <ProblemTitleText
                                  content={localizedTitle}
                                  className="mt-2 line-clamp-2 font-semibold leading-5 text-slate-950 dark:text-white"
                                />
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                  <ProblemTitleText
                                    content={renderProblemContentStem(localizedContent)}
                                    className="font-normal"
                                    forceInlineMath
                                  />
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  className={cn(
                                    'h-8 px-2.5 text-xs',
                                    PROBLEM_BANK_PRIMARY_BUTTON_CLASS,
                                  )}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    navigateToPracticeProblem(problem);
                                  }}
                                >
                                  {locale === 'zh-CN' ? '练习' : 'Practice'}
                                </Button>
                                {canEditProblems ? (
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon-sm"
                                    disabled={Boolean(deletingProblemId)}
                                    aria-label={
                                      locale === 'zh-CN'
                                        ? `删除题目「${localizedTitle}」`
                                        : `Delete "${localizedTitle}"`
                                    }
                                    title={locale === 'zh-CN' ? '删除题目' : 'Delete problem'}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteProblem(problem);
                                    }}
                                  >
                                    {deletingProblemId === problem.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              <div
                                className="col-span-2 min-w-0"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div className="text-[11px] font-medium text-slate-400">
                                  {locale === 'zh-CN' ? '章节' : 'Chapter'}
                                </div>
                                {canEditProblems ? (
                                  <select
                                    value={problem.chapterId || '__unfiled__'}
                                    disabled={savingChapterProblemId === problem.id}
                                    onChange={(event) =>
                                      void handleChangeProblemChapter(
                                        problem.id,
                                        event.target.value,
                                      )
                                    }
                                    className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                  >
                                    <option value="__unfiled__">
                                      {locale === 'zh-CN' ? '未归档' : 'Unfiled'}
                                    </option>
                                    {problemChapters.map((chapter, index) => (
                                      <option key={chapter.id} value={chapter.id}>
                                        {locale === 'zh-CN'
                                          ? `第 ${index + 1} 章 · ${chapter.name}`
                                          : `Chapter ${index + 1} · ${chapter.name}`}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="mt-1 truncate font-medium text-slate-700 dark:text-slate-200">
                                    {problem.chapterName ||
                                      (locale === 'zh-CN' ? '未归档' : 'Unfiled')}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-medium text-slate-400">
                                  {locale === 'zh-CN' ? '来源' : 'Source'}
                                </div>
                                <div className="truncate font-medium text-slate-700 dark:text-slate-200">
                                  {problem.notebookName ||
                                    (locale === 'zh-CN' ? '未归类' : 'Unassigned')}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-medium text-slate-400">
                                  {locale === 'zh-CN' ? '难度 / 得分' : 'Level / Score'}
                                </div>
                                <div className="font-medium text-slate-700 dark:text-slate-200">
                                  {difficultyLabel(problem.difficulty, locale)} ·{' '}
                                  {latestScoreLabel(problem, locale)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                        <span>
                          {locale === 'zh-CN'
                            ? `显示 ${pageStartIndex + 1}-${pageEndIndex} / ${filteredProblemCount} 道`
                            : `Showing ${pageStartIndex + 1}-${pageEndIndex} of ${filteredProblemCount}`}
                        </span>
                        <div className="flex items-center justify-between gap-2 min-[420px]:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            disabled={currentProblemPage <= 1}
                            onClick={() => setProblemPage((current) => Math.max(1, current - 1))}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            {locale === 'zh-CN' ? '上一页' : 'Prev'}
                          </Button>
                          <span className="min-w-[4rem] text-center font-medium text-slate-600 dark:text-slate-300">
                            {currentProblemPage} / {problemPageCount}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            disabled={currentProblemPage >= problemPageCount}
                            onClick={() =>
                              setProblemPage((current) => Math.min(problemPageCount, current + 1))
                            }
                          >
                            {locale === 'zh-CN' ? '下一页' : 'Next'}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="hidden min-w-[680px] lg:block">
                      <div
                        className={cn(
                          PROBLEM_BANK_LIST_GRID_CLASS,
                          'sticky top-0 z-[1] items-center border-b border-slate-200 bg-slate-50/90 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-400',
                        )}
                      >
                        <span>#</span>
                        <span>{locale === 'zh-CN' ? '难度' : 'Level'}</span>
                        <span>{locale === 'zh-CN' ? '题目' : 'Problem'}</span>
                        <span>{locale === 'zh-CN' ? '题型' : 'Type'}</span>
                        <span>{locale === 'zh-CN' ? '章节' : 'Chapter'}</span>
                        <span>{locale === 'zh-CN' ? '状态' : 'State'}</span>
                        <span>{locale === 'zh-CN' ? '全班通过率' : 'Class pass'}</span>
                        <span />
                      </div>
                      {paginatedProblems.map((problem) => {
                        const selected = selectedProblemId === problem.id;
                        const localizedTitle = getLocalizedProblemTitle(problem, problemLanguage);
                        const classPassRate = classPassRatePresentation(problem, locale);
                        return (
                          <div
                            key={problem.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => navigateToPracticeProblem(problem)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                navigateToPracticeProblem(problem);
                              }
                            }}
                            className={cn(
                              PROBLEM_BANK_LIST_GRID_CLASS,
                              'items-center border-b border-slate-100 px-4 py-2.5 text-sm transition dark:border-slate-800/80',
                              selected
                                ? 'bg-sky-50/80 dark:bg-sky-500/10'
                                : 'bg-white hover:bg-slate-50/80 dark:bg-slate-950/25 dark:hover:bg-slate-900/50',
                            )}
                          >
                            <div>
                              <span className="grid size-7 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                {pageStartIndex + paginatedProblems.indexOf(problem) + 1}
                              </span>
                            </div>
                            <div title={difficultyLabel(problem.difficulty, locale)}>
                              <span
                                className={cn(
                                  'block size-1.5 rounded-full bg-[#c09a68]',
                                  problem.difficulty === 'easy' && 'bg-[#7aa17d]',
                                  problem.difficulty === 'hard' && 'bg-[#b96f66]',
                                )}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <ProblemTitleText
                                  content={localizedTitle}
                                  className="line-clamp-1 min-w-0 flex-1 text-sm font-semibold text-slate-950 dark:text-white"
                                />
                                {canEditProblems ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setRecentSubmissionsProblem(problem);
                                    }}
                                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 text-[10px] font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200 dark:hover:bg-violet-400/15"
                                  >
                                    <History className="size-3" />
                                    {locale === 'zh-CN' ? '最近提交' : 'Recent'}
                                  </button>
                                ) : null}
                              </div>
                              <p className="mt-[3px] min-w-0 truncate text-xs text-slate-400">
                                {problem.notebookName ||
                                  (locale === 'zh-CN' ? '无来源笔记本' : 'No source notebook')}
                              </p>
                            </div>
                            <div className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
                              {typeLabel(problem.type, locale)}
                            </div>
                            <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
                              {canEditProblems ? (
                                <select
                                  value={problem.chapterId || '__unfiled__'}
                                  disabled={savingChapterProblemId === problem.id}
                                  onChange={(event) =>
                                    void handleChangeProblemChapter(problem.id, event.target.value)
                                  }
                                  aria-label={
                                    locale === 'zh-CN'
                                      ? `修改题目“${localizedTitle}”的章节`
                                      : `Change chapter for “${localizedTitle}”`
                                  }
                                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                >
                                  <option value="__unfiled__">
                                    {locale === 'zh-CN' ? '未归档' : 'Unfiled'}
                                  </option>
                                  {problemChapters.map((chapter, index) => (
                                    <option key={chapter.id} value={chapter.id}>
                                      {locale === 'zh-CN'
                                        ? `第 ${index + 1} 章 · ${chapter.name}`
                                        : `Chapter ${index + 1} · ${chapter.name}`}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                  {problem.chapterName ||
                                    (locale === 'zh-CN' ? '未归档' : 'Unfiled')}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {latestScoreLabel(problem, locale)}
                            </div>
                            <div
                              className="text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                              title={classPassRate.detail}
                            >
                              {classPassRate.value}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                className={cn(
                                  'h-[30px] rounded-lg px-2.5 text-xs font-semibold shadow-none',
                                  PROBLEM_BANK_PRIMARY_BUTTON_CLASS,
                                )}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigateToPracticeProblem(problem);
                                }}
                              >
                                {locale === 'zh-CN' ? '练习' : 'Practice'}
                              </Button>
                              {canEditProblems ? (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="icon-sm"
                                  disabled={Boolean(deletingProblemId)}
                                  aria-label={
                                    locale === 'zh-CN'
                                      ? `删除题目「${localizedTitle}」`
                                      : `Delete "${localizedTitle}"`
                                  }
                                  title={locale === 'zh-CN' ? '删除题目' : 'Delete problem'}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteProblem(problem);
                                  }}
                                >
                                  {deletingProblemId === problem.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 pb-4 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-[34px] gap-1 rounded-lg px-3 text-xs font-semibold shadow-none"
                          disabled={currentProblemPage <= 1}
                          onClick={() => setProblemPage((current) => Math.max(1, current - 1))}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          {locale === 'zh-CN' ? '上一页' : 'Prev'}
                        </Button>
                        <span className="min-w-[7rem] text-center font-semibold text-slate-500 dark:text-slate-300">
                          {locale === 'zh-CN'
                            ? `${pageStartIndex + 1}-${pageEndIndex} / ${filteredProblemCount}`
                            : `${pageStartIndex + 1}-${pageEndIndex} / ${filteredProblemCount}`}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-[34px] gap-1 rounded-lg px-3 text-xs font-semibold shadow-none"
                          disabled={currentProblemPage >= problemPageCount}
                          onClick={() =>
                            setProblemPage((current) => Math.min(problemPageCount, current + 1))
                          }
                        >
                          {locale === 'zh-CN' ? '下一页' : 'Next'}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <ProblemBankStatsSidebar
              stats={bankStats}
              loading={loading}
              canEditProblems={canEditProblems}
              locale={locale}
            />
          </>
        ) : null}

        {isPracticeMode ? (
          <div className="order-1 flex h-full min-h-0 min-w-0 flex-1 flex-col">
            {!selectedProblem ? (
              <div className="flex h-full w-full items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {locale === 'zh-CN' ? '正在加载题目...' : 'Loading problem...'}
                  </>
                ) : (
                  <>{locale === 'zh-CN' ? '没有找到这道题。' : 'Problem not found.'}</>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-1 flex-col">
                <div className="grid h-full min-h-0 flex-1 gap-2 overflow-y-auto min-[981px]:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)] min-[981px]:overflow-hidden">
                  <section className="flex min-h-[min(34rem,72dvh)] flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white min-[981px]:min-h-0 dark:border-slate-800 dark:bg-slate-950">
                    {renderPracticePaneHeader('left')}
                    {renderPracticePaneContent(visiblePracticePaneActive.left)}
                  </section>

                  <section className="flex min-h-[min(34rem,72dvh)] flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white min-[981px]:min-h-0 dark:border-slate-800 dark:bg-slate-950">
                    {renderPracticePaneHeader('right')}
                    {renderPracticePaneContent(visiblePracticePaneActive.right)}
                  </section>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {showSidebarAnswerTools ? (
          <div className="order-3 flex h-full w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/90 2xl:w-[300px] dark:border-slate-800 dark:bg-slate-950/50">
            <div className="min-h-0 flex-1 overflow-hidden p-2">
              <AnswerComposerToolbar
                controller={selectedAnswerController}
                locale={locale}
                fillPanels
                showControls={false}
                className="bg-white dark:bg-slate-950/40"
              />
            </div>
          </div>
        ) : null}
      </div>
      <ProblemChapterManagerDialog
        open={chapterManagerOpen}
        onOpenChange={setChapterManagerOpen}
        courseId={courseId}
        chapters={problemChapters}
        locale={locale}
        onChanged={reloadProblemChapters}
      />
      <RecentProblemSubmissionsDialog
        open={Boolean(recentSubmissionsProblem)}
        onOpenChange={(open) => {
          if (!open) setRecentSubmissionsProblem(null);
        }}
        courseId={courseId}
        problem={recentSubmissionsProblem}
        previewMode={previewMode}
      />
    </div>
  );
}
