'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Locale = 'zh-CN' | 'en-US';
type PartType = 'short_answer' | 'choice' | 'proof' | 'calculation' | 'fill_blank';
type RawRecord = Record<string, unknown>;
export type RawPart = { label: string; points: number; dependsOn?: string[]; content: RawRecord };
export type RawGradingPart = { label: string; grading: RawRecord };

const PART_TYPES: Array<[PartType, string, string]> = [
  ['short_answer', '简答', 'Short answer'],
  ['choice', '选择', 'Choice'],
  ['calculation', '计算', 'Calculation'],
  ['fill_blank', '填空', 'Fill blanks'],
  ['proof', '证明', 'Proof'],
];

const str = (value: unknown) => (typeof value === 'string' ? value : '');

function blankIdsIn(template: string): string[] {
  return Array.from(
    new Set([...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim())),
  );
}

export function emptyPart(
  label: string,
  type: PartType = 'short_answer',
): {
  part: RawPart;
  grading: RawGradingPart;
} {
  const content: RawRecord = { type, stem: '' };
  const grading: RawRecord = { type };
  if (type === 'choice') {
    content.selectionMode = 'single';
    content.options = [
      { id: 'A', label: '' },
      { id: 'B', label: '' },
    ];
    grading.correctOptionIds = [];
  }
  if (type === 'fill_blank') {
    delete content.stem;
    content.stemTemplate = '{{blank_1}}';
    content.blanks = [{ id: 'blank_1', answerKind: 'text' }];
    grading.blanks = [{ id: 'blank_1', acceptedAnswers: [], caseSensitive: false }];
  }
  if (type === 'calculation') grading.acceptedForms = [];
  return { part: { label, points: 1, content }, grading: { label, grading } };
}

function nextLabel(parts: RawPart[]): string {
  const letters = 'abcdefghijkl';
  return (
    letters.split('').find((letter) => !parts.some((part) => part.label === letter)) ??
    `${parts.length + 1}`
  );
}

/** 老师编辑大题的小问：编号、分值、题型、问法和答案。 */
export function MultipartPartsEditor({
  parts,
  gradingParts,
  locale,
  onChange,
}: {
  parts: RawPart[];
  gradingParts: RawGradingPart[];
  locale: Locale;
  onChange: (parts: RawPart[], gradingParts: RawGradingPart[]) => void;
}) {
  const zh = locale === 'zh-CN';
  const gradingFor = (label: string): RawRecord =>
    gradingParts.find((item) => item.label === label)?.grading ?? {};
  const update = (index: number, nextPart: RawPart, nextGrading?: RawRecord) => {
    const previousLabel = parts[index].label;
    const nextParts = parts.map((part, i) => (i === index ? nextPart : part));
    const grading = nextGrading ?? gradingFor(previousLabel);
    const nextGradingParts = [
      ...gradingParts.filter((item) => item.label !== previousLabel),
      { label: nextPart.label, grading },
    ];
    onChange(nextParts, nextGradingParts);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= parts.length) return;
    const next = [...parts];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next, gradingParts);
  };

  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        const type = (str(part.content.type) || 'short_answer') as PartType;
        const grading = gradingFor(part.label);
        const prompt =
          type === 'fill_blank' ? str(part.content.stemTemplate) : str(part.content.stem);
        const setContent = (field: string, value: unknown) =>
          update(index, { ...part, content: { ...part.content, [field]: value } });
        const setGrading = (field: string, value: unknown) =>
          update(index, part, { ...grading, [field]: value });
        const options = Array.isArray(part.content.options)
          ? (part.content.options as Array<{ id: string; label: string }>)
          : [];
        const correct = Array.isArray(grading.correctOptionIds)
          ? (grading.correctOptionIds as string[])
          : [];
        return (
          <div
            key={`${index}-${part.label}`}
            className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={zh ? '小问编号' : 'Part label'}
                value={part.label}
                onChange={(event) => update(index, { ...part, label: event.target.value.trim() })}
                className="h-8 w-16 text-center font-semibold"
              />
              <select
                aria-label={zh ? '小问题型' : 'Part type'}
                value={type}
                onChange={(event) => {
                  const fresh = emptyPart(part.label, event.target.value as PartType);
                  const stem =
                    prompt && event.target.value !== 'fill_blank' ? { stem: prompt } : {};
                  update(
                    index,
                    { ...part, content: { ...fresh.part.content, ...stem } },
                    fresh.grading.grading,
                  );
                }}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {PART_TYPES.map(([value, zhLabel, enLabel]) => (
                  <option key={value} value={value}>
                    {zh ? zhLabel : enLabel}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                {zh ? '分值' : 'Points'}
                <Input
                  type="number"
                  min={0}
                  value={part.points}
                  onChange={(event) =>
                    update(index, { ...part, points: Math.max(0, Number(event.target.value) || 0) })
                  }
                  className="h-8 w-16"
                />
              </label>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-rose-600"
                  onClick={() =>
                    onChange(
                      parts.filter((_, i) => i !== index),
                      gradingParts.filter((item) => item.label !== part.label),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <Textarea
              value={prompt}
              placeholder={
                type === 'fill_blank'
                  ? zh
                    ? '这一问的问法，用 {{blank_1}} 标出空格'
                    : 'Prompt with {{blank_1}} markers'
                  : zh
                    ? '这一问的问法（只写这一问，共享题干写在「题面」）'
                    : 'This part only; the shared stem lives in Statement'
              }
              onChange={(event) => {
                if (type !== 'fill_blank') return setContent('stem', event.target.value);
                const ids = blankIdsIn(event.target.value);
                const previousBlanks = Array.isArray(grading.blanks)
                  ? (grading.blanks as Array<{ id: string; acceptedAnswers: string[] }>)
                  : [];
                update(
                  index,
                  {
                    ...part,
                    content: {
                      ...part.content,
                      stemTemplate: event.target.value,
                      blanks: ids.map((id) => ({ id, answerKind: 'text' })),
                    },
                  },
                  {
                    ...grading,
                    blanks: ids.map((id) => ({
                      id,
                      acceptedAnswers:
                        previousBlanks.find((blank) => blank.id === id)?.acceptedAnswers ?? [],
                      caseSensitive: false,
                    })),
                  },
                );
              }}
              className="min-h-20"
            />
            {type === 'choice' ? (
              <div className="space-y-1.5">
                {options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    <input
                      type={part.content.selectionMode === 'multiple' ? 'checkbox' : 'radio'}
                      checked={correct.includes(option.id)}
                      onChange={(event) =>
                        setGrading(
                          'correctOptionIds',
                          part.content.selectionMode === 'multiple'
                            ? event.target.checked
                              ? [...correct, option.id]
                              : correct.filter((id) => id !== option.id)
                            : [option.id],
                        )
                      }
                      aria-label={zh ? '正确答案' : 'Correct'}
                    />
                    <span className="w-5 text-sm font-semibold">{option.id}</span>
                    <Input
                      value={option.label}
                      onChange={(event) =>
                        setContent(
                          'options',
                          options.map((item, i) =>
                            i === optionIndex ? { ...item, label: event.target.value } : item,
                          ),
                        )
                      }
                      className="h-8"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={options.length >= 12}
                  onClick={() =>
                    setContent('options', [
                      ...options,
                      { id: String.fromCharCode(65 + options.length), label: '' },
                    ])
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  {zh ? '加选项' : 'Add option'}
                </Button>
              </div>
            ) : type === 'fill_blank' ? (
              <div className="space-y-1.5">
                {(Array.isArray(grading.blanks)
                  ? (grading.blanks as Array<{ id: string; acceptedAnswers: string[] }>)
                  : []
                ).map((blank) => (
                  <label key={blank.id} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-20 shrink-0 font-mono">{blank.id}</span>
                    <Input
                      value={blank.acceptedAnswers.join(' | ')}
                      placeholder={zh ? '参考答案，多个用 | 分开' : 'Answers, separated by |'}
                      onChange={(event) =>
                        setGrading(
                          'blanks',
                          (grading.blanks as Array<{ id: string; acceptedAnswers: string[] }>).map(
                            (item) =>
                              item.id === blank.id
                                ? {
                                    ...item,
                                    acceptedAnswers: event.target.value
                                      .split('|')
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  }
                                : item,
                          ),
                        )
                      }
                      className="h-8"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <Textarea
                value={str(type === 'proof' ? grading.referenceProof : grading.referenceAnswer)}
                placeholder={
                  type === 'calculation'
                    ? zh
                      ? '最终结果（用于自动比对）'
                      : 'Final result for auto-matching'
                    : zh
                      ? '参考答案'
                      : 'Reference answer'
                }
                onChange={(event) =>
                  type === 'proof'
                    ? setGrading('referenceProof', event.target.value)
                    : type === 'calculation'
                      ? update(index, part, {
                          ...grading,
                          referenceAnswer: event.target.value,
                          acceptedForms: event.target.value.trim()
                            ? [event.target.value.trim()]
                            : [],
                        })
                      : setGrading('referenceAnswer', event.target.value)
                }
                className="min-h-16"
              />
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={parts.length >= 12}
        onClick={() => {
          const fresh = emptyPart(nextLabel(parts));
          onChange([...parts, fresh.part], [...gradingParts, fresh.grading]);
        }}
      >
        <Plus className="mr-1 size-4" />
        {zh ? '添加小问' : 'Add part'}
      </Button>
    </div>
  );
}
