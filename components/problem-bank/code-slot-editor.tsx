'use client';

import { useMemo, useRef, type KeyboardEvent } from 'react';
import { Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { highlightPython } from './code-answer-editor';
import { parseCodeTemplate, type CodeSlotTemplate } from '@/lib/problem-bank';
import { useCodeSlotDraft } from '@/lib/problem-bank/use-code-slot-draft';

const INDENT = '    ';

type Segment = NonNullable<ReturnType<typeof parseCodeTemplate>>[number];

/**
 * 带空位的代码编辑器：锁住的代码只读显示，只有发光的空位能填。
 * 对外仍然是整段代码（value / onChange），判分和运行不用关心空位。
 */
export function CodeSlotEditor({
  slotTemplate,
  value,
  onChange,
  disabled,
  locale,
  className,
}: {
  slotTemplate: CodeSlotTemplate;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  locale: 'zh-CN' | 'en-US';
  className?: string;
}) {
  const zh = locale === 'zh-CN';
  const segments = useMemo(
    () => parseCodeTemplate(slotTemplate.template, slotTemplate.slots) ?? [],
    [slotTemplate],
  );
  const { values, update } = useCodeSlotDraft(slotTemplate, value, onChange);
  const slotRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const slotOrder = segments.flatMap((segment) =>
    segment.kind === 'slot' ? [segment.slot.id] : [],
  );
  const filledCount = slotOrder.filter((id) => values[id]?.trim()).length;

  const focusSibling = (id: string, delta: number) => {
    const index = slotOrder.indexOf(id);
    const target = slotRefs.current[slotOrder[index + delta]];
    target?.focus();
  };

  return (
    <div
      className={cn(
        'flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-white',
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
        <div className="flex items-center gap-2 font-semibold">
          <Code2 className="h-3.5 w-3.5 text-sky-600" />
          <span>Python</span>
        </div>
        <SlotProgress total={slotOrder.length} filled={filledCount} zh={zh} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[13px] leading-6 text-slate-500">
        {segments.map((segment, index) =>
          segment.kind === 'text' ? (
            <span key={`t${index}`} className="whitespace-pre opacity-80">
              {highlightPython(trimAroundBlocks(segment, segments[index - 1], segments[index + 1]))}
            </span>
          ) : segment.slot.kind === 'block' ? (
            <BlockSlot
              key={segment.slot.id}
              indent={segment.indent}
              value={values[segment.slot.id] ?? ''}
              placeholder={
                segment.slot.placeholder ?? (zh ? '在这里写函数体' : 'Write the body here')
              }
              disabled={disabled}
              inputRef={(node) => {
                slotRefs.current[segment.slot.id] = node;
              }}
              onChange={(next) => update(segment.slot.id, next)}
            />
          ) : (
            <InlineSlot
              key={segment.slot.id}
              wide={segment.slot.kind === 'line'}
              value={values[segment.slot.id] ?? ''}
              placeholder={segment.slot.placeholder}
              hint={segment.slot.hint}
              disabled={disabled}
              inputRef={(node) => {
                slotRefs.current[segment.slot.id] = node;
              }}
              onChange={(next) => update(segment.slot.id, next)}
              onNext={() => focusSibling(segment.slot.id, 1)}
              onPrevious={() => focusSibling(segment.slot.id, -1)}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** 代码块空位前后各有一个换行，块本身已经独占一行，去掉免得多出空行。 */
function trimAroundBlocks(
  segment: Extract<Segment, { kind: 'text' }>,
  previous: Segment | undefined,
  next: Segment | undefined,
) {
  let text = segment.text;
  if (next?.kind === 'slot' && next.slot.kind === 'block') text = text.replace(/\n$/, '');
  if (previous?.kind === 'slot' && previous.slot.kind === 'block') text = text.replace(/^\n/, '');
  return text;
}

/** 右上角一排小珠子：填了的亮起来。 */
function SlotProgress({ total, filled, zh }: { total: number; filled: number; zh: boolean }) {
  if (total <= 1) return null;
  return (
    <span
      className="flex items-center gap-1"
      aria-label={zh ? `已填 ${filled}/${total} 个空` : `${filled}/${total} blanks filled`}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-2.5 w-2.5 rounded-full border transition-colors',
            index < filled
              ? 'border-sky-400 bg-gradient-to-br from-white via-sky-300 to-sky-500 shadow-[0_0_6px_rgba(56,189,248,0.6)]'
              : 'border-slate-300 bg-white/70',
          )}
        />
      ))}
    </span>
  );
}

const SLOT_CLASS =
  'rounded-md border border-sky-300/80 bg-sky-50/80 text-slate-900 shadow-[0_0_0_3px_rgba(125,211,252,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] outline-none transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(56,189,248,0.35)] disabled:cursor-not-allowed';

function InlineSlot({
  value,
  wide,
  placeholder,
  hint,
  disabled,
  inputRef,
  onChange,
  onNext,
  onPrevious,
}: {
  value: string;
  wide: boolean;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  inputRef: (node: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const size = Math.max(wide ? 24 : 6, value.length + 1, (placeholder?.length ?? 0) + 1);
  return (
    <input
      ref={inputRef}
      value={value}
      disabled={disabled}
      placeholder={placeholder ?? '…'}
      title={hint}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      size={size}
      className={cn(
        SLOT_CLASS,
        'mx-0.5 inline-block px-1.5 py-0 align-baseline font-mono text-[13px] leading-5',
      )}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
          event.preventDefault();
          onNext();
        } else if (event.key === 'Tab' && event.shiftKey) {
          event.preventDefault();
          onPrevious();
        }
      }}
    />
  );
}

function BlockSlot({
  indent,
  value,
  placeholder,
  disabled,
  inputRef,
  onChange,
}: {
  indent: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  inputRef: (node: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
}) {
  const rows = Math.max(4, value.split('\n').length + 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const place = (text: string, cursor: number) => {
      event.preventDefault();
      onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
      requestAnimationFrame(() => {
        target.selectionStart = cursor;
        target.selectionEnd = cursor;
      });
    };
    if (event.key === 'Tab' && !event.shiftKey) {
      place(INDENT, start + INDENT.length);
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      const line = value.slice(value.lastIndexOf('\n', start - 1) + 1, start);
      const lead = line.match(/^\s*/)?.[0] ?? '';
      const extra = /:\s*$/.test(line) ? INDENT : '';
      place(`\n${lead}${extra}`, start + 1 + lead.length + extra.length);
    } else if (event.key === 'Backspace' && start === end && start > 0) {
      const line = value.slice(value.lastIndexOf('\n', start - 1) + 1, start);
      if (line.length > 0 && /^ +$/.test(line) && line.length % INDENT.length === 0) {
        event.preventDefault();
        onChange(value.slice(0, start - INDENT.length) + value.slice(end));
        requestAnimationFrame(() => {
          target.selectionStart = start - INDENT.length;
          target.selectionEnd = start - INDENT.length;
        });
      }
    }
  };

  return (
    <div
      className="relative my-1 rounded-md bg-sky-50/60"
      style={{ marginLeft: `${indent.length}ch` }}
    >
      <pre
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-2 py-1 font-mono text-[13px] leading-6 text-slate-900"
      >
        <code>{highlightPython(value)}</code>
      </pre>
      <textarea
        ref={inputRef}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className={cn(
          SLOT_CLASS,
          'relative block w-full resize-none overflow-x-auto bg-transparent px-2 py-1 font-mono text-[13px] leading-6 text-transparent caret-sky-600 placeholder:text-slate-400 focus:bg-transparent',
        )}
        style={{ tabSize: 4 }}
      />
    </div>
  );
}
