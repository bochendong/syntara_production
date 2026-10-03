'use client';

import type { ReactNode } from 'react';

const ROLE_LABELS: Record<string, string> = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具',
};

const TYPE_LABELS: Record<string, string> = {
  short_answer: '简答',
  multiple_choice: '选择',
  multi_select: '多选',
  choice: '选择',
  true_false: '判断',
  calculation: '计算',
  concept: '概念',
  proof: '证明',
  essay: '论述',
  code: '编程',
  fill_blank: '填空',
  short_text: '短文本',
  rubric: '按标准评分',
  exact_choice: '选择判分',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '容易',
  medium: '中等',
  hard: '困难',
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function labelFor(value: unknown) {
  if (typeof value !== 'string') return '';
  return TYPE_LABELS[value] ?? DIFFICULTY_LABELS[value] ?? value;
}

function repairJsonEscapes(input: string) {
  let output = '';
  let inString = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (char === '\\') {
      const next = input[index + 1] || '';
      const hex = input.slice(index + 2, index + 6);
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) {
        output += `\\u${hex}`;
        index += 5;
      } else if ('"\\/bfnrt'.includes(next)) {
        output += `\\${next}`;
        index += 1;
      } else {
        output += '\\\\';
      }
      continue;
    }
    output += char;
    if (char === '"') inString = false;
  }
  return output;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    try {
      return JSON.parse(repairJsonEscapes(trimmed)) as unknown;
    } catch {
      return null;
    }
  }
}

function Prose({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm leading-6">{text}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="rounded-lg border bg-background px-3 py-2.5">{children}</div>
    </div>
  );
}

function splitEmbeddedJson(text: string): { prose: string; data: unknown } | null {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '[' && char !== '{') continue;
    if (index > 0 && !/\s/.test(text[index - 1] || '')) continue;
    const parsed = tryParseJson(text.slice(index));
    if (parsed == null || typeof parsed !== 'object') continue;
    const prose = text.slice(0, index).trim();
    if (!prose) return null;
    return { prose, data: parsed };
  }
  return null;
}

function isMessage(value: unknown): value is { role?: string; content?: unknown } {
  return isRecord(value) && typeof value.role === 'string' && 'content' in value;
}

function isProblemDraft(value: unknown): value is JsonRecord {
  return isRecord(value) && isRecord(value.publicContent) && isRecord(value.grading);
}

function TextBlock({ text }: { text: string }) {
  const parsed = tryParseJson(text);
  if (parsed != null) return <ReadableValue value={parsed} />;
  const embedded = splitEmbeddedJson(text);
  if (!embedded) return <Prose text={text} />;
  return (
    <div className="space-y-3">
      <Prose text={embedded.prose} />
      <ReadableValue value={embedded.data} />
    </div>
  );
}

function ContentParts({ value }: { value: unknown }) {
  if (typeof value === 'string') return <TextBlock text={value} />;
  if (!Array.isArray(value)) return <ReadableValue value={value} />;

  const visible = value.filter((part) => {
    if (!isRecord(part)) return true;
    if (part.type === 'reasoning') return typeof part.text === 'string' && part.text.trim().length > 0;
    return true;
  });

  if (visible.length === 0) return <p className="text-sm text-muted-foreground">无正文</p>;

  return (
    <div className="space-y-3">
      {visible.map((part, index) => (
        <ContentPart key={index} part={part} />
      ))}
    </div>
  );
}

function ContentPart({ part }: { part: unknown }) {
  if (typeof part === 'string') return <TextBlock text={part} />;
  if (!isRecord(part)) return <ReadableValue value={part} />;
  if (part.type === 'text' && typeof part.text === 'string') return <TextBlock text={part.text} />;
  if (part.type === 'reasoning' && typeof part.text === 'string') {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">思考</p>
        <Prose text={part.text} />
      </div>
    );
  }
  if (part.type === 'file') {
    const name =
      (typeof part.filename === 'string' && part.filename) ||
      (typeof part.mediaType === 'string' && part.mediaType) ||
      '文件';
    return <p className="text-sm text-muted-foreground">附件：{name}</p>;
  }
  if (typeof part.type === 'string' && part.type.includes('tool')) {
    const name = typeof part.toolName === 'string' ? part.toolName : '工具';
    return <p className="text-sm">调用了 {name}</p>;
  }
  return <ReadableValue value={part} />;
}

function ProblemDraft({ draft }: { draft: JsonRecord }) {
  const content = isRecord(draft.publicContent) ? draft.publicContent : {};
  const grading = isRecord(draft.grading) ? draft.grading : {};
  const stem = typeof content.stem === 'string' ? content.stem : '';
  const title = typeof draft.title === 'string' ? draft.title : '';
  const answer = typeof grading.referenceAnswer === 'string' ? grading.referenceAnswer : '';
  const criteria = Array.isArray(grading.rubricCriteria) ? grading.rubricCriteria : [];
  const options = Array.isArray(content.options) ? content.options : [];
  const correctIds = new Set(
    Array.isArray(grading.correctOptionIds)
      ? grading.correctOptionIds.filter((item): item is string => typeof item === 'string')
      : [],
  );
  const errors = [
    ...(Array.isArray(draft.errors) ? draft.errors : []),
    ...(Array.isArray(draft.validationErrors) ? draft.validationErrors : []),
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const kind = [
    labelFor(draft.type) || labelFor(content.type),
    labelFor(content.taskKind),
    labelFor(draft.difficulty),
    typeof draft.points === 'number' ? `${draft.points} 分` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="space-y-3 rounded-lg border bg-background px-3 py-3">
      {kind ? <p className="text-xs font-medium text-muted-foreground">{kind}</p> : null}
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {errors.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">需要修复</p>
          <ul className="space-y-1 text-sm leading-6">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {stem ? <Prose text={stem} /> : null}
      {options.length > 0 ? (
        <ul className="space-y-1 text-sm leading-6">
          {options.map((option, index) => {
            if (!isRecord(option)) return null;
            const id = typeof option.id === 'string' ? option.id : String(index + 1);
            const label = typeof option.label === 'string' ? option.label : '';
            return (
              <li key={id}>
                {id}. {label}
                {correctIds.has(id) ? <span className="text-muted-foreground"> · 正确</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {answer ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">参考答案</p>
          <Prose text={answer} />
        </div>
      ) : null}
      {criteria.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">评分标准</p>
          <ul className="space-y-1 text-sm leading-6">
            {criteria.map((item, index) => {
              if (!isRecord(item)) return null;
              const description = typeof item.description === 'string' ? item.description : '';
              const points = typeof item.points === 'number' ? `${item.points} 分` : '';
              return (
                <li key={typeof item.id === 'string' ? item.id : index}>
                  {description}
                  {points ? <span className="text-muted-foreground"> · {points}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function MessageList({ messages }: { messages: unknown[] }) {
  return (
    <div className="space-y-3">
      {messages.map((message, index) => {
        if (!isMessage(message)) return <ReadableValue key={index} value={message} />;
        const role = ROLE_LABELS[message.role || ''] || message.role || '消息';
        return (
          <Section key={index} title={role}>
            <ContentParts value={message.content} />
          </Section>
        );
      })}
    </div>
  );
}

function RequestView({ value }: { value: JsonRecord }) {
  const messages = Array.isArray(value.messages) ? value.messages : null;
  const tools = Array.isArray(value.tools) ? value.tools.filter((item) => typeof item === 'string') : [];

  return (
    <div className="space-y-3">
      {typeof value.system === 'string' ? (
        <Section title="系统提示">
          <Prose text={value.system} />
        </Section>
      ) : null}
      {typeof value.prompt === 'string' ? (
        <Section title="用户提示">
          <TextBlock text={value.prompt} />
        </Section>
      ) : null}
      {messages ? <MessageList messages={messages} /> : null}
      {tools.length > 0 ? (
        <Section title="工具">
          <p className="text-sm">{tools.join('、')}</p>
        </Section>
      ) : null}
      {typeof value.maxOutputTokens === 'number' ? (
        <p className="text-xs text-muted-foreground">最大输出 {value.maxOutputTokens.toLocaleString('zh-CN')} tokens</p>
      ) : null}
    </div>
  );
}

function ReadableValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <TextBlock text={value} />;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm">{String(value)}</p>;
  }
  if (value == null) return <p className="text-sm text-muted-foreground">无内容</p>;
  if (Array.isArray(value)) {
    if (value.every(isMessage)) return <MessageList messages={value} />;
    if (value.length > 0 && value.every(isProblemDraft)) {
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">共 {value.length} 题</p>
          {value.map((draft, index) => (
            <ProblemDraft key={index} draft={draft} />
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {value.map((item, index) => (
          <ReadableValue key={index} value={item} />
        ))}
      </div>
    );
  }
  if (isRecord(value)) {
    if (typeof value.system === 'string' || typeof value.prompt === 'string' || Array.isArray(value.messages)) {
      return <RequestView value={value} />;
    }
    const entries = Object.entries(value).filter(([key]) => key !== 'providerOptions');
    return (
      <div className="space-y-2">
        {entries.map(([key, item]) => (
          <div key={key} className="space-y-1">
            <p className="text-xs text-muted-foreground">{key}</p>
            <ReadableValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  return <Prose text={String(value)} />;
}

export function UsageContentBody({ text }: { text: string }) {
  const parsed = tryParseJson(text);
  if (parsed == null) return <Prose text={text} />;
  return <ReadableValue value={parsed} />;
}
