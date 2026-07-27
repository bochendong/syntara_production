'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  readSyllabusEvents,
  writeSyllabusEvents,
  type SyllabusCalendarEvent,
  type SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import { useAuthStore } from '@/lib/store/auth';
import { useCurrentCourseStore } from '@/lib/store/current-course';
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
  const userId = useAuthStore((state) => state.userId) || 'local-user';
  const courseId = useCurrentCourseStore((state) => state.id) || 'personal';
  const courseName = useCurrentCourseStore((state) => state.name) || '我的学习';
  const preview =
    process.env.NODE_ENV !== 'production' && searchParams.get('previewCalendar') === '1';

  return (
    <LearningCalendarSurface
      key={`${userId}:${courseId}:${preview ? 'preview' : 'saved'}`}
      userId={userId}
      courseId={courseId}
      courseName={courseName}
      preview={preview}
    />
  );
}

function LearningCalendarSurface({
  userId,
  courseId,
  courseName,
  preview,
}: {
  userId: string;
  courseId: string;
  courseName: string;
  preview: boolean;
}) {
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [events, setEvents] = useState<SyllabusCalendarEvent[]>(() => {
    const stored = readSyllabusEvents(userId, courseId);
    return preview && stored.length === 0 ? previewEvents(new Date()) : stored;
  });
  const [enabledKinds, setEnabledKinds] = useState<SyllabusEventKind[]>(
    EVENT_KINDS.map((item) => item.value),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => newDraft());

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

  const saveEvents = (next: SyllabusCalendarEvent[]) => {
    const sorted = [...next].sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-CN'),
    );
    setEvents(sorted);
    if (!preview) writeSyllabusEvents(userId, courseId, sorted);
  };

  const openCreate = () => {
    setDraft(newDraft(referenceDate));
    setDialogOpen(true);
  };

  const openEdit = (event: SyllabusCalendarEvent) => {
    setDraft({
      id: event.id,
      title: event.title,
      date: event.date,
      kind: event.kind,
      durationMinutes: String(event.durationMinutes || 45),
    });
    setDialogOpen(true);
  };

  const commitDraft = () => {
    const title = draft.title.trim();
    if (!title || !draft.date) return;
    const duration = Number(draft.durationMinutes);
    const existing = draft.id ? events.find((event) => event.id === draft.id) : null;
    const event: SyllabusCalendarEvent = {
      id: existing?.id || makeEventId(),
      title,
      date: draft.date,
      kind: draft.kind,
      sourceName: existing?.sourceName || courseName,
      origin: existing?.origin || 'manual',
      sourceRef: existing?.sourceRef || { type: 'manual', id: courseId },
      durationMinutes: Number.isFinite(duration) ? Math.max(5, Math.round(duration)) : 45,
      status: existing?.status || 'planned',
      createdAt: existing?.createdAt || Date.now(),
    };
    saveEvents(
      existing
        ? events.map((item) => (item.id === existing.id ? event : item))
        : [...events, event],
    );
    setDialogOpen(false);
  };

  const deleteDraft = () => {
    if (!draft.id) return;
    saveEvents(events.filter((event) => event.id !== draft.id));
    setDialogOpen(false);
  };

  return (
    <div className="ipados-calendar flex h-full min-h-[680px] w-full overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <aside className="flex w-[258px] shrink-0 flex-col border-r border-black/[0.09] bg-[#f2f2f7] p-4 max-lg:w-[220px] max-md:hidden">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-[13px] font-semibold text-slate-500">学习空间</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-[-0.03em] text-slate-950">日历</h1>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="grid size-9 place-items-center rounded-full bg-[#007aff] text-white shadow-sm outline-none transition hover:bg-[#006ee6] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="新建日历事项"
          >
            <Plus className="size-5" strokeWidth={2.4} aria-hidden />
          </button>
        </div>

        <div className="mt-5 rounded-[13px] bg-white/90 p-2 shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-2 rounded-[10px] px-2 py-2">
            <span className="grid size-8 place-items-center rounded-[8px] bg-[#ff3b30] text-white">
              <CalendarDays className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{courseName}</p>
              <p className="truncate text-[11px] text-slate-500">当前课程日历</p>
            </div>
          </div>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            日历分类
          </p>
          <div className="mt-2 space-y-0.5">
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
                  className="flex w-full items-center justify-between rounded-[9px] px-2 py-2 text-left outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-pressed={enabled}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span
                      className={cn('grid size-4 place-items-center rounded-[5px]', item.color)}
                    >
                      {enabled ? <Check className="size-3 text-white" strokeWidth={3} /> : null}
                    </span>
                    {item.label}
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {events.filter((event) => event.kind === item.value).length}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-6 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            本月事项
          </p>
          <div className="mt-2 space-y-1">
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
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-4 sm:gap-4 sm:px-6">
          <div className="min-w-0 max-sm:max-w-[160px]">
            <p className="truncate text-xs font-semibold text-[#ff3b30]">{courseName}</p>
            <h2 className="truncate text-[28px] font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">
              {monthLabel}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-full bg-[#f2f2f7] px-3 text-sm font-semibold shadow-none sm:px-4"
              onClick={() => setReferenceDate(new Date())}
            >
              今天
            </Button>
            <div className="flex rounded-full bg-[#f2f2f7] p-0.5">
              <button
                type="button"
                onClick={() =>
                  setReferenceDate(
                    (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                  )
                }
                className="grid size-8 place-items-center rounded-full text-slate-600 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500"
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
                className="grid size-8 place-items-center rounded-full text-slate-600 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="下一个月"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="flex size-9 items-center justify-center gap-1.5 rounded-full bg-[#007aff] text-sm font-semibold text-white outline-none hover:bg-[#006ee6] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto sm:px-4"
              aria-label="新建"
            >
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">新建</span>
            </button>
          </div>
        </div>

        <LearningCalendarGrid
          days={calendarDays}
          syllabusEventsByCalendarDay={eventsByDay}
          isResearchCourse={false}
          maxVisibleItems={3}
          onSelectEvent={openEdit}
        />
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[460px] gap-0 overflow-hidden rounded-[24px] border-black/[0.08] bg-[#f2f2f7] p-0 shadow-2xl">
          <DialogHeader className="border-b border-black/[0.07] bg-white/85 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-bold tracking-[-0.02em]">
              {draft.id ? '编辑事项' : '新建事项'}
            </DialogTitle>
            <DialogDescription>更改会保存在当前课程的学习日历中。</DialogDescription>
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
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.07] bg-white/70 px-5 py-4">
            {draft.id ? (
              <Button
                type="button"
                variant="ghost"
                className="text-[#ff3b30] hover:bg-rose-50 hover:text-[#ff3b30]"
                onClick={deleteDraft}
              >
                <Trash2 className="size-4" aria-hidden />
                删除
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                className="bg-[#007aff] hover:bg-[#006ee6]"
                onClick={commitDraft}
                disabled={!draft.title.trim() || !draft.date}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
