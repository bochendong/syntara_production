import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  HandwritingDocumentInput,
  type HandwritingPageEditorProps,
} from './handwriting-document-input';
import { useFloatingInkToolbar } from './use-floating-ink-toolbar';
import { useInkViewport } from './use-ink-viewport';
import { useInkGlass } from './use-ink-glass';
import { MIN_INK_ZOOM, MAX_INK_ZOOM } from '../../lib/ink-viewport';
import {
  GripVertical,
  Eraser,
  Redo2,
  Undo2,
  PenLine,
  Highlighter,
  Minus,
  Plus,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import {
  drawInkSegment,
  drawHighlighterStroke,
  inkPoint,
  INK_HEIGHT,
  INK_WIDTH,
  MAX_INK_POINTS,
  redrawInk,
  type HandwritingDocument,
  type HandwritingPage,
  type InkStroke,
} from '../../data/handwriting-draft';
import { INK_PALETTE, DEFAULT_INK_COLOR, type InkColor } from '../../lib/ink-palette';
import { marbleImages } from '../../lib/learning-action-marbles';
import marblePen from '../../assets/handwriting/marble-pen.webp?url';
import './handwriting-answer-input.css';

type Props = {
  draftKey: string;
  headerContainerId?: string;
  disabled: boolean;
  handwriting?: boolean;
  children?: ReactNode;
  onHandwritingChange: (document: HandwritingDocument) => void;
};

export function HandwritingAnswerInput({ children, handwriting = false, ...props }: Props) {
  return (
    <section
      className="ink-answer-editor"
      aria-label="作答方式"
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <div hidden={handwriting} className="ink-text-slot">
        {children}
      </div>
      {handwriting ? (
        <div className="ink-panel-slot">
          <HandwritingDocumentInput {...props} PageEditor={HandwritingPanel} />
        </div>
      ) : null}
    </section>
  );
}

function HandwritingPanel({
  page,
  redoStrokes,
  disabled,
  onPageChange,
  onWritingChange,
  writing,
}: HandwritingPageEditorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const eraserCursor = useRef<HTMLDivElement>(null);
  const eraserPosition = useRef<{ x: number; y: number } | null>(null);
  const paintedPage = useRef<string | null>(null);
  const {
    panelRef,
    toolbarRef,
    corner: toolbarCorner,
    dragging: toolbarDragging,
    style: toolbarStyle,
    handleProps,
    collapsed,
    setCollapsed,
    consumeDragClick,
  } = useFloatingInkToolbar();
  const { glassRef, refreshGlass } = useInkGlass({ toolbarRef, paperRef: canvas, collapsed });
  const [initialPage] = useState(() => structuredClone(page));
  const [initialRedo] = useState(() => structuredClone(redoStrokes));
  const draft = useRef<HandwritingPage>(initialPage);
  const active = useRef<{
    pointerId: number;
    stroke: InkStroke;
    previousRedo: InkStroke[];
    snapshot?: HTMLCanvasElement;
  } | null>(null);
  const redo = useRef<InkStroke[]>(initialRedo);
  const [initialPointCount] = useState(() =>
    initialPage.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
  );
  const points = useRef(initialPointCount);
  const change = useRef(onPageChange);
  useEffect(() => {
    change.current = onPageChange;
  }, [onPageChange]);
  const historySize = { undo: page.strokes.length, redo: redoStrokes.length };
  const [tool, setTool] = useState<InkStroke['tool']>('pen');
  const [width, setWidth] = useState(3);
  const [color, setColor] = useState<InkColor>(DEFAULT_INK_COLOR);
  const marbleButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const focusToolbar = useRef(false);
  const toggleCollapsed = (value: boolean) => {
    focusToolbar.current = true;
    setCollapsed(value);
  };
  useLayoutEffect(() => {
    if (!focusToolbar.current) return;
    (collapsed ? marbleButtonRef.current : collapseButtonRef.current)?.focus({
      preventScroll: true,
    });
    focusToolbar.current = false;
  }, [collapsed]);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      // A layout change can unmount the page before the pen's pointerup arrives.
      if (!active.current) return;
      active.current = null;
      change.current(structuredClone(draft.current), structuredClone(redo.current));
    },
    [],
  );
  useLayoutEffect(() => {
    if (paintedPage.current === page.imageId) return;
    if (draft.current.imageId !== page.imageId) {
      draft.current = structuredClone(page);
      redo.current = structuredClone(redoStrokes);
      points.current = page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    }
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.setTransform(2, 0, 0, 2, 0, 0);
    redrawInk(context, draft.current.strokes);
    paintedPage.current = page.imageId;
    refreshGlass();
  }, [page, redoStrokes, refreshGlass]);

  const persist = () => {
    const snapshot = structuredClone(draft.current);
    change.current(snapshot, structuredClone(redo.current));
  };
  const redraw = () => {
    const context = canvas.current?.getContext('2d');
    if (context) redrawInk(context, draft.current.strokes);
    points.current = draft.current.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    persist();
    refreshGlass();
  };
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (active.current?.pointerId !== event.pointerId) return;
    active.current = null;
    onWritingChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    persist();
    refreshGlass();
  };
  const pointOf = (event: { clientX: number; clientY: number; pressure: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return inkPoint(
      ((event.clientX - rect.left) / rect.width) * INK_WIDTH,
      ((event.clientY - rect.top) / rect.height) * INK_HEIGHT,
      event.pressure,
    );
  };
  const { areaRef, zoom, paperStyle, zoomBy, resetView, navigationProps } = useInkViewport({
    disabled,
    penIsDrawing: () => !!active.current,
  });
  const updateEraserCursor = () => {
    const cursor = eraserCursor.current;
    const area = areaRef.current;
    const paper = canvas.current;
    const position = eraserPosition.current;
    if (!cursor || !area || !paper) return;
    if (!position || tool !== 'eraser' || disabled) {
      cursor.hidden = true;
      return;
    }
    const bounds = paper.getBoundingClientRect();
    const viewport = area.getBoundingClientRect();
    if (
      position.x < bounds.left ||
      position.x > bounds.right ||
      position.y < bounds.top ||
      position.y > bounds.bottom ||
      position.x < viewport.left ||
      position.x > viewport.right ||
      position.y < viewport.top ||
      position.y > viewport.bottom
    ) {
      cursor.hidden = true;
      return;
    }
    const diameter = ((width * 10) / INK_WIDTH) * bounds.width;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.left = `${position.x - viewport.left}px`;
    cursor.style.top = `${position.y - viewport.top}px`;
    cursor.hidden = false;
  };
  useLayoutEffect(() => {
    updateEraserCursor();
  });
  const trackEraserCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') return;
    eraserPosition.current = { x: event.clientX, y: event.clientY };
    updateEraserCursor();
  };
  return (
    <section
      ref={panelRef}
      className="ink-panel"
      aria-label="手写作答面板"
      onKeyDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <fieldset
        ref={toolbarRef}
        className={`ink-tools ${toolbarDragging ? 'is-dragging' : ''} ${collapsed ? 'is-collapsed' : ''}`}
        style={toolbarStyle}
        data-corner={toolbarCorner}
        disabled={disabled}
        aria-label={collapsed ? '手写工具（已收起）' : '手写工具'}
      >
        <canvas
          ref={glassRef}
          className="ink-glass-surface"
          aria-hidden="true"
          hidden={collapsed}
        />
        <button
          ref={marbleButtonRef}
          type="button"
          className="ink-marble-button"
          hidden={!collapsed}
          aria-label="展开手写工具栏"
          aria-expanded={false}
          title="点击展开；拖动移动；方向键吸附四角"
          {...handleProps}
          onClick={(event) => {
            if (!consumeDragClick(event)) toggleCollapsed(false);
          }}
        >
          <img src={marblePen} alt="" draggable={false} />
        </button>
        {!collapsed ? (
          <>
            <button
              type="button"
              className="ink-toolbar-grip"
              aria-label="拖动手写工具栏"
              title="拖动后吸附到四角，也可用方向键调整"
              {...handleProps}
            >
              <GripVertical size={18} />
            </button>
            <div className="ink-tool-group ink-drawing-tools" role="group" aria-label="绘图工具">
              <button
                type="button"
                className="ink-icon-button"
                aria-label="笔"
                title="笔"
                aria-pressed={tool === 'pen'}
                onClick={() => {
                  setTool('pen');
                }}
              >
                <PenLine size={23} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                className="ink-icon-button"
                aria-label="荧光笔"
                title="荧光笔"
                aria-pressed={tool === 'highlighter'}
                onClick={() => setTool('highlighter')}
              >
                <Highlighter size={22} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                className="ink-icon-button"
                aria-label="橡皮"
                title="橡皮"
                aria-pressed={tool === 'eraser'}
                onClick={() => {
                  setTool('eraser');
                }}
              >
                <Eraser size={22} strokeWidth={1.7} />
              </button>
            </div>
            <div className="ink-tool-group ink-width-presets" role="group" aria-label="笔画粗细">
              {(
                [
                  { value: 2, label: '细', stroke: 1.25 },
                  { value: 3, label: '中', stroke: 2.5 },
                  { value: 5, label: '粗', stroke: 4 },
                ] as const
              ).map((preset) => (
                <button
                  type="button"
                  key={preset.value}
                  className="ink-width-button"
                  aria-label={`${preset.label}笔画`}
                  title={`${preset.label}笔画`}
                  aria-pressed={width === preset.value}
                  onClick={() => {
                    setWidth(preset.value);
                  }}
                >
                  <Minus size={23} strokeWidth={preset.stroke} />
                </button>
              ))}
            </div>
            <div className="ink-tool-group ink-color-palette" role="group" aria-label="墨水颜色">
              {INK_PALETTE.map((ink) => (
                <button
                  type="button"
                  key={ink.id}
                  className={`ink-color-button is-${ink.id}`}
                  aria-label={`${ink.label}墨水`}
                  title={`${ink.label}墨水`}
                  aria-pressed={color === ink.color}
                  onClick={() => {
                    setColor(ink.color);
                    if (tool === 'eraser') setTool('pen');
                  }}
                >
                  <img
                    className="ink-color-bead"
                    src={marbleImages[ink.marble]}
                    alt=""
                    draggable={false}
                  />
                </button>
              ))}
            </div>
            <div className="ink-tool-group ink-toolbar-actions">
              <button
                type="button"
                className="ink-icon-button ink-undo"
                aria-label="撤销笔画"
                title="撤销"
                disabled={!historySize.undo}
                onClick={() => {
                  const stroke = draft.current.strokes.pop();
                  if (stroke) redo.current.push(stroke);
                  redraw();
                }}
              >
                <Undo2 size={22} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                className="ink-icon-button"
                aria-label="重做笔画"
                title="重做"
                disabled={!historySize.redo}
                onClick={() => {
                  const stroke = redo.current.pop();
                  if (stroke) draft.current.strokes.push(stroke);
                  redraw();
                }}
              >
                <Redo2 size={22} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                className="ink-icon-button ink-clear-page"
                aria-label="清空当前页笔迹"
                title="清空当前页笔迹"
                disabled={writing || !historySize.undo}
                onClick={() => {
                  redo.current.push(...[...draft.current.strokes].reverse());
                  draft.current.strokes = [];
                  redraw();
                }}
              >
                <Trash2 size={21} strokeWidth={1.7} />
              </button>
              <button
                ref={collapseButtonRef}
                type="button"
                className="ink-icon-button"
                aria-label="收起手写工具栏"
                aria-expanded={true}
                title="收起工具栏"
                onClick={() => toggleCollapsed(true)}
              >
                <ChevronDown size={20} strokeWidth={1.7} />
              </button>
            </div>
          </>
        ) : null}
      </fieldset>
      <div
        ref={areaRef}
        className="ink-paper-area"
        role="region"
        aria-label="可缩放手写画布，双指缩放，单指移动"
        tabIndex={0}
        {...navigationProps}
      >
        <canvas
          ref={canvas}
          width={INK_WIDTH * 2}
          height={INK_HEIGHT * 2}
          className={`ink-paper${tool === 'eraser' ? ' is-erasing' : ''}`}
          style={paperStyle}
          aria-label="手写画布"
          onPointerEnter={trackEraserCursor}
          onPointerLeave={() => {
            eraserPosition.current = null;
            updateEraserCursor();
          }}
          onPointerDown={(event) => {
            trackEraserCursor(event);
            if (disabled || active.current || event.button !== 0 || event.pointerType === 'touch')
              return;
            if (points.current >= MAX_INK_POINTS) {
              setError('这一页的笔迹已达到上限，请清理部分笔迹后继续。');
              return;
            }
            event.preventDefault();
            setError('');
            const context = event.currentTarget.getContext('2d');
            if (!context) {
              setError('浏览器无法打开画布。');
              return;
            }
            const point = pointOf(event);
            let snapshot: HTMLCanvasElement | undefined;
            if (tool === 'highlighter') {
              const copy = document.createElement('canvas');
              copy.width = event.currentTarget.width;
              copy.height = event.currentTarget.height;
              const copyContext = copy.getContext('2d');
              if (copyContext) {
                copyContext.drawImage(event.currentTarget, 0, 0);
                snapshot = copy;
              }
            }
            const stroke: InkStroke = {
              tool,
              color,
              width: tool === 'eraser' ? width * 10 : tool === 'highlighter' ? width * 6 : width,
              points: [point],
            };
            draft.current.strokes.push(stroke);
            points.current++;
            active.current = {
              pointerId: event.pointerId,
              stroke,
              previousRedo: redo.current,
              snapshot,
            };
            redo.current = [];
            onWritingChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            if (tool === 'highlighter') drawHighlighterStroke(context, stroke);
            else drawInkSegment(context, stroke, point, point);
            refreshGlass(event);
          }}
          onPointerMove={(event) => {
            trackEraserCursor(event);
            const current = active.current;
            if (!current || current.pointerId !== event.pointerId) return;
            event.preventDefault();
            const context = event.currentTarget.getContext('2d');
            if (!context) return;
            const samples =
              typeof event.nativeEvent.getCoalescedEvents === 'function'
                ? event.nativeEvent.getCoalescedEvents()
                : [];
            for (const sample of samples.length ? samples : [event.nativeEvent]) {
              if (points.current >= MAX_INK_POINTS) break;
              const point = pointOf(sample);
              const previous = current.stroke.points[current.stroke.points.length - 1];
              if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) continue;
              current.stroke.points.push(point);
              points.current++;
              if (current.stroke.tool !== 'highlighter')
                drawInkSegment(context, current.stroke, previous, point);
            }
            if (current.stroke.tool === 'highlighter') {
              if (current.snapshot) {
                context.save();
                context.globalCompositeOperation = 'source-over';
                context.globalAlpha = 1;
                context.clearRect(0, 0, INK_WIDTH, INK_HEIGHT);
                context.drawImage(current.snapshot, 0, 0, INK_WIDTH, INK_HEIGHT);
                drawHighlighterStroke(context, current.stroke);
                context.restore();
              } else {
                redrawInk(context, draft.current.strokes);
              }
            }
            refreshGlass(event);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        />
        <div ref={eraserCursor} className="ink-eraser-cursor" aria-hidden="true" hidden />
      </div>
      <fieldset
        className={`ink-view-controls ${toolbarCorner.startsWith('bottom') ? 'at-top' : 'at-bottom'}`}
        aria-label="画布视图"
        disabled={disabled}
      >
        <button
          type="button"
          aria-label="缩小画布"
          title="缩小画布"
          disabled={zoom <= MIN_INK_ZOOM}
          onClick={() => zoomBy(1 / 1.25)}
        >
          <Minus size={18} />
        </button>
        <button
          type="button"
          className="ink-zoom-reset"
          aria-label={`缩放 ${Math.round(zoom * 100)}%，点击适合宽度`}
          title="适合宽度"
          onClick={resetView}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="放大画布"
          title="放大画布"
          disabled={zoom >= MAX_INK_ZOOM}
          onClick={() => zoomBy(1.25)}
        >
          <Plus size={18} />
        </button>
      </fieldset>
      {error ? (
        <p role="alert" className="native-problem-practice-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
