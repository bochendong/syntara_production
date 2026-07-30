'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
  SYNTARA_DIALOG_HEADER_CLASS,
} from '@/components/ui/syntara-dialog-style';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  buildLearningCalendarDays,
  buildSyllabusEventsByDay,
  LearningCalendarGrid,
} from '@/components/learn/learning-calendar-grid';
import type {
  SyllabusCalendarEvent,
  SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import { makeLearningCalendarIdempotencyKey } from '@/features/learning-calendar/client/calendar-api';
import { useLearningCalendarRange } from '@/features/learning-calendar/client/use-learning-calendar-range';
import { cn } from '@/lib/utils';

const EVENT_KINDS: Array<{
  value: SyllabusEventKind;
  label: string;
  color: string;
}> = [
  { value: 'assignment', label: '作业', color: 'bg-sky-500' },
  { value: 'exam', label: '考试', color: 'bg-rose-500' },
  { value: 'progress', label: '学习计划', color: 'bg-amber-500' },
  { value: 'tutorial', label: '课程活动', color: 'bg-violet-500' },
  { value: 'holiday', label: '休息日', color: 'bg-emerald-500' },
  { value: 'other', label: '其他事项', color: 'bg-slate-400' },
];

type EventDraft = {
  id: string | null;
  title: string;
  date: string;
  kind: SyllabusEventKind;
  durationMinutes: string;
};

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function newDraft(date = new Date()): EventDraft {
  return {
    id: null,
    title: '',
    date: localDateKey(date),
    kind: 'progress',
    durationMinutes: '45',
  };
}

function makeEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `manual-calendar-${crypto.randomUUID()}`;
  }
  return `manual-calendar-${Date.now()}`;
}

function previewEvents(referenceDate: Date): SyllabusCalendarEvent[] {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const at = (day: number) => localDateKey(new Date(year, month, day));
  return [
    {
      id: 'preview-calendar-assignment',
      title: 'MAT102 作业提交',
      kind: 'assignment',
      date: at(8),
      sourceName: 'MAT102',
      origin: 'manual',
      durationMinutes: 60,
      status: 'planned',
      createdAt: 1,
    },
    {
      id: 'preview-calendar-review',
      title: 'CSC148 算法复习',
      kind: 'progress',
      date: at(11),
      sourceName: 'CSC148',
      origin: 'ai_plan',
      durationMinutes: 45,
      status: 'planned',
      createdAt: 2,
    },
    {
      id: 'preview-calendar-exam',
      title: 'MAT136 阶段测验',
      kind: 'exam',
      date: at(17),
      sourceName: 'MAT136',
      origin: 'manual',
      durationMinutes: 90,
      status: 'planned',
      createdAt: 3,
    },
    {
      id: 'preview-calendar-reading',
      title: '研究方法论文阅读',
      kind: 'tutorial',
      date: at(22),
      sourceName: '研究方法',
      origin: 'manual',
      durationMinutes: 50,
      status: 'planned',
      createdAt: 4,
    },
  ];
}

export function LearningCalendarPage() {
  const searchParams = useSearchParams();
  const preview =
    process.env.NODE_ENV !== 'production' && searchParams.get('previewCalendar') === '1';

  return <LearningCalendarSurface key={preview ? 'preview' : 'saved'} preview={preview} />;
}

function LearningCalendarSurface({ preview }: { preview: boolean }) {
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [previewSeed] = useState<SyllabusCalendarEvent[]>(() =>
    preview ? previewEvents(new Date()) : [],
  );
  const [enabledKinds, setEnabledKinds] = useState<SyllabusEventKind[]>(
    EVENT_KINDS.map((item) => item.value),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => newDraft());
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const {
    events,
    loading,
    error: loadError,
    truncated,
    reload,
    createEvents,
    updateEvent,
    deleteEvent,
  } = useLearningCalendarRange({
    referenceDate,
    rangeMode: 'month',
    enabled: !preview,
    previewEvents: preview ? previewSeed : undefined,
  });

  const visibleEvents = useMemo(
    () => events.filter((event) => enabledKinds.includes(event.kind)),
    [enabledKinds, events],
  );
  const calendarDays = useMemo(
    () => buildLearningCalendarDays(referenceDate, [], visibleEvents),
    [referenceDate, visibleEvents],
  );
  const eventsByDay = useMemo(() => buildSyllabusEventsByDay(visibleEvents), [visibleEvents]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
      }).format(referenceDate),
    [referenceDate],
  );
  const monthEvents = useMemo(() => {
    const prefix = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(
      2,
      '0',
    )}`;
    return visibleEvents.filter((event) => event.date.startsWith(prefix)).slice(0, 8);
  }, [referenceDate, visibleEvents]);

  const openCreate = () => {
    setMutationError(null);
    setDraft(newDraft(referenceDate));
    setDialogOpen(true);
  };

  const openEdit = (event: SyllabusCalendarEvent) => {
    setMutationError(null);
    setDraft({
      id: event.id,
      title: event.title,
      date: event.date,
      kind: event.kind,
      durationMinutes: String(event.durationMinutes || 45),
    });
    setDialogOpen(true);
  };

  const commitDraft = async () => {
    const title = draft.title.trim();
    if (!title || !draft.date) return;
    const duration = Number(draft.durationMinutes);
    const existing = draft.id ? events.find((event) => event.id === draft.id) : null;
    const durationMinutes = Number.isFinite(duration) ? Math.max(5, Math.round(duration)) : 45;
    setSaving(true);
    setMutationError(null);
    try {
      if (existing) {
        await updateEvent(
          existing,
          {
            title,
            date: draft.date,
            kind: draft.kind,
            durationMinutes,
          },
          {
            idempotencyKey: makeLearningCalendarIdempotencyKey(
              'account-calendar-edit',
              `${existing.id}-${existing.version}`,
            ),
          },
        );
      } else {
        const clientEventId = makeEventId();
        await createEvents(
          [
            {
              id: clientEventId,
              clientEventId,
              title,
              date: draft.date,
              kind: draft.kind,
              sourceName: '我的学习',
              origin: 'manual',
              sourceRef: { type: 'manual', id: 'account-calendar' },
              durationMinutes,
              status: 'planned',
              createdAt: Date.now(),
            },
          ],
          {
            idempotencyKey: makeLearningCalendarIdempotencyKey(
              'account-calendar-create',
              clientEventId,
            ),
          },
        );
      }
      setDialogOpen(false);
    } catch (saveError) {
      setMutationError(
        saveError instanceof Error ? saveError.message : '保存失败，请检查网络后重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!draft.id) return;
    const existing = events.find((event) => event.id === draft.id);
    if (!existing) return;
    setSaving(true);
    setMutationError(null);
    try {
      await deleteEvent(existing, {
        idempotencyKey: makeLearningCalendarIdempotencyKey(
          'account-calendar-delete',
          `${existing.id}-${existing.version}`,
        ),
      });
      setDialogOpen(false);
    } catch (deleteError) {
      setMutationError(
        deleteError instanceof Error ? deleteError.message : '删除失败，请检查网络后重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-[680px] w-full overflow-hidden bg-white text-slate-950 shadow-[0_0_0_1px_rgba(15,23,42,0.06)] max-[860px]:flex-col">
      <aside className="flex w-[230px] shrink-0 flex-col gap-[18px] border-r border-slate-200 bg-slate-50 px-4 py-[18px] max-[860px]:w-full max-[860px]:gap-3 max-[860px]:border-b max-[860px]:border-r-0 max-[860px]:p-3.5">
        <Link
          href="/learn"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-[7px] text-xs font-semibold text-slate-950 hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          返回主屏
        </Link>

        <div className="grid gap-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
            <CalendarDays className="size-3.5" />
            全局日历
          </span>
          <strong className="text-lg font-bold text-slate-950">全部课程安排</strong>
          <small className="text-xs leading-[1.45] text-slate-500">
            汇总当前账号的课程学习日程。
          </small>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-2.5 max-[860px]:grid-cols-4">
            {EVENT_KINDS.map((item) => {
              const enabled = enabledKinds.includes(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() =>
                    setEnabledKinds((current) =>
                      current.includes(item.value)
                        ? current.filter((kind) => kind !== item.value)
                        : [...current, item.value],
                    )
                  }
                  className={cn(
                    'grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg text-left text-[13px] font-semibold text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                    !enabled && 'opacity-40',
                  )}
                  aria-pressed={enabled}
                >
                  <span className={cn('size-2.5 rounded-full', item.color)} />
                  <span className="truncate">{item.label}</span>
                  <span className="text-xs font-semibold tabular-nums text-slate-500">
                    {events.filter((event) => event.kind === item.value).length}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-6 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 max-[860px]:hidden">
            本月事项
          </p>
          <div className="mt-2 space-y-1 max-[860px]:hidden">
            {monthEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => openEdit(event)}
                className="w-full rounded-[9px] px-2 py-2 text-left outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <p className="truncate text-xs font-semibold text-slate-700">{event.title}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{event.date}</p>
              </button>
            ))}
            {monthEvents.length === 0 ? (
              <p className="px-2 py-3 text-xs leading-5 text-slate-400">本月还没有学习事项。</p>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-slate-400">{events.length} 项课程安排</p>
        {truncated ? (
          <p className="text-[11px] leading-4 text-amber-600">
            当前范围事项较多，仅显示前 120 项。
          </p>
        ) : null}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-4 pt-5 max-sm:px-3">
          <div className="min-w-0 max-sm:max-w-[160px]">
            <h2 className="truncate text-[clamp(28px,3vw,36px)] font-semibold tracking-[-0.02em] text-slate-950">
              {monthLabel}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-full bg-slate-100 px-4 text-[13px] font-semibold shadow-none hover:bg-slate-200"
              onClick={() => setReferenceDate(new Date())}
            >
              今天
            </Button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setReferenceDate(
                    (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                  )
                }
                className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 outline-none hover:bg-slate-200 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-500"
                aria-label="上一个月"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() =>
                  setReferenceDate(
                    (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                  )
                }
                className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 outline-none hover:bg-slate-200 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-500"
                aria-label="下一个月"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="flex size-9 items-center justify-center gap-1.5 rounded-full bg-sky-600 text-sm font-semibold text-white outline-none hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 sm:w-auto sm:px-4"
              aria-label="新建"
            >
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">新建</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mx-6 mb-3 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 max-sm:mx-3">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            正在加载这个月的账号日历…
          </div>
        ) : null}
        {loadError ? (
          <div className="mx-6 mb-3 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 max-sm:mx-3">
            <span className="min-w-0 truncate">{loadError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              onClick={() => void reload().catch(() => undefined)}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              重试
            </Button>
          </div>
        ) : null}

        <LearningCalendarGrid
          days={calendarDays}
          syllabusEventsByCalendarDay={eventsByDay}
          isResearchCourse={false}
          maxVisibleItems={3}
          onSelectEvent={openEdit}
        />
      </main>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!saving) setDialogOpen(open);
        }}
      >
        <DialogContent
          className={cn(SYNTARA_ACTION_DIALOG_CONTENT_CLASS, 'max-w-[460px] gap-0 p-0')}
        >
          <DialogHeader className={cn(SYNTARA_DIALOG_HEADER_CLASS, 'bg-white/72 px-6 py-5')}>
            <DialogTitle className="text-xl font-bold tracking-[-0.02em]">
              {draft.id ? '编辑事项' : '新建事项'}
            </DialogTitle>
            <DialogDescription>更改会同步到当前账号的全局学习日历。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <div className="rounded-[14px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
              <Label htmlFor="calendar-event-title">标题</Label>
              <Input
                id="calendar-event-title"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="例如：复习二叉树删除"
                className="mt-2 border-0 bg-[#f2f2f7] shadow-none"
                autoFocus
              />
            </div>
            <div className="grid gap-3 rounded-[14px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04] sm:grid-cols-2">
              <div>
                <Label htmlFor="calendar-event-date">日期</Label>
                <Input
                  id="calendar-event-date"
                  type="date"
                  value={draft.date}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, date: event.target.value }))
                  }
                  className="mt-2 border-0 bg-[#f2f2f7] shadow-none"
                />
              </div>
              <div>
                <Label htmlFor="calendar-event-duration">时长（分钟）</Label>
                <Input
                  id="calendar-event-duration"
                  type="number"
                  min={5}
                  step={5}
                  value={draft.durationMinutes}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, durationMinutes: event.target.value }))
                  }
                  className="mt-2 border-0 bg-[#f2f2f7] shadow-none"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>分类</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(kind) =>
                    setDraft((current) => ({ ...current, kind: kind as SyllabusEventKind }))
                  }
                >
                  <SelectTrigger className="mt-2 w-full border-0 bg-[#f2f2f7] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_KINDS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {mutationError ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                {mutationError}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.07] bg-white/70 px-5 py-4">
            {draft.id ? (
              <Button
                type="button"
                variant="ghost"
                className="text-[#ff3b30] hover:bg-rose-50 hover:text-[#ff3b30]"
                onClick={() => void deleteDraft()}
                disabled={saving}
              >
                <Trash2 className="size-4" aria-hidden />
                删除
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button
                type="button"
                className="bg-[#007aff] hover:bg-[#006ee6]"
                onClick={() => void commitDraft()}
                disabled={saving || !draft.title.trim() || !draft.date}
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
