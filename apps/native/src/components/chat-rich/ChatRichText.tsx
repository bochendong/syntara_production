import { memo, useMemo, type MouseEvent } from 'react';
import {
  BookOpen,
  Brain,
  Calculator,
  CalendarDays,
  CircleCheck,
  Clock,
  Flag,
  KeyRound,
  Lightbulb,
  PenLine,
  RefreshCw,
  Search,
  Star,
  Target,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { marbleImages, memoryMarble } from '../../lib/learning-action-marbles';
import { renderProblemRichTextHtml } from '../problem-bank/problem-rich-text';
import './chat-rich.css';

/** 回答里 [^n] 指向的来源（第 n 条课程笔记片段）。 */
export interface ChatRichSource {
  title: string;
  notebookId?: string;
}

/** 回答里 [^mn] 指向的学习记忆（第 n 颗珠子），胶囊按记忆类型上色。 */
export interface ChatRichMemory {
  id: string;
  title: string;
  kind?: string;
}

interface RichRefs {
  sources: ChatRichSource[];
  memories: ChatRichMemory[];
}

const STEP_ICONS: Record<string, LucideIcon> = {
  check: CircleCheck,
  book: BookOpen,
  pen: PenLine,
  clock: Clock,
  target: Target,
  alert: TriangleAlert,
  idea: Lightbulb,
  repeat: RefreshCw,
  calendar: CalendarDays,
  flag: Flag,
  brain: Brain,
  calc: Calculator,
  search: Search,
  star: Star,
};

const CALLOUTS = {
  tip: { icon: Lightbulb, label: '提示' },
  warning: { icon: TriangleAlert, label: '易错' },
  key: { icon: KeyRound, label: '重点' },
} as const;
type CalloutKind = keyof typeof CALLOUTS;

type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'steps'; lines: string[] }
  | { kind: 'callout'; variant: CalloutKind; title: string; text: string };

const SPECIAL_FENCE = /^\s*```(steps|tip|warning|key)\b[ \t]*(.*)$/;

/** 把 ```steps / ```tip / ```warning / ```key 块切出来；流式输出时没闭合的块也照常画。 */
function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let markdown: string[] = [];
  const flush = () => {
    if (markdown.join('').trim()) segments.push({ kind: 'markdown', text: markdown.join('\n') });
    markdown = [];
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(SPECIAL_FENCE);
    if (!open) {
      markdown.push(lines[index]);
      continue;
    }
    flush();
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    if (open[1] === 'steps') {
      segments.push({ kind: 'steps', lines: body.filter((line) => line.trim()) });
    } else {
      segments.push({
        kind: 'callout',
        variant: open[1] as CalloutKind,
        title: open[2].trim(),
        text: body.join('\n'),
      });
    }
  }
  flush();
  return segments;
}

// 难度 / 优先级单元格：粉 = 高/难，琥珀 = 中，绿 = 低/易（和难度珠子一致）。
const BADGE_TONES: Array<[RegExp, string]> = [
  [/^(最高|很高|高|极高|难|困难|较难|挑战|必考|重点|紧急|high|hard|critical)$/i, 'hi'],
  [/^(中|中等|进阶|较高|一般|普通|medium|moderate)$/i, 'mid'],
  [/^(低|较低|易|简单|容易|基础|已掌握|low|easy)$/i, 'lo'],
];

function badgeCells(html: string): string {
  return html.replace(/<td>([^<]{1,8})<\/td>/g, (match, text: string) => {
    const tone = BADGE_TONES.find(([pattern]) => pattern.test(text.trim()))?.[1];
    return tone
      ? `<td><span class="chat-badge chat-badge-${tone}">${text.trim()}</span></td>`
      : match;
  });
}

function escapeAttr(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 来源标题只留小节名，笔记本名放在 title 提示里。 */
function shortSourceTitle(source: ChatRichSource | undefined, index: number): string {
  if (!source) return `笔记 ${index}`;
  const parts = source.title.split(' · ');
  return parts[parts.length - 1] || source.title;
}

function citationChips(html: string, sources: ChatRichSource[]): string {
  return html.replace(/(?:@@SYNCITE(\d+)@@\s*)+/g, (group) => {
    const indexes = [...group.matchAll(/@@SYNCITE(\d+)@@/g)].map((item) => Number(item[1]));
    const unique = [...new Set(indexes)];
    const first = unique[0];
    const source = sources[first - 1];
    const extra =
      unique.length > 1 ? `<span class="chat-cite-more">+${unique.length - 1}</span>` : '';
    return `<button type="button" class="chat-cite" data-cite="${unique.join(',')}" title="${escapeAttr(
      source?.title ?? `笔记 ${first}`,
    )}"><span class="chat-cite-dot"></span><span class="chat-cite-text">${escapeAttr(
      shortSourceTitle(source, first),
    )}</span>${extra}</button>`;
  });
}

function memoryChips(html: string, memories: ChatRichMemory[]): string {
  return html.replace(/(?:@@SYNMEM(\d+)@@\s*)+/g, (group) => {
    const indexes = [...group.matchAll(/@@SYNMEM(\d+)@@/g)].map((item) => Number(item[1]));
    const unique = [...new Set(indexes)];
    const memory = memories[unique[0] - 1];
    const marble = memoryMarble(memory?.kind);
    const extra =
      unique.length > 1 ? `<span class="chat-cite-more">+${unique.length - 1}</span>` : '';
    return `<button type="button" class="chat-cite chat-cite-memory chat-cite-${marble.color}" data-memory="${unique.join(
      ',',
    )}" title="${escapeAttr(`${marble.label} · ${memory?.title ?? '学习记忆'}`)}"><img class="chat-cite-marble" src="${
      marbleImages[marble.color]
    }" alt="" /><span class="chat-cite-text">${escapeAttr(
      memory?.title ?? marble.label,
    )}</span>${extra}</button>`;
  });
}

function renderMarkdown(text: string, refs: RichRefs): string {
  const marked = text
    .replace(/\[\^m(\d{1,2})\]/g, '@@SYNMEM$1@@')
    .replace(/\[\^(\d{1,2})\]/g, '@@SYNCITE$1@@');
  return memoryChips(
    citationChips(badgeCells(renderProblemRichTextHtml(marked)), refs.sources),
    refs.memories,
  );
}

function Markdown({ text, refs }: { text: string; refs: RichRefs }) {
  const html = useMemo(() => renderMarkdown(text, refs), [text, refs]);
  return html ? <div className="chat-rich-md" dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

/** 每行：`图标 | 标题 | 说明`，图标可省（就用序号珠子）。 */
function Steps({ lines, refs }: { lines: string[]; refs: RichRefs }) {
  return (
    <ol className="chat-steps">
      {lines.map((line, index) => {
        const cells = line
          .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
          .split('|')
          .map((cell) => cell.trim());
        const Icon = cells.length >= 2 ? STEP_ICONS[cells[0].toLowerCase()] : undefined;
        const rest = Icon || (cells.length >= 3 && !cells[0]) ? cells.slice(1) : cells;
        const [title = '', ...detail] = rest;
        return (
          <li key={index}>
            <span className="chat-step-icon" aria-hidden>
              {Icon ? <Icon size={16} strokeWidth={2} /> : index + 1}
            </span>
            <div>
              <Markdown text={`**${title}**`} refs={refs} />
              {detail.join(' | ') ? <Markdown text={detail.join(' | ')} refs={refs} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Callout({
  variant,
  title,
  text,
  refs,
}: {
  variant: CalloutKind;
  title: string;
  text: string;
  refs: RichRefs;
}) {
  const { icon: Icon, label } = CALLOUTS[variant];
  return (
    <aside className={`chat-callout chat-callout-${variant}`}>
      <header>
        <Icon size={14} strokeWidth={2.2} aria-hidden />
        <span>{title || label}</span>
      </header>
      <Markdown text={text} refs={refs} />
    </aside>
  );
}

const NO_SOURCES: ChatRichSource[] = [];
const NO_MEMORIES: ChatRichMemory[] = [];

/**
 * 助教回答：Markdown + 引用胶囊、步骤列表、提示框、表格徽章。
 * 点引用胶囊时回调第一条来源（下标从 0 开始）。
 */
export const ChatRichText = memo(function ChatRichText({
  text,
  sources = NO_SOURCES,
  memories = NO_MEMORIES,
  onOpenSource,
  onOpenMemory,
}: {
  text: string;
  sources?: ChatRichSource[];
  memories?: ChatRichMemory[];
  onOpenSource?: (source: ChatRichSource) => void;
  onOpenMemory?: (memory: ChatRichMemory) => void;
}) {
  const segments = useMemo(() => splitSegments(text), [text]);
  const refs = useMemo(() => ({ sources, memories }), [sources, memories]);
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const memoryChip = (event.target as HTMLElement).closest<HTMLElement>('[data-memory]');
    if (memoryChip) {
      const memory = memories[Number(memoryChip.dataset.memory?.split(',')[0]) - 1];
      if (memory && onOpenMemory) onOpenMemory(memory);
      return;
    }
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-cite]');
    if (!chip) return;
    const first = Number(chip.dataset.cite?.split(',')[0]);
    const source = sources[first - 1];
    if (source && onOpenSource) onOpenSource(source);
  };
  return (
    <div className="chat-message-markdown chat-rich" onClick={handleClick}>
      {segments.map((segment, index) =>
        segment.kind === 'markdown' ? (
          <Markdown key={index} text={segment.text} refs={refs} />
        ) : segment.kind === 'steps' ? (
          <Steps key={index} lines={segment.lines} refs={refs} />
        ) : (
          <Callout
            key={index}
            variant={segment.variant}
            title={segment.title}
            text={segment.text}
            refs={refs}
          />
        ),
      )}
    </div>
  );
});
