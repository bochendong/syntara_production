import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { Check, FileQuestion, NotebookPen, RotateCcw, X } from 'lucide-react';
import type { LocalNotebook, LocalProblem } from '../domain/models';
import { DIFFICULTY_MARBLES, marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import { LearningEmptyState } from './LearningEmptyState';
import { completeOnboardingStep } from '../lib/onboarding';
import './materials-page.css';

export type CourseMaterialKind = 'notes' | 'problems';

const kinds = {
  notes: { label: '笔记', Icon: NotebookPen, tone: 'blue', marble: marbleImages.blue },
  problems: { label: '题目', Icon: FileQuestion, tone: 'pink', marble: marbleImages.pink },
} as const;

const ACCEPT = '.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,text/*';
/** 笔记的弹珠颜色轮流换，和笔记列表一致。 */
const NOTEBOOK_COLORS: MarbleColor[] = ['blue', 'purple', 'pink', 'green', 'amber'];
/** 整理太快时也让「整理中」停留片刻，免得一闪而过看不清。 */
const MIN_ORGANIZE_MS = 1100;
const DONE_LINGER_MS = 1400;

type QueueItem = {
  key: string;
  kind: CourseMaterialKind;
  name: string;
  state: 'organizing' | 'done' | 'failed';
  message?: string;
  file: File;
};

const ALL_KINDS: CourseMaterialKind[] = ['notes', 'problems'];

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * 资料页：上面是投放台（拖进来，或点笔记 / 题目选文件），
 * 中间是「整理中」的队列，下面是已经整理好的资料架。
 * 手机上没有题库，kinds 只传笔记。
 */
export function CourseMaterialsPage({
  notebooks,
  problems,
  onImport,
  onImported,
  onOpenNotes,
  onOpenProblems,
  kinds: allowedKinds = ALL_KINDS,
}: {
  notebooks: Pick<LocalNotebook, 'id' | 'name' | 'sectionCount' | 'updatedAt'>[];
  problems: Pick<LocalProblem, 'id' | 'difficulty'>[];
  onImport: (kind: CourseMaterialKind, file: File) => Promise<void>;
  onImported: () => Promise<void> | void;
  onOpenNotes: () => void;
  onOpenProblems: () => void;
  kinds?: CourseMaterialKind[];
}) {
  // 触屏上拖不了文件，提示改成点一下选。
  const [canDrag] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(pointer: fine)').matches,
  );
  const withProblems = allowedKinds.includes('problems');
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<CourseMaterialKind | null>(null);
  const [swallow, setSwallow] = useState(0);
  const [missed, setMissed] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pickKind = useRef<CourseMaterialKind>('notes');
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const known = useRef(new Set(notebooks.map((notebook) => notebook.id)));
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  // 新整理好的笔记在资料架上亮一下。
  useEffect(() => {
    const added = notebooks.filter((notebook) => !known.current.has(notebook.id));
    if (!added.length) return;
    added.forEach((notebook) => known.current.add(notebook.id));
    setFresh((current) => new Set([...current, ...added.map((notebook) => notebook.id)]));
    const timer = window.setTimeout(() => setFresh(new Set()), 2600);
    return () => window.clearTimeout(timer);
  }, [notebooks]);

  const patch = useCallback(
    (key: string, next: Partial<QueueItem>) =>
      setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item))),
    [],
  );

  const run = useCallback(
    async (items: QueueItem[]) => {
      let imported = 0;
      for (const item of items) {
        const started = Date.now();
        try {
          await onImport(item.kind, item.file);
          await wait(Math.max(0, MIN_ORGANIZE_MS - (Date.now() - started)));
          patch(item.key, { state: 'done' });
          imported += 1;
        } catch (cause) {
          await wait(Math.max(0, 600 - (Date.now() - started)));
          patch(item.key, {
            state: 'failed',
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
      if (imported) {
        completeOnboardingStep('materials');
        await onImported();
      }
      await wait(DONE_LINGER_MS);
      const batch = new Set(items.map((item) => item.key));
      setQueue((current) =>
        current.filter((item) => !(batch.has(item.key) && item.state === 'done')),
      );
    },
    [onImport, onImported, patch],
  );

  const accept = (kind: CourseMaterialKind, files: File[]) => {
    if (!files.length) return;
    setSwallow((count) => count + 1);
    const items = files.map<QueueItem>((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      kind,
      name: file.name,
      state: 'organizing',
      file,
    }));
    setQueue((current) => [...items, ...current]);
    void run(items);
  };

  const retry = (item: QueueItem) => {
    patch(item.key, { state: 'organizing', message: undefined });
    void run([{ ...item, state: 'organizing' }]);
  };

  const pick = (kind: CourseMaterialKind) => {
    pickKind.current = kind;
    inputRef.current?.click();
  };

  const stageDrag = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) {
        setDragging(false);
        setOver(null);
      }
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const kind = over;
      setOver(null);
      // 只有落在「笔记」或「题目」上才收；落在别处就让两块晃一下提示。
      if (!kind) {
        setMissed((count) => count + 1);
        return;
      }
      accept(kind, Array.from(event.dataTransfer.files));
    },
  };

  const difficultyCounts = (['easy', 'medium', 'hard'] as const).map((difficulty) => ({
    difficulty,
    count: problems.filter((problem) => problem.difficulty === difficulty).length,
  }));
  const busyCount = queue.filter((item) => item.state === 'organizing').length;

  return (
    <div className="mt-page" {...stageDrag}>
      <div className="mt-aurora" aria-hidden>
        <i />
        <i />
      </div>

      <section
        className={['mt-basin', dragging ? 'is-dragging' : '', busyCount ? 'is-busy' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="上传资料"
        data-onboarding="materials-drop"
      >
        <div className="mt-basin-core" aria-hidden>
          <span className="mt-halo" />
          <span className="mt-halo mt-halo-2" />
          <img
            key={swallow}
            className={swallow ? 'mt-core-marble is-swallow' : 'mt-core-marble'}
            src={marbleImages.purple}
            alt=""
          />
        </div>
        <p className="mt-basin-title">
          {dragging
            ? withProblems
              ? '放到笔记或题目上'
              : '放到笔记上'
            : canDrag
              ? '把资料拖进来'
              : '点一下，选文件'}
        </p>
        <div key={missed} className={missed ? 'mt-pads is-missed' : 'mt-pads'}>
          {allowedKinds.map((kind) => {
            const { label, Icon, tone, marble } = kinds[kind];
            return (
              <button
                type="button"
                key={kind}
                className={over === kind ? 'mt-pad is-over' : 'mt-pad'}
                data-tone={tone}
                onClick={() => pick(kind)}
                onDragEnter={() => setOver(kind)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setOver((current) => (current === kind ? null : current));
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (over !== kind) setOver(kind);
                }}
              >
                <img src={marble} alt="" aria-hidden />
                <Icon size={16} strokeWidth={2} aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <small className="mt-basin-hint">TXT · Markdown · CSV · 代码</small>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            accept(pickKind.current, files);
          }}
        />
      </section>

      {queue.length ? (
        <section className="mt-queue" aria-label="整理中" aria-live="polite">
          {queue.map((item) => {
            const { tone, marble, label } = kinds[item.kind];
            return (
              <div key={item.key} className={`mt-job is-${item.state}`} data-tone={tone}>
                <span className="mt-job-marble" aria-hidden>
                  <img src={marble} alt="" />
                </span>
                <span className="mt-job-text">
                  <strong>{item.name}</strong>
                  <small>
                    {item.state === 'organizing'
                      ? `整理成${label}`
                      : item.state === 'done'
                        ? '整理好了'
                        : item.message || '没能整理'}
                  </small>
                </span>
                <span className="mt-job-state" aria-hidden>
                  {item.state === 'done' ? <Check size={15} strokeWidth={2.4} /> : null}
                  {item.state === 'failed' ? <X size={15} strokeWidth={2.4} /> : null}
                </span>
                {item.state === 'failed' ? (
                  <span className="mt-job-actions">
                    <button type="button" onClick={() => retry(item)} aria-label="重试">
                      <RotateCcw size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQueue((items) => items.filter((entry) => entry.key !== item.key))
                      }
                      aria-label="移除"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ) : null}
                <span className="mt-job-sheen" aria-hidden />
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="mt-shelf" aria-label="已整理的资料">
        <button type="button" className="mt-shelf-card" data-tone="blue" onClick={onOpenNotes}>
          <header>
            <NotebookPen size={16} strokeWidth={2} aria-hidden />
            <strong>笔记</strong>
            <em>{notebooks.length}</em>
          </header>
          {notebooks.length ? (
            <ul>
              {notebooks.slice(0, 4).map((notebook, index) => (
                <li
                  key={notebook.id}
                  className={fresh.has(notebook.id) ? 'is-fresh' : undefined}
                  style={{ '--i': index } as CSSProperties}
                >
                  <img
                    src={marbleImages[NOTEBOOK_COLORS[index % NOTEBOOK_COLORS.length]]}
                    alt=""
                    aria-hidden
                  />
                  <span>{notebook.name}</span>
                  {notebook.sectionCount ? <small>{notebook.sectionCount} 节</small> : null}
                </li>
              ))}
              {notebooks.length > 4 ? (
                <li className="mt-more">还有 {notebooks.length - 4} 本</li>
              ) : null}
            </ul>
          ) : (
            <LearningEmptyState title="还没有笔记" compact />
          )}
        </button>

        {withProblems ? (
          <button type="button" className="mt-shelf-card" data-tone="pink" onClick={onOpenProblems}>
            <header>
              <FileQuestion size={16} strokeWidth={2} aria-hidden />
              <strong>题目</strong>
              <em>{problems.length}</em>
            </header>
            {problems.length ? (
              <div className="mt-difficulty">
                {difficultyCounts.map(({ difficulty, count }, index) => (
                  <span key={difficulty} style={{ '--i': index } as CSSProperties}>
                    <img src={marbleImages[DIFFICULTY_MARBLES[difficulty]]} alt="" aria-hidden />
                    <b>{count}</b>
                    <small>
                      {difficulty === 'easy' ? '基础' : difficulty === 'medium' ? '进阶' : '挑战'}
                    </small>
                  </span>
                ))}
              </div>
            ) : (
              <LearningEmptyState title="还没有题目" compact />
            )}
          </button>
        ) : null}
      </section>
    </div>
  );
}
