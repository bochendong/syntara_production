import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { Streamdown } from 'streamdown';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  HardDrive,
  ImageOff,
  RotateCcw,
} from 'lucide-react';

import { readLocalAsset } from '../data/asset-storage';
import type {
  LocalAsset,
  LocalNotebook,
  LocalNotebookDocument,
  LocalNotebookPage,
  LocalProblemDocument,
} from '../domain/models';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';
import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { DIFFICULTY_MARBLES, marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import {
  loadNotebookReading,
  saveNotebookReading,
  splitNotebookName,
} from '../lib/notebook-reading';
import './course-pages.css';
import { GlassSpinner } from './GlassLoadMore';
import { LearningEmptyState } from './LearningEmptyState';
import { ContentLanguageSwitch } from './ContentLanguageSwitch';
import { getLocalRepository } from '../data/repository';
import { loadNotebookForReading } from '../data/course-sync';
import {
  notebookDisplayName,
  notebookLanguage,
  notebookVariants,
} from '../lib/notebook-translations';

const PROGRESS_STATUS_LABELS: Record<string, string> = {
  passed: '已通过',
  partial: '部分正确',
  failed: '未通过',
  pending: '待批改',
};

export type LocalResourceDocument =
  | { kind: 'notebook'; document: LocalNotebookDocument }
  | { kind: 'problem'; document: LocalProblemDocument };

type LocalResourceViewerProps = {
  resource: LocalResourceDocument;
  notebooks?: LocalNotebook[];
  /** 笔记本的弹珠颜色（跟着它在课程里的顺序），阅读器的点缀色都用它。 */
  accent?: MarbleColor;
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
  const [loadResult, setLoadResult] = useState<{
    source: AssetImageSource;
    value: string | null;
    failed: boolean;
  } | null>(null);
  const currentResult = loadResult?.source === source ? loadResult : null;
  const resolvedSource = immediateSource ?? currentResult?.value ?? null;
  const failed = currentResult?.failed ?? false;

  useEffect(() => {
    if (immediateSource || typeof source === 'string') return;
    let cancelled = false;
    void readLocalAsset(source)
      .then((value) => {
        if (!cancelled) {
          setLoadResult({ source, value, failed: !value });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadResult({ source, value: null, failed: true });
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
        <GlassSpinner size={20} />
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
  document: initialDocument,
  variants,
  accent,
  onClose,
}: {
  document: LocalNotebookDocument;
  variants: LocalNotebook[];
  accent: MarbleColor;
  onClose: () => void;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const languageRequest = useRef(0);
  useEffect(
    () => () => {
      languageRequest.current += 1;
    },
    [],
  );
  const entries =
    document.notebook.kind === 'markdown' && document.markdownSections.length
      ? document.markdownSections
      : document.pages;
  const notebookId = document.notebook.id;
  // 从上次读到的那一节打开。
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const last = loadNotebookReading(notebookId)?.last ?? 0;
    return last >= 0 && last < entries.length ? last : 0;
  });
  const [visited, setVisited] = useState<Set<number>>(
    () =>
      new Set([
        ...(loadNotebookReading(notebookId)?.visited ?? []),
        ...(entries.length ? [selectedIndex] : []),
      ]),
  );
  const resolveAsset = useMemo(() => assetResolver(document.assets), [document.assets]);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const switchLanguage = async (notebook: LocalNotebook) => {
    if (languageBusy || notebook.id === document.notebook.id) return;
    const request = ++languageRequest.current;
    setLanguageBusy(true);
    setLanguageError(null);
    setChaptersOpen(false);
    try {
      const repository = await getLocalRepository();
      const translated = await loadNotebookForReading(repository, notebook.id);
      if (!translated) throw new Error('找不到这个语言版本。');
      if (request !== languageRequest.current) return;
      const count =
        translated.notebook.kind === 'markdown'
          ? translated.markdownSections.length
          : translated.pages.length;
      const index = Math.max(0, Math.min(selectedIndexRef.current, count - 1));
      setDocument(translated);
      setSelectedIndex(index);
      setVisited(
        new Set([...(loadNotebookReading(notebook.id)?.visited ?? []), ...(count ? [index] : [])]),
      );
    } catch (cause) {
      if (request === languageRequest.current) {
        setLanguageError(
          `切换失败，请重试：${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    } finally {
      if (request === languageRequest.current) setLanguageBusy(false);
    }
  };
  // 章节目录收在一颗胶囊里：点开是一块玻璃列表，名字再长也整行显示。
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const indexRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chaptersOpen) return;
    const close = (event: PointerEvent) => {
      if (!indexRef.current?.contains(event.target as Node)) setChaptersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChaptersOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    indexRef.current
      ?.querySelector<HTMLElement>('.nr-chapter-list .is-active')
      ?.scrollIntoView({ block: 'nearest' });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [chaptersOpen]);

  const selected = entries[selectedIndex] ?? null;
  const next = entries[selectedIndex + 1] ?? null;
  const isLast = entries.length > 0 && selectedIndex === entries.length - 1;
  const { number: notebookNumber, title: notebookTitle } = splitNotebookName(
    notebookDisplayName(document.notebook),
  );

  useEffect(() => {
    if (!entries.length) return;
    saveNotebookReading(notebookId, selectedIndex);
  }, [entries.length, notebookId, selectedIndex]);

  // 换一节时回到顶部；阅读进度写进 CSS 变量，顶上的弹珠跟着滚。
  const pageRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const updateScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller || !pageRef.current) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const value = max > 4 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 1;
    pageRef.current.style.setProperty('--nr-read', value.toFixed(4));
  };
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    const frame = window.requestAnimationFrame(updateScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedIndex, notebookId]);

  const chapterButtons = (onPick?: () => void) =>
    entries.map((entry, index) => (
      <li key={entry.id} style={{ animationDelay: `${Math.min(index, 10) * 18}ms` }}>
        <button
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={[
            index === selectedIndex ? 'is-active' : '',
            visited.has(index) ? 'is-read' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            goTo(index);
            onPick?.();
          }}
        >
          <span className="nr-index-dot">
            {index === selectedIndex ? <img src={marbleImages[accent]} alt="" /> : index + 1}
          </span>
          <span className="nr-chapter-list-label">{entry.title}</span>
        </button>
      </li>
    ));

  const goTo = (index: number) => {
    const nextIndex = Math.max(0, Math.min(entries.length - 1, index));
    setVisited((current) => new Set([...current, nextIndex]));
    setSelectedIndex(nextIndex);
  };

  return (
    <section
      ref={pageRef}
      className="nr-page"
      style={
        {
          '--nr-rgb': `var(--marble-${accent}-rgb)`,
          '--nr-ink': `var(--marble-${accent}-ink)`,
          '--nr-light': `var(--marble-${accent}-light)`,
        } as CSSProperties
      }
      aria-label={`${notebookDisplayName(document.notebook)} 阅读`}
      lang={notebookLanguage(document.notebook) ?? undefined}
    >
      <header className={`nr-header${variants.length > 1 ? ' nr-header-bilingual' : ''}`}>
        <button type="button" className="phone-glass-button" onClick={onClose} aria-label="返回">
          <ChevronLeft size={22} />
        </button>
        <div className="nr-title">
          <strong>{notebookTitle}</strong>
          {entries.length ? (
            <small>
              {selectedIndex + 1} / {entries.length}
            </small>
          ) : null}
        </div>
        {variants.length > 1 ? (
          <ContentLanguageSwitch
            label="讲义语言"
            value={notebookLanguage(document.notebook) === 'en' ? 'en-US' : 'zh-CN'}
            busy={languageBusy}
            onChange={(language) => {
              const variant = variants.find(
                (item) => notebookLanguage(item) === (language === 'en-US' ? 'en' : 'zh-CN'),
              );
              if (variant) void switchLanguage(variant);
            }}
          />
        ) : (
          <span aria-hidden />
        )}
        {/* 一根细玻璃管：读到哪，弹珠就滚到哪。 */}
        <span className="nr-meter" aria-hidden>
          <i />
          <img src={marbleImages[accent]} alt="" />
        </span>
      </header>

      <div className="nr-body">
        {languageError ? (
          <p className="nr-language-error" role="alert">
            {languageError}
          </p>
        ) : null}
        {entries.length > 1 ? (
          <div ref={indexRef} className={`nr-chapters${chaptersOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="nr-chapter-pill"
              aria-expanded={chaptersOpen}
              aria-haspopup="listbox"
              onClick={() => setChaptersOpen((open) => !open)}
            >
              <img src={marbleImages[accent]} alt="" />
              <span className="nr-chapter-pill-label">{selected?.title}</span>
              <small>
                {selectedIndex + 1}/{entries.length}
              </small>
              <ChevronDown size={16} className="nr-chapter-pill-chevron" />
            </button>
            {chaptersOpen ? (
              <ol className="nr-chapter-list" role="listbox" aria-label="章节">
                {chapterButtons(() => setChaptersOpen(false))}
              </ol>
            ) : null}
          </div>
        ) : null}

        <div ref={scrollRef} className="nr-scroll" onScroll={updateScroll}>
          {selected ? (
            <>
              <article key={selected.id} className="nr-article">
                <div className="nr-eyebrow" aria-hidden>
                  <span className="nr-eyebrow-marble">
                    <img src={marbleImages[accent]} alt="" />
                    {notebookNumber ? <b>{notebookNumber}</b> : null}
                  </span>
                </div>
                <h1>{selected.title}</h1>
                {'markdown' in selected ? (
                  <MarkdownBlock markdown={selected.markdown} resolveAsset={resolveAsset} />
                ) : (
                  <NotebookPageView
                    page={selected}
                    document={document}
                    resolveAsset={resolveAsset}
                  />
                )}
              </article>

              {next ? (
                <button
                  type="button"
                  key={`next-${selectedIndex}`}
                  className="nr-next"
                  onClick={() => goTo(selectedIndex + 1)}
                >
                  <span className="nr-next-copy">
                    <small>下一节</small>
                    <strong>{next.title}</strong>
                  </span>
                  <span className="nr-next-marble" aria-hidden>
                    <img src={marbleImages[accent]} alt="" />
                  </span>
                </button>
              ) : isLast && entries.length > 1 ? (
                <NotebookFinish
                  key={`finish-${notebookId}`}
                  accent={accent}
                  total={entries.length}
                  readCount={visited.size}
                  onRestart={() => goTo(0)}
                  onClose={onClose}
                />
              ) : null}
            </>
          ) : (
            <LearningEmptyState title="这本笔记还没有内容" />
          )}
        </div>
        {/* 宽屏：章节目录竖在右边，离左侧的应用侧边栏远一点。 */}
        {entries.length > 1 ? (
          <aside className="nr-toc" aria-label="章节">
            <ol role="listbox">{chapterButtons()}</ol>
          </aside>
        ) : null}
      </div>

      {entries.length > 1 ? (
        <footer className="nr-controls">
          <button
            type="button"
            disabled={selectedIndex === 0}
            onClick={() => goTo(selectedIndex - 1)}
            aria-label="上一节"
          >
            <ChevronLeft size={20} />
          </button>
          <span>
            {selectedIndex + 1} / {entries.length}
          </span>
          <button
            type="button"
            disabled={selectedIndex >= entries.length - 1}
            onClick={() => goTo(selectedIndex + 1)}
            aria-label="下一节"
          >
            <ChevronRight size={20} />
          </button>
        </footer>
      ) : null}
    </section>
  );
}

/** 读到最后一节：弹珠一颗颗落进玻璃槽，读过几节就落几颗。 */
function NotebookFinish({
  accent,
  total,
  readCount,
  onRestart,
  onClose,
}: {
  accent: MarbleColor;
  total: number;
  readCount: number;
  onRestart: () => void;
  onClose: () => void;
}) {
  const shown = Math.min(total, 12);
  const lit = Math.min(shown, Math.round((Math.min(readCount, total) / total) * shown));
  const [hop, setHop] = useState(0);
  return (
    <div className="nr-finish">
      <button
        type="button"
        className="nr-finish-tray"
        key={hop}
        aria-label="再弹一下"
        onClick={() => setHop((value) => value + 1)}
      >
        {Array.from({ length: shown }, (_, index) => (
          <img
            key={index}
            src={marbleImages[accent]}
            alt=""
            className={index < lit ? 'is-lit' : undefined}
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </button>
      <strong>{readCount >= total ? '读完了' : `读了 ${readCount} / ${total} 节`}</strong>
      <div className="nr-finish-actions">
        <button type="button" onClick={onRestart}>
          <RotateCcw size={15} />
          从头
        </button>
        <button type="button" className="is-primary" onClick={onClose}>
          <CheckCircle2 size={15} />
          合上
        </button>
      </div>
    </div>
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
            {problemTypeLabel(document.problem.type)}
          </span>
          <span>
            <img
              className="local-problem-difficulty"
              src={marbleImages[DIFFICULTY_MARBLES[document.problem.difficulty] ?? 'blue']}
              alt=""
            />
            {difficultyLabel(document.problem.difficulty)}
          </span>
          {progress ? (
            <span className={progress.status === 'passed' ? 'local-progress-passed' : ''}>
              <CheckCircle2 size={14} />
              {PROGRESS_STATUS_LABELS[progress.status] ?? progress.status} · 已作答{' '}
              {progress.attemptedCount} 次
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

export function LocalResourceViewer({
  resource,
  notebooks,
  accent = 'blue',
  onClose,
}: LocalResourceViewerProps) {
  const title = resource.kind === 'notebook' ? resource.document.notebook.name : '本地题目';
  // 手机/窄窗口里页面上面还有一条「返回 + 页面名」，阅读器要整页盖住它，
  // 所以挂到最近的课程工作区上；宽屏照旧只盖住右侧内容区。
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const mountAnchor = useCallback((anchor: HTMLSpanElement | null) => {
    const host = anchor?.closest<HTMLElement>('.course-workspace.is-compact');
    setPortalHost(host && !anchor?.parentElement?.isSameNode(host) ? host : null);
  }, []);

  // 笔记本是推进来的一整页（iPad/桌面上只盖住右侧区域）；题目仍然用弹窗。
  if (resource.kind === 'notebook') {
    const layer = (
      <div className="nr-layer">
        <NotebookViewer
          key={resource.document.notebook.id}
          document={resource.document}
          variants={notebookVariants(
            notebooks ?? [resource.document.notebook],
            resource.document.notebook.id,
          )}
          accent={accent}
          onClose={onClose}
        />
      </div>
    );
    return (
      <>
        <span ref={mountAnchor} hidden />
        {portalHost ? createPortal(layer, portalHost) : layer}
      </>
    );
  }

  return (
    <NativeWorkspaceDialog open onClose={onClose} title={title} description="本机题目阅读器">
      <ProblemViewer document={resource.document} onClose={onClose} />
    </NativeWorkspaceDialog>
  );
}
