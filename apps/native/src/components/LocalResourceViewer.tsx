import { useEffect, useMemo, useState } from 'react';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { Streamdown } from 'streamdown';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  FileText,
  HardDrive,
  ImageOff,
  Loader2,
} from 'lucide-react';

import { readLocalAsset } from '../data/asset-storage';
import type {
  LocalAsset,
  LocalNotebookDocument,
  LocalNotebookPage,
  LocalProblemDocument,
} from '../domain/models';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';

export type LocalResourceDocument =
  | { kind: 'notebook'; document: LocalNotebookDocument }
  | { kind: 'problem'; document: LocalProblemDocument };

type LocalResourceViewerProps = {
  resource: LocalResourceDocument;
  onClose: () => void;
};

type AssetImageSource = string | LocalAsset;

const math = createMathPlugin({ singleDollarTextMath: true });

function dataUrl(asset: LocalAsset): string | null {
  return asset.dataBase64 ? `data:${asset.mimeType};base64,${asset.dataBase64}` : null;
}

function assetSource(asset: LocalAsset): AssetImageSource | null {
  return dataUrl(asset) ?? (asset.storagePath ? asset : null);
}

function LocalAssetImage({
  source,
  alt,
  className,
}: {
  source: AssetImageSource;
  alt: string;
  className?: string;
}) {
  const immediateSource = typeof source === 'string' ? source : dataUrl(source);
  const [resolvedSource, setResolvedSource] = useState<string | null>(immediateSource);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setResolvedSource(immediateSource);
    if (immediateSource || typeof source === 'string') return () => undefined;
    void readLocalAsset(source)
      .then((value) => {
        if (!cancelled) {
          setResolvedSource(value);
          setFailed(!value);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [immediateSource, source]);

  if (failed) {
    return (
      <div className={`local-asset-state ${className ?? ''}`} role="status">
        <ImageOff size={22} />
        <span>本地图片无法读取</span>
      </div>
    );
  }
  if (!resolvedSource) {
    return (
      <div className={`local-asset-state ${className ?? ''}`} role="status">
        <Loader2 size={20} />
        <span>正在读取本地图片…</span>
      </div>
    );
  }
  return <img className={className} src={resolvedSource} alt={alt} />;
}

function normalizedPath(value: string): string {
  try {
    return /^https?:\/\//i.test(value) ? new URL(value).pathname : value.split(/[?#]/, 1)[0];
  } catch {
    return value;
  }
}

function assetResolver(assets: LocalAsset[]): (source: string) => AssetImageSource | null {
  const byPath = new Map<string, LocalAsset>();
  for (const asset of assets) byPath.set(asset.path, asset);
  return (source) => {
    if (source.startsWith('data:')) return source;
    const asset = byPath.get(source) ?? byPath.get(normalizedPath(source));
    return asset ? assetSource(asset) : null;
  };
}

function collectStrings(
  value: unknown,
  output: string[],
  key = '',
  visited = new Set<unknown>(),
): void {
  if (typeof value === 'string') {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'text' ||
      normalizedKey === 'content' ||
      normalizedKey === 'title' ||
      normalizedKey === 'subtitle' ||
      normalizedKey === 'label' ||
      normalizedKey === 'description'
    ) {
      const trimmed = value.trim();
      if (trimmed && !output.includes(trimmed)) output.push(trimmed);
    }
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, key, visited);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    collectStrings(child, output, childKey, visited);
  }
}

function collectImageSources(
  value: unknown,
  output: string[],
  key = '',
  visited = new Set<unknown>(),
): void {
  if (typeof value === 'string') {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'src' ||
      normalizedKey === 'image' ||
      normalizedKey === 'imageurl' ||
      normalizedKey === 'imagepath'
    ) {
      const trimmed = value.trim();
      if (trimmed && !output.includes(trimmed)) output.push(trimmed);
    }
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectImageSources(item, output, key, visited);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    collectImageSources(child, output, childKey, visited);
  }
}

function MarkdownBlock({
  markdown,
  resolveAsset,
}: {
  markdown: string;
  resolveAsset: (source: string) => AssetImageSource | null;
}) {
  return (
    <Streamdown
      className="local-markdown"
      mode="static"
      parseIncompleteMarkdown={false}
      normalizeHtmlIndentation
      plugins={{ code, math }}
      controls={{ code: false, table: true }}
      components={{
        img: ({ src, alt }) => {
          const asset = typeof src === 'string' ? resolveAsset(src) : null;
          return asset ? (
            <figure className="local-markdown-image">
              <LocalAssetImage source={asset} alt={alt || '笔记图片'} />
              {alt ? <figcaption>{alt}</figcaption> : null}
            </figure>
          ) : (
            <span className="local-missing-asset">
              <ImageOff size={15} />
              本地资料中缺少图片：{typeof src === 'string' ? src : '未知路径'}
            </span>
          );
        },
      }}
    >
      {markdown}
    </Streamdown>
  );
}

function NotebookPageView({
  page,
  document,
  resolveAsset,
}: {
  page: LocalNotebookPage;
  document: LocalNotebookDocument;
  resolveAsset: (source: string) => AssetImageSource | null;
}) {
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const linkedSources = document.pageAssets
    .filter((link) => link.pageId === page.id)
    .sort((left, right) => left.order - right.order)
    .flatMap((link) => {
      const asset = assetById.get(link.assetId);
      const source = asset ? assetSource(asset) : null;
      return source ? [source] : [];
    });
  const embeddedSources: string[] = [];
  collectImageSources(page.content, embeddedSources);
  const imageSources = [
    ...linkedSources,
    ...embeddedSources.flatMap((source) => {
      const resolved = resolveAsset(source);
      return resolved ? [resolved] : [];
    }),
  ];
  const text: string[] = [];
  collectStrings(page.content, text);
  const speech = page.actions.flatMap((action) => {
    if (!action || typeof action !== 'object') return [];
    const record = action as Record<string, unknown>;
    return record.type === 'speech' && typeof record.text === 'string' ? [record.text] : [];
  });

  return (
    <article className="local-page-view">
      {imageSources[0] ? (
        <LocalAssetImage className="local-page-image" source={imageSources[0]} alt={page.title} />
      ) : text.length ? (
        <div className="local-page-text">
          {text.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <div className="local-resource-empty">
          <ImageOff size={26} />
          <strong>这一页没有可离线显示的画面</strong>
          <span>如果它原来引用在线图片，请重新导出包含资源的迁移包。</span>
        </div>
      )}
      {speech.length ? (
        <details className="local-page-transcript">
          <summary>本页讲解稿</summary>
          {speech.map((paragraph, index) => (
            <p key={`${index}-${paragraph}`}>{paragraph}</p>
          ))}
        </details>
      ) : null}
    </article>
  );
}

function NotebookViewer({
  document,
  onClose,
}: {
  document: LocalNotebookDocument;
  onClose: () => void;
}) {
  const entries =
    document.notebook.kind === 'markdown' && document.markdownSections.length
      ? document.markdownSections
      : document.pages;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const resolveAsset = useMemo(() => assetResolver(document.assets), [document.assets]);

  useEffect(() => setSelectedIndex(0), [document.notebook.id]);
  const selected = entries[selectedIndex] ?? null;

  return (
    <section className="local-resource-sheet" aria-label={`${document.notebook.name} 本地阅读器`}>
      <header className="local-resource-header">
        <button type="button" className="local-resource-back" onClick={onClose}>
          <ArrowLeft size={18} />
          返回课程
        </button>
        <div>
          <span>本地笔记本</span>
          <h2>{document.notebook.name}</h2>
        </div>
        <span className="local-resource-storage">
          <HardDrive size={14} />
          {document.assets.length} 个离线资源
        </span>
      </header>
      <div className="local-notebook-layout">
        <nav className="local-notebook-index" aria-label="笔记章节">
          {entries.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              className={
                index === selectedIndex
                  ? 'local-index-row local-index-row-active'
                  : 'local-index-row'
              }
              onClick={() => setSelectedIndex(index)}
            >
              <span>{index + 1}</span>
              <strong>{entry.title}</strong>
            </button>
          ))}
        </nav>
        <main className="local-notebook-reader">
          {selected ? (
            <>
              <div className="local-reader-title">
                <span>
                  {document.notebook.kind === 'markdown' ? (
                    <FileText size={15} />
                  ) : (
                    <BookOpen size={15} />
                  )}
                  {selectedIndex + 1} / {entries.length}
                </span>
                <h1>{selected.title}</h1>
              </div>
              {'markdown' in selected ? (
                <MarkdownBlock markdown={selected.markdown} resolveAsset={resolveAsset} />
              ) : (
                <NotebookPageView page={selected} document={document} resolveAsset={resolveAsset} />
              )}
            </>
          ) : (
            <div className="local-resource-empty">
              <FileText size={27} />
              <strong>笔记本还没有内容</strong>
              <span>迁移包中保留了笔记本信息，但没有找到页面或 Markdown 章节。</span>
            </div>
          )}
        </main>
      </div>
      {entries.length > 1 ? (
        <footer className="local-reader-controls">
          <button
            type="button"
            disabled={selectedIndex === 0}
            onClick={() => setSelectedIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft size={17} />
            上一节
          </button>
          <span>
            {selectedIndex + 1} / {entries.length}
          </span>
          <button
            type="button"
            disabled={selectedIndex >= entries.length - 1}
            onClick={() => setSelectedIndex((current) => Math.min(entries.length - 1, current + 1))}
          >
            下一节
            <ChevronRight size={17} />
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function readableProblemParts(content: Record<string, unknown>): string[] {
  const preferredKeys = [
    'statement',
    'prompt',
    'question',
    'stem',
    'description',
    'instructions',
    'body',
  ];
  const parts = preferredKeys.flatMap((key) => {
    const value = content[key];
    return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  });
  if (parts.length) return [...new Set(parts)];
  const fallback: string[] = [];
  collectStrings(content, fallback);
  return fallback;
}

function problemChoices(content: Record<string, unknown>): string[] {
  const source = Array.isArray(content.options)
    ? content.options
    : Array.isArray(content.choices)
      ? content.choices
      : [];
  return source.flatMap((choice) => {
    if (typeof choice === 'string') return [choice];
    if (!choice || typeof choice !== 'object') return [];
    const record = choice as Record<string, unknown>;
    const text = record.text ?? record.label ?? record.content;
    return typeof text === 'string' ? [text] : [];
  });
}

function ProblemViewer({
  document,
  onClose,
}: {
  document: LocalProblemDocument;
  onClose: () => void;
}) {
  const statements = readableProblemParts(document.problem.publicContent);
  const choices = problemChoices(document.problem.publicContent);
  const progress = document.progress;
  return (
    <section className="local-resource-sheet local-problem-sheet" aria-label="本地题目阅读器">
      <header className="local-resource-header">
        <button type="button" className="local-resource-back" onClick={onClose}>
          <ArrowLeft size={18} />
          返回题库
        </button>
        <div>
          <span>本地题库</span>
          <h2>{document.problem.title}</h2>
        </div>
        <span className="local-resource-storage">
          <HardDrive size={14} />
          无需加载服务器
        </span>
      </header>
      <main className="local-problem-reader">
        <div className="local-problem-meta">
          <span>
            <FileQuestion size={14} />
            {document.problem.type}
          </span>
          <span>{document.problem.difficulty}</span>
          {progress ? (
            <span className={progress.status === 'passed' ? 'local-progress-passed' : ''}>
              <CheckCircle2 size={14} />
              {progress.status} · 已作答 {progress.attemptedCount} 次
            </span>
          ) : null}
        </div>
        <article className="local-problem-card">
          {statements.length ? (
            statements.map((statement) => <p key={statement}>{statement}</p>)
          ) : (
            <p>这道题的公开内容为空。</p>
          )}
          {choices.length ? (
            <ol className="local-problem-choices">
              {choices.map((choice) => (
                <li key={choice}>{choice}</li>
              ))}
            </ol>
          ) : null}
        </article>
        {document.attempts.length ? (
          <section className="local-attempt-history">
            <h3>历史作答</h3>
            {document.attempts.map((attempt) => (
              <article key={attempt.id}>
                <span>{new Date(attempt.createdAt).toLocaleString()}</span>
                <strong>{attempt.status}</strong>
                <span>{attempt.score === null ? '未评分' : `${attempt.score} 分`}</span>
              </article>
            ))}
          </section>
        ) : null}
      </main>
    </section>
  );
}

export function LocalResourceViewer({ resource, onClose }: LocalResourceViewerProps) {
  const title = resource.kind === 'notebook' ? resource.document.notebook.name : '本地题目';

  return (
    <NativeWorkspaceDialog
      open
      onClose={onClose}
      title={title}
      description={resource.kind === 'notebook' ? '本机笔记本阅读器' : '本机题目阅读器'}
    >
      {resource.kind === 'notebook' ? (
        <NotebookViewer document={resource.document} onClose={onClose} />
      ) : (
        <ProblemViewer document={resource.document} onClose={onClose} />
      )}
    </NativeWorkspaceDialog>
  );
}
