'use client';
import { CodeAnswerEditor } from './code-answer-editor';
import { buildCodeTestFile } from '@/lib/problem-bank/code-test-files';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  notebookProblemImportDraftSchema,
  type NotebookProblemImportDraft,
  type NotebookProblemType,
} from '@/lib/problem-bank';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Locale = 'zh-CN' | 'en-US';

function formatDraftValidationErrors(input: unknown): string[] {
  const parsed = notebookProblemImportDraftSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'draft';
    if (issue.message === 'Invalid input') {
      return `字段 ${path} 结构不符合当前题型 schema`;
    }
    return `字段 ${path}: ${issue.message}`;
  });
}

function cloneDraft(draft: NotebookProblemImportDraft) {
  return JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
}

function normalizeDraftForValidation(rawDraft: Record<string, unknown>) {
  const draft = JSON.parse(JSON.stringify(rawDraft)) as Record<string, unknown>;
  draft.tags = [];
  draft.points = 100;

  const type = typeof draft.type === 'string' ? draft.type : 'short_answer';
  const publicContent =
    draft.publicContent && typeof draft.publicContent === 'object'
      ? ({ ...(draft.publicContent as Record<string, unknown>), type } as Record<string, unknown>)
      : { type };
  const grading =
    draft.grading && typeof draft.grading === 'object'
      ? ({ ...(draft.grading as Record<string, unknown>), type } as Record<string, unknown>)
      : { type };

  publicContent.contractVersion = 'syntara.problem.v1';
  publicContent.statementFormat = 'syntara-markdown-v1';

  if (type === 'short_answer') {
    publicContent.taskKind =
      publicContent.taskKind === 'code_reading' || publicContent.taskKind === 'calculation'
        ? publicContent.taskKind
        : 'concept';
    publicContent.responseKind = 'short_text';
    grading.graderKind = 'rubric';
  } else if (type === 'choice') {
    publicContent.taskKind =
      publicContent.taskKind === 'code_reading' || publicContent.taskKind === 'calculation'
        ? publicContent.taskKind
        : 'concept';
    publicContent.responseKind = 'choice';
    grading.graderKind = 'exact_choice';
  } else if (type === 'proof') {
    publicContent.taskKind = 'proof';
    publicContent.responseKind = 'long_text';
    grading.graderKind = 'rubric';
  } else if (type === 'calculation') {
    publicContent.taskKind = 'calculation';
    publicContent.responseKind = 'math_expression';
    grading.graderKind = 'numeric_or_exact';
  } else if (type === 'fill_blank') {
    publicContent.taskKind =
      publicContent.taskKind === 'code_reading' || publicContent.taskKind === 'calculation'
        ? publicContent.taskKind
        : 'concept';
    publicContent.responseKind = 'fill_blank';
    grading.graderKind = 'blank_match';
  } else if (type === 'code') {
    publicContent.taskKind = 'implementation';
    publicContent.responseKind = 'code_submission';
    grading.graderKind = 'code_runner';
  }

  if (type === 'choice') {
    const options = Array.isArray(publicContent.options)
      ? publicContent.options
          .map((option) => {
            const row =
              option && typeof option === 'object' ? (option as Record<string, unknown>) : {};
            return {
              id: typeof row.id === 'string' ? row.id.trim() : '',
              label: typeof row.label === 'string' ? row.label.trim() : '',
              format: 'syntara-markdown-inline-v1',
            };
          })
          .filter((option) => option.id && option.label)
      : [];
    publicContent.options = options;
    grading.correctOptionIds = Array.isArray(grading.correctOptionIds)
      ? (grading.correctOptionIds as unknown[])
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => options.some((option) => option.id === id))
      : [];
  }

  if (type === 'calculation') {
    grading.acceptedForms = Array.isArray(grading.acceptedForms)
      ? (grading.acceptedForms as unknown[])
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      : [];
  }

  if (type === 'fill_blank') {
    const blanks = Array.isArray(publicContent.blanks)
      ? publicContent.blanks
          .map((blank, index) => {
            const row =
              blank && typeof blank === 'object' ? (blank as Record<string, unknown>) : {};
            return {
              id:
                typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `blank_${index + 1}`,
              placeholder:
                typeof row.placeholder === 'string' && row.placeholder.trim()
                  ? row.placeholder.trim()
                  : undefined,
              answerKind:
                row.answerKind === 'number' ||
                row.answerKind === 'math_expression' ||
                row.answerKind === 'code_token'
                  ? row.answerKind
                  : 'text',
            };
          })
          .slice(0, 12)
      : [];
    publicContent.blanks = blanks;
    grading.blanks = blanks.map((blank) => {
      const current = Array.isArray(grading.blanks)
        ? (grading.blanks as Array<Record<string, unknown>>).find((row) => row.id === blank.id)
        : undefined;
      const acceptedAnswers = Array.isArray(current?.acceptedAnswers)
        ? (current.acceptedAnswers as unknown[])
            .map((answer) => (typeof answer === 'string' ? answer.trim() : ''))
            .filter(Boolean)
        : [];
      return {
        id: blank.id,
        acceptedAnswers,
        caseSensitive: current?.caseSensitive === true,
        matcher:
          current?.matcher === 'exact' || current?.matcher === 'numeric_tolerance'
            ? current.matcher
            : 'normalized_exact',
        tolerance:
          typeof current?.tolerance === 'number' && Number.isFinite(current.tolerance)
            ? Math.max(0, current.tolerance)
            : undefined,
      };
    });
  }

  if (type === 'code') {
    const language =
      typeof publicContent.language === 'string' && publicContent.language.trim()
        ? publicContent.language.trim().toLowerCase()
        : 'python';
    publicContent.language = language;
    if (language === 'python') {
      publicContent.runnerAdapter = 'python-unittest';
    }
    publicContent.constraints = Array.isArray(publicContent.constraints)
      ? (publicContent.constraints as unknown[])
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      : [];
    publicContent.publicTests = Array.isArray(publicContent.publicTests)
      ? publicContent.publicTests
          .map((test) => {
            const row = test && typeof test === 'object' ? (test as Record<string, unknown>) : {};
            return {
              id: typeof row.id === 'string' ? row.id.trim() : '',
              description: typeof row.description === 'string' ? row.description.trim() : undefined,
              expression: typeof row.expression === 'string' ? row.expression.trim() : '',
              expected: typeof row.expected === 'string' ? row.expected.trim() : '',
            };
          })
          .filter((test) => test.id && test.expression && test.expected)
      : [];

    const secretJudge =
      draft.secretJudge && typeof draft.secretJudge === 'object'
        ? ({ ...(draft.secretJudge as Record<string, unknown>) } as Record<string, unknown>)
        : { language: 'python', secretTests: [], timeoutMs: 5000 };
    secretJudge.language = language;
    if (language === 'python') {
      secretJudge.runnerAdapter = 'python-unittest';
    }
    secretJudge.secretTests = Array.isArray(secretJudge.secretTests)
      ? (secretJudge.secretTests as unknown[])
          .map((test) => {
            const row = test && typeof test === 'object' ? (test as Record<string, unknown>) : {};
            return {
              id: typeof row.id === 'string' ? row.id.trim() : '',
              description: typeof row.description === 'string' ? row.description.trim() : undefined,
              expression: typeof row.expression === 'string' ? row.expression.trim() : '',
              expected: typeof row.expected === 'string' ? row.expected.trim() : '',
            };
          })
          .filter((test) => test.id && test.expression && test.expected)
      : [];
    secretJudge.timeoutMs =
      typeof secretJudge.timeoutMs === 'number' && Number.isFinite(secretJudge.timeoutMs)
        ? secretJudge.timeoutMs
        : 5000;
    const secretTests = Array.isArray(secretJudge.secretTests)
      ? (secretJudge.secretTests as unknown[])
      : [];
    draft.secretJudge = secretJudge;
    publicContent.secretConfigPresent = Boolean(secretJudge.secretTestCode || secretTests.length);
    grading.publishRequirementsMet = false;
  } else {
    delete draft.secretJudge;
  }

  draft.publicContent = publicContent;
  draft.grading = grading;
  draft.validationErrors = formatDraftValidationErrors(draft);
  return draft;
}

export function ProblemDraftForm({
  draft,
  locale,
  onSave,
  saveLabel,
  onDraftChange,
  basicInfoSlot,
  formId,
  allowTypeChange = false,
}: {
  formId?: string;
  allowTypeChange?: boolean;
  basicInfoSlot?: ReactNode;
  draft: NotebookProblemImportDraft;
  locale: Locale;
  onSave: (draft: NotebookProblemImportDraft) => void | Promise<void>;
  saveLabel?: string;
  onDraftChange?: (draft: NotebookProblemImportDraft) => void;
}) {
  const [workingDraft, setWorkingDraft] = useState<Record<string, unknown>>(() =>
    cloneDraft(draft),
  );
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const normalizedDraft = useMemo(() => normalizeDraftForValidation(workingDraft), [workingDraft]);
  const liveErrors = useMemo(
    () => (Array.isArray(normalizedDraft.validationErrors) ? normalizedDraft.validationErrors : []),
    [normalizedDraft.validationErrors],
  );

  useEffect(() => {
    if (!onDraftChange) return;
    const parsed = notebookProblemImportDraftSchema.safeParse(normalizedDraft);
    if (parsed.success) onDraftChange(parsed.data);
  }, [normalizedDraft, onDraftChange]);

  const publicContent =
    workingDraft.publicContent && typeof workingDraft.publicContent === 'object'
      ? (workingDraft.publicContent as Record<string, unknown>)
      : {};
  const grading =
    workingDraft.grading && typeof workingDraft.grading === 'object'
      ? (workingDraft.grading as Record<string, unknown>)
      : {};
  const rubricCriteria = Array.isArray(grading.rubricCriteria)
    ? (grading.rubricCriteria as Array<{ id: string; description: string; points: number }>)
    : [];
  const secretJudge =
    workingDraft.secretJudge && typeof workingDraft.secretJudge === 'object'
      ? (workingDraft.secretJudge as Record<string, unknown>)
      : null;

  const updateRoot = (field: string, value: unknown) => {
    setWorkingDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updatePublicContent = (field: string, value: unknown) => {
    setWorkingDraft((prev) => ({
      ...prev,
      publicContent: {
        ...(prev.publicContent && typeof prev.publicContent === 'object'
          ? (prev.publicContent as Record<string, unknown>)
          : {}),
        [field]: value,
      },
    }));
  };

  const updateGrading = (field: string, value: unknown) => {
    setWorkingDraft((prev) => ({
      ...prev,
      grading: {
        ...(prev.grading && typeof prev.grading === 'object'
          ? (prev.grading as Record<string, unknown>)
          : {}),
        [field]: value,
      },
    }));
  };

  const updateSecretJudge = (field: string, value: unknown) => {
    setWorkingDraft((prev) => ({
      ...prev,
      sourceMeta: {
        ...(prev.sourceMeta && typeof prev.sourceMeta === 'object' ? prev.sourceMeta : {}),
        preserveExistingSecretJudge: false,
      },
      secretJudge: {
        ...(prev.secretJudge && typeof prev.secretJudge === 'object'
          ? (prev.secretJudge as Record<string, unknown>)
          : { language: 'python', secretTests: [], timeoutMs: 5000 }),
        [field]: value,
      },
    }));
  };

  const currentType = (workingDraft.type as NotebookProblemType) || 'short_answer';
  const samples = Array.isArray(publicContent.sampleIO)
    ? (publicContent.sampleIO as Array<{ input: string; output: string; explanation?: string }>)
    : [];
  const changeType = (type: NotebookProblemType) => {
    const content: Record<string, unknown> = {
      type,
      stem: typeof publicContent.stem === 'string' ? publicContent.stem : '',
    };
    const nextGrading: Record<string, unknown> = { type };
    if (type === 'choice') {
      content.selectionMode = 'single';
      content.options = [
        { id: 'a', label: '' },
        { id: 'b', label: '' },
      ];
      nextGrading.correctOptionIds = [];
    }
    if (type === 'fill_blank') {
      delete content.stem;
      content.stemTemplate = '{{blank_1}}';
      content.blanks = [{ id: 'blank_1', answerKind: 'text' }];
      nextGrading.blanks = [{ id: 'blank_1', acceptedAnswers: [], caseSensitive: false }];
    }
    if (type === 'code') {
      content.language = 'python';
      content.starterCode = '';
      content.publicTests = [];
      content.constraints = [];
      content.sampleIO = [];
      content.secretConfigPresent = false;
      nextGrading.publishRequirementsMet = false;
    }
    setWorkingDraft((prev) => ({
      ...prev,
      type,
      publicContent: content,
      grading: nextGrading,
      secretJudge: undefined,
      sourceMeta: {},
      validationErrors: [],
    }));
  };

  const handleSave = async () => {
    if (saving) return;
    const parsed = notebookProblemImportDraftSchema.safeParse(normalizedDraft);
    if (!parsed.success) {
      setSaveErrors(formatDraftValidationErrors(normalizedDraft));
      return;
    }
    setSaveErrors([]);
    setSaving(true);
    try {
      await onSave(parsed.data);
    } finally {
      setSaving(false);
    }
  };

  const FormContainer = formId ? 'form' : 'div';
  return (
    <FormContainer
      id={formId}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {!formId ? (
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saveLabel || (locale === 'zh-CN' ? '保存表单草稿' : 'Save form draft')}
          </Button>
        </div>
      ) : null}
      <Tabs defaultValue="basic" className="min-w-0">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="basic">{locale === 'zh-CN' ? '基本信息' : 'Basic info'}</TabsTrigger>
          <TabsTrigger value="statement">{locale === 'zh-CN' ? '题面' : 'Statement'}</TabsTrigger>
          {currentType === 'choice' ? (
            <TabsTrigger value="options">{locale === 'zh-CN' ? '选项' : 'Options'}</TabsTrigger>
          ) : null}
          <TabsTrigger value="analysis">{locale === 'zh-CN' ? '解析' : 'Analysis'}</TabsTrigger>
          {currentType === 'code' ? (
            <TabsTrigger value="examples">{locale === 'zh-CN' ? '示例' : 'Examples'}</TabsTrigger>
          ) : null}
          {currentType === 'code' ? (
            <TabsTrigger value="starter">
              {locale === 'zh-CN' ? '初始代码' : 'Starter code'}
            </TabsTrigger>
          ) : null}
          {currentType === 'code' ? (
            <TabsTrigger value="solution">
              {locale === 'zh-CN' ? '参考实现' : 'Reference solution'}
            </TabsTrigger>
          ) : null}
          {currentType === 'code' ? (
            <TabsTrigger value="public">
              {locale === 'zh-CN' ? '公开测试' : 'Public tests'}
            </TabsTrigger>
          ) : null}
          {currentType === 'code' ? (
            <TabsTrigger value="secret">
              {locale === 'zh-CN' ? '隐藏测试' : 'Secret tests'}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="basic" className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium">
              {locale === 'zh-CN' ? '题型' : 'Problem type'}
              <select
                aria-label={locale === 'zh-CN' ? '题型' : 'Problem type'}
                value={currentType}
                disabled={!allowTypeChange}
                onChange={(event) => changeType(event.target.value as NotebookProblemType)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {(
                  ['short_answer', 'choice', 'proof', 'calculation', 'fill_blank', 'code'] as const
                ).map((type, index) => (
                  <option key={type} value={type}>
                    {locale === 'zh-CN'
                      ? ['简答题', '选择题', '证明题', '计算题', '填空题（含代码填空）', '编程题'][
                          index
                        ]
                      : [
                          'Short answer',
                          'Choice',
                          'Proof',
                          'Calculation',
                          'Fill blanks (including code)',
                          'Programming',
                        ][index]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium">
              {locale === 'zh-CN' ? '保存状态' : 'Save as'}
              <select
                aria-label={locale === 'zh-CN' ? '保存状态' : 'Save as'}
                value={String(workingDraft.status)}
                onChange={(event) => updateRoot('status', event.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {workingDraft.status === 'archived' ? (
                  <option value="archived">{locale === 'zh-CN' ? '已归档' : 'Archived'}</option>
                ) : null}
                <option value="draft">{locale === 'zh-CN' ? '草稿' : 'Draft'}</option>
                <option value="published">
                  {locale === 'zh-CN' ? '校验后发布' : 'Publish after validation'}
                </option>
              </select>
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {locale === 'zh-CN' ? '题目标题' : 'Title'}
            </label>
            <Input
              value={typeof workingDraft.title === 'string' ? workingDraft.title : ''}
              onChange={(event) => updateRoot('title', event.target.value)}
            />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {locale === 'zh-CN' ? '题目设置' : 'Problem settings'}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '难度' : 'Difficulty'}
                </label>
                <select
                  value={
                    typeof workingDraft.difficulty === 'string' ? workingDraft.difficulty : 'medium'
                  }
                  onChange={(event) => updateRoot('difficulty', event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="easy">{locale === 'zh-CN' ? '简单' : 'Easy'}</option>
                  <option value="medium">{locale === 'zh-CN' ? '中等' : 'Medium'}</option>
                  <option value="hard">{locale === 'zh-CN' ? '困难' : 'Hard'}</option>
                </select>
              </div>

              {currentType === 'choice' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {locale === 'zh-CN' ? '选择模式' : 'Selection mode'}
                  </label>
                  <select
                    value={publicContent.selectionMode === 'multiple' ? 'multiple' : 'single'}
                    onChange={(event) => updatePublicContent('selectionMode', event.target.value)}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="single">{locale === 'zh-CN' ? '单选' : 'Single'}</option>
                    <option value="multiple">{locale === 'zh-CN' ? '多选' : 'Multiple'}</option>
                  </select>
                </div>
              ) : null}
            </div>
          </div>
          {basicInfoSlot}
        </TabsContent>
        <TabsContent value="statement" className="space-y-4">
          {currentType === 'short_answer' ||
          currentType === 'proof' ||
          currentType === 'calculation' ||
          currentType === 'code' ||
          currentType === 'choice' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '题面' : 'Problem statement'}
              </label>
              <Textarea
                className={
                  formId ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]' : 'min-h-[320px]'
                }
                value={typeof publicContent.stem === 'string' ? publicContent.stem : ''}
                onChange={(event) => updatePublicContent('stem', event.target.value)}
              />
            </div>
          ) : null}
          {currentType === 'fill_blank' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '题面模板' : 'Problem template'}
              </label>
              <Textarea
                className={
                  formId ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]' : 'min-h-[320px]'
                }
                value={
                  typeof publicContent.stemTemplate === 'string' ? publicContent.stemTemplate : ''
                }
                onChange={(event) => updatePublicContent('stemTemplate', event.target.value)}
                placeholder={
                  locale === 'zh-CN'
                    ? '用 {{blank_1}} 这样的标记表示空格'
                    : 'Use markers such as {{blank_1}} for blanks'
                }
              />
              <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                {locale === 'zh-CN'
                  ? '每个空格 id 必须在题面中以 {{id}} 出现。'
                  : 'Each blank id must appear in the template as {{id}}.'}
              </p>
            </div>
          ) : null}
          {currentType === 'code' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '约束（每行一个）' : 'Constraints (one per line)'}
              </label>
              <Textarea
                value={
                  Array.isArray(publicContent.constraints)
                    ? (publicContent.constraints as string[]).join('\n')
                    : ''
                }
                onChange={(event) =>
                  updatePublicContent(
                    'constraints',
                    event.target.value
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="examples" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {locale === 'zh-CN'
              ? '至少填写一个可执行的输入示例及预期输出；发布前会用参考实现验证。'
              : 'Provide executable sample input and expected output. Samples are checked against the reference implementation before publishing.'}
          </p>
          {samples.map((sample, index) => (
            <fieldset key={index} className="space-y-2 rounded-xl border p-3">
              <legend className="px-1 text-sm">
                {locale === 'zh-CN' ? '示例' : 'Example'} {index + 1}
              </legend>
              {(['input', 'output', 'explanation'] as const).map((field) => (
                <label key={field} className="block space-y-1 text-xs">
                  {locale === 'zh-CN'
                    ? {
                        input: '输入（例如函数调用）',
                        output: '预期输出',
                        explanation: '说明（可选）',
                      }[field]
                    : field}
                  <Textarea
                    value={sample[field] ?? ''}
                    onChange={(event) =>
                      updatePublicContent(
                        'sampleIO',
                        samples.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                [field]:
                                  field === 'explanation' && !event.target.value
                                    ? undefined
                                    : event.target.value,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  updatePublicContent(
                    'sampleIO',
                    samples.filter((_, i) => i !== index),
                  )
                }
              >
                {locale === 'zh-CN' ? '删除示例' : 'Remove example'}
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={samples.length >= 12}
            onClick={() => updatePublicContent('sampleIO', [...samples, { input: '', output: '' }])}
          >
            {locale === 'zh-CN' ? '添加示例' : 'Add example'}
          </Button>
        </TabsContent>
        <TabsContent value="options" className="space-y-4">
          {currentType === 'choice' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '选项' : 'Options'}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const options = Array.isArray(publicContent.options)
                      ? ([...(publicContent.options as Array<Record<string, unknown>>)] as Array<
                          Record<string, unknown>
                        >)
                      : [];
                    const nextId = String.fromCharCode(65 + options.length);
                    updatePublicContent('options', [
                      ...options,
                      {
                        id: nextId,
                        label: locale === 'zh-CN' ? `选项 ${nextId}` : `Option ${nextId}`,
                      },
                    ]);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {locale === 'zh-CN' ? '添加选项' : 'Add option'}
                </Button>
              </div>
              {Array.isArray(publicContent.options)
                ? (publicContent.options as Array<Record<string, unknown>>).map((option, index) => {
                    const correctOptionIds = Array.isArray(grading.correctOptionIds)
                      ? (grading.correctOptionIds as string[])
                      : [];
                    return (
                      <div
                        key={`${String(option.id || index)}`}
                        className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[90px_1fr_auto_auto] dark:border-slate-700"
                      >
                        <Input
                          value={typeof option.id === 'string' ? option.id : ''}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const oldId = typeof option.id === 'string' ? option.id : '';
                            updatePublicContent(
                              'options',
                              (publicContent.options as Array<Record<string, unknown>>).map(
                                (row, rowIndex) =>
                                  rowIndex === index ? { ...row, id: nextId } : row,
                              ),
                            );
                            updateGrading(
                              'correctOptionIds',
                              correctOptionIds.map((id) => (id === oldId ? nextId : id)),
                            );
                          }}
                          placeholder="A"
                        />
                        <Input
                          value={typeof option.label === 'string' ? option.label : ''}
                          onChange={(event) =>
                            updatePublicContent(
                              'options',
                              (publicContent.options as Array<Record<string, unknown>>).map(
                                (row, rowIndex) =>
                                  rowIndex === index ? { ...row, label: event.target.value } : row,
                              ),
                            )
                          }
                        />
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <input
                            type={publicContent.selectionMode === 'multiple' ? 'checkbox' : 'radio'}
                            name={`correct-option-${draft.draftId}`}
                            checked={correctOptionIds.includes(String(option.id || ''))}
                            onChange={(event) => {
                              const optionId = String(option.id || '');
                              if (publicContent.selectionMode === 'multiple') {
                                updateGrading(
                                  'correctOptionIds',
                                  event.target.checked
                                    ? [...correctOptionIds, optionId]
                                    : correctOptionIds.filter((id) => id !== optionId),
                                );
                              } else {
                                updateGrading('correctOptionIds', [optionId]);
                              }
                            }}
                          />
                          {locale === 'zh-CN' ? '正确答案' : 'Correct'}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const optionId = String(option.id || '');
                            updatePublicContent(
                              'options',
                              (publicContent.options as Array<Record<string, unknown>>).filter(
                                (_, rowIndex) => rowIndex !== index,
                              ),
                            );
                            updateGrading(
                              'correctOptionIds',
                              correctOptionIds.filter((id) => id !== optionId),
                            );
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                : null}
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="analysis" className="space-y-4">
          {currentType === 'short_answer' || currentType === 'proof' ? (
            <fieldset className="space-y-3 rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">
                {locale === 'zh-CN' ? '评分要点（总分 100）' : 'Rubric (100 points total)'}
              </legend>
              {rubricCriteria.map((criterion, index) => (
                <div key={criterion.id} className="flex items-start gap-2">
                  <Textarea
                    aria-label={`${locale === 'zh-CN' ? '评分要点' : 'Criterion'} ${index + 1}`}
                    value={criterion.description}
                    placeholder={
                      locale === 'zh-CN' ? '描述可核验的得分点' : 'Describe the scoring criterion'
                    }
                    onChange={(event) =>
                      updateGrading(
                        'rubricCriteria',
                        rubricCriteria.map((item, i) =>
                          i === index ? { ...item, description: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    className="w-20"
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`${locale === 'zh-CN' ? '分值' : 'Points'} ${index + 1}`}
                    value={criterion.points}
                    onChange={(event) =>
                      updateGrading(
                        'rubricCriteria',
                        rubricCriteria.map((item, i) =>
                          i === index ? { ...item, points: Number(event.target.value) } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${locale === 'zh-CN' ? '删除评分要点' : 'Remove criterion'} ${index + 1}`}
                    onClick={() =>
                      updateGrading(
                        'rubricCriteria',
                        rubricCriteria.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rubricCriteria.length >= 24}
                onClick={() =>
                  updateGrading('rubricCriteria', [
                    ...rubricCriteria,
                    {
                      id: crypto.randomUUID(),
                      description: '',
                      points: Math.max(
                        0,
                        100 - rubricCriteria.reduce((sum, item) => sum + item.points, 0),
                      ),
                    },
                  ])
                }
              >
                {locale === 'zh-CN' ? '添加评分要点' : 'Add criterion'}
              </Button>
            </fieldset>
          ) : null}

          {currentType === 'choice' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '解析' : 'Analysis'}
              </label>
              <Textarea
                className={
                  formId ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]' : 'min-h-[320px]'
                }
                value={typeof grading.analysis === 'string' ? grading.analysis : ''}
                onChange={(event) => updateGrading('analysis', event.target.value)}
              />
            </div>
          ) : null}
          {currentType === 'short_answer' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '参考答案' : 'Reference answer'}
              </label>
              <Textarea
                value={typeof grading.referenceAnswer === 'string' ? grading.referenceAnswer : ''}
                onChange={(event) => updateGrading('referenceAnswer', event.target.value)}
              />
            </div>
          ) : null}
          {currentType === 'short_answer' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '解析（可选）' : 'Analysis (optional)'}
              </label>
              <Textarea
                className={
                  formId ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]' : 'min-h-[320px]'
                }
                value={typeof grading.analysis === 'string' ? grading.analysis : ''}
                onChange={(event) => updateGrading('analysis', event.target.value)}
              />
            </div>
          ) : null}
          {currentType === 'fill_blank' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {locale === 'zh-CN' ? '空格与标准答案' : 'Blanks and accepted answers'}
                  </label>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {locale === 'zh-CN'
                      ? '可为每个空格设置多个同义答案。'
                      : 'Add multiple accepted variants for each blank.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    Array.isArray(publicContent.blanks) && publicContent.blanks.length >= 12
                  }
                  onClick={() => {
                    const blanks = Array.isArray(publicContent.blanks)
                      ? ([...publicContent.blanks] as Array<Record<string, unknown>>)
                      : [];
                    let nextNumber = 1;
                    while (blanks.some((blank) => blank.id === `blank_${nextNumber}`)) nextNumber++;
                    const nextId = `blank_${nextNumber}`;
                    updatePublicContent('blanks', [
                      ...blanks,
                      { id: nextId, placeholder: locale === 'zh-CN' ? '答案' : 'Answer' },
                    ]);
                    updatePublicContent(
                      'stemTemplate',
                      `${typeof publicContent.stemTemplate === 'string' ? publicContent.stemTemplate : ''} {{${nextId}}}`.trim(),
                    );
                    updateGrading('blanks', [
                      ...(Array.isArray(grading.blanks) ? grading.blanks : []),
                      { id: nextId, acceptedAnswers: [], caseSensitive: false },
                    ]);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {locale === 'zh-CN' ? '添加空格' : 'Add blank'}
                </Button>
              </div>
              {(Array.isArray(publicContent.blanks)
                ? (publicContent.blanks as Array<Record<string, unknown>>)
                : []
              ).map((blank, index, blanks) => {
                const blankId = typeof blank.id === 'string' ? blank.id : `blank_${index + 1}`;
                const gradingBlanks = Array.isArray(grading.blanks)
                  ? (grading.blanks as Array<Record<string, unknown>>)
                  : [];
                const blankGrading = gradingBlanks.find((row) => row.id === blankId) ?? {};
                return (
                  <div
                    key={`${blankId}-${index}`}
                    className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-[100px_120px_minmax(0,1fr)_auto_auto] md:items-end"
                  >
                    <label className="space-y-1 text-xs">
                      {locale === 'zh-CN' ? '答案类型' : 'Answer type'}
                      <select
                        aria-label={`${locale === 'zh-CN' ? '答案类型' : 'Answer type'} ${index + 1}`}
                        className="h-9 w-full rounded-md border bg-background px-2"
                        value={String(blank.answerKind ?? 'text')}
                        onChange={(event) =>
                          updatePublicContent(
                            'blanks',
                            blanks.map((row, i) =>
                              i === index ? { ...row, answerKind: event.target.value } : row,
                            ),
                          )
                        }
                      >
                        <option value="text">{locale === 'zh-CN' ? '文本' : 'Text'}</option>
                        <option value="code_token">{locale === 'zh-CN' ? '代码' : 'Code'}</option>
                        <option value="number">{locale === 'zh-CN' ? '数值' : 'Number'}</option>
                        <option value="math_expression">
                          {locale === 'zh-CN' ? '数学表达式' : 'Math expression'}
                        </option>
                      </select>
                    </label>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-slate-500">
                        {locale === 'zh-CN' ? '空格 ID' : 'Blank ID'}
                      </label>
                      <Input
                        value={blankId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          updatePublicContent(
                            'blanks',
                            blanks.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, id: nextId } : row,
                            ),
                          );
                          updatePublicContent(
                            'stemTemplate',
                            String(publicContent.stemTemplate ?? '').replaceAll(
                              `{{${blankId}}}`,
                              `{{${nextId}}}`,
                            ),
                          );
                          updateGrading(
                            'blanks',
                            gradingBlanks.map((row) =>
                              row.id === blankId ? { ...row, id: nextId } : row,
                            ),
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-slate-500">
                        {locale === 'zh-CN'
                          ? '可接受答案（用 | 分隔）'
                          : 'Accepted answers (separate with |)'}
                      </label>
                      <Input
                        value={
                          Array.isArray(blankGrading.acceptedAnswers)
                            ? (blankGrading.acceptedAnswers as string[]).join(' | ')
                            : ''
                        }
                        onChange={(event) => {
                          const acceptedAnswers = event.target.value
                            .split('|')
                            .map((answer) => answer.trim())
                            .filter(Boolean);
                          updateGrading(
                            'blanks',
                            gradingBlanks.map((row) =>
                              row.id === blankId ? { ...row, acceptedAnswers } : row,
                            ),
                          );
                        }}
                      />
                    </div>
                    <label className="flex h-10 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={blankGrading.caseSensitive === true}
                        onChange={(event) =>
                          updateGrading(
                            'blanks',
                            gradingBlanks.map((row) =>
                              row.id === blankId
                                ? { ...row, caseSensitive: event.target.checked }
                                : row,
                            ),
                          )
                        }
                      />
                      {locale === 'zh-CN' ? '区分大小写' : 'Case-sensitive'}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={blanks.length <= 1}
                      onClick={() => {
                        updatePublicContent(
                          'blanks',
                          blanks.filter((_, rowIndex) => rowIndex !== index),
                        );
                        updatePublicContent(
                          'stemTemplate',
                          String(publicContent.stemTemplate ?? '').replaceAll(`{{${blankId}}}`, ''),
                        );
                        updateGrading(
                          'blanks',
                          gradingBlanks.filter((row) => row.id !== blankId),
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '解析' : 'Analysis'}
                </label>
                <Textarea
                  className={
                    formId
                      ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]'
                      : 'min-h-[320px]'
                  }
                  value={typeof grading.analysis === 'string' ? grading.analysis : ''}
                  onChange={(event) => updateGrading('analysis', event.target.value)}
                />
              </div>
            </div>
          ) : null}
          {currentType === 'proof' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {locale === 'zh-CN' ? '参考证明' : 'Reference proof'}
                  </label>
                  <Textarea
                    className="min-h-[220px] h-[calc((100dvh-280px)/2)] max-h-[360px]"
                    value={typeof grading.referenceProof === 'string' ? grading.referenceProof : ''}
                    onChange={(event) => updateGrading('referenceProof', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {locale === 'zh-CN' ? '解析（可选）' : 'Analysis (optional)'}
                  </label>
                  <Textarea
                    className="min-h-[220px] h-[calc((100dvh-280px)/2)] max-h-[360px]"
                    value={typeof grading.analysis === 'string' ? grading.analysis : ''}
                    onChange={(event) => updateGrading('analysis', event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {currentType === 'calculation' ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '参考答案' : 'Reference answer'}
                </label>
                <Input
                  value={typeof grading.referenceAnswer === 'string' ? grading.referenceAnswer : ''}
                  onChange={(event) => updateGrading('referenceAnswer', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '单位' : 'Unit'}
                </label>
                <Input
                  value={typeof publicContent.unit === 'string' ? publicContent.unit : ''}
                  onChange={(event) => {
                    updatePublicContent('unit', event.target.value);
                    updateGrading('unit', event.target.value);
                  }}
                />
              </div>
            </div>
          ) : null}
          {currentType === 'calculation' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '可接受形式（每行一个）' : 'Accepted forms (one per line)'}
                </label>
                <Textarea
                  value={
                    Array.isArray(grading.acceptedForms)
                      ? (grading.acceptedForms as string[]).join('\n')
                      : ''
                  }
                  onChange={(event) =>
                    updateGrading(
                      'acceptedForms',
                      event.target.value
                        .split('\n')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'zh-CN' ? '容差（可选）' : 'Tolerance (optional)'}
                </label>
                <Input
                  type="number"
                  step="any"
                  value={typeof grading.tolerance === 'number' ? String(grading.tolerance) : ''}
                  onChange={(event) =>
                    updateGrading(
                      'tolerance',
                      event.target.value === '' ? undefined : Number(event.target.value),
                    )
                  }
                />
              </div>
            </div>
          ) : null}
          {currentType === 'code' || currentType === 'calculation' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {locale === 'zh-CN' ? '解析' : 'Analysis'}
              </label>
              <Textarea
                className={
                  formId ? 'min-h-[320px] h-[calc(100dvh-240px)] lg:max-h-[760px]' : 'min-h-[320px]'
                }
                value={typeof grading.analysis === 'string' ? grading.analysis : ''}
                onChange={(event) => updateGrading('analysis', event.target.value)}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="starter" className="space-y-4">
          {currentType === 'code' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">submission.py</p>
              <CodeAnswerEditor
                locale={locale}
                className="h-[calc(100dvh-280px)] min-h-[320px]"
                value={
                  typeof publicContent.starterCode === 'string' ? publicContent.starterCode : ''
                }
                onChange={(value) => updatePublicContent('starterCode', value)}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="solution" className="space-y-4">
          {currentType === 'code' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">submission.py</p>
              <CodeAnswerEditor
                locale={locale}
                className="h-[calc(100dvh-280px)] min-h-[320px]"
                value={
                  typeof grading.solutionCode === 'string'
                    ? grading.solutionCode
                    : typeof grading.referenceAnswer === 'string'
                      ? grading.referenceAnswer
                      : ''
                }
                onChange={(value) => updateGrading('solutionCode', value)}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="public" className="space-y-4">
          {currentType === 'code' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">public_tests.py</p>
              <CodeAnswerEditor
                locale={locale}
                className="h-[calc(100dvh-280px)] min-h-[320px]"
                value={
                  typeof publicContent.publicTestCode === 'string'
                    ? publicContent.publicTestCode
                    : buildCodeTestFile(
                        (publicContent.publicTests ?? []) as Array<{
                          id: string;
                          expression: string;
                          expected: string;
                        }>,
                        'public_tests.py',
                        'PublicTests',
                      )
                }
                onChange={(value) => updatePublicContent('publicTestCode', value)}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="secret" className="space-y-4">
          {currentType === 'code' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">secret_tests.py</p>
              <CodeAnswerEditor
                locale={locale}
                className="h-[calc(100dvh-280px)] min-h-[320px]"
                value={
                  typeof secretJudge?.secretTestCode === 'string'
                    ? secretJudge.secretTestCode
                    : buildCodeTestFile(
                        (secretJudge?.secretTests ?? []) as Array<{
                          id: string;
                          expression: string;
                          expected: string;
                        }>,
                        'secret_tests.py',
                        'SecretTests',
                      )
                }
                onChange={(value) => updateSecretJudge('secretTestCode', value)}
              />
            </div>
          ) : null}
          {currentType === 'code' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {locale === 'zh-CN' ? '运行超时（毫秒）' : 'Timeout (ms)'}
              </label>
              <Input
                type="number"
                min={1}
                max={20000}
                value={
                  secretJudge && typeof secretJudge.timeoutMs === 'number'
                    ? String(secretJudge.timeoutMs)
                    : '5000'
                }
                onChange={(event) =>
                  updateSecretJudge('timeoutMs', Number(event.target.value || 5000))
                }
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
      {liveErrors.length > 0 || saveErrors.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="font-medium">{locale === 'zh-CN' ? '待修正字段' : 'Fields to fix'}</div>
          <div className="mt-2 space-y-1">
            {(saveErrors.length > 0 ? saveErrors : liveErrors).map((error, index) => (
              <p key={`${draft.draftId}-editor-error-${index}`}>{error}</p>
            ))}
          </div>
        </div>
      ) : null}
    </FormContainer>
  );
}
