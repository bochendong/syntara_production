import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';

import type {
  MiniLectureRegion,
  PersistedMiniLectureDeck,
  RuntimeMiniLectureDeck,
  RuntimeMiniLecturePage,
  RuntimeMiniLectureSpeechAction,
} from '../domain/learning-experiences';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';

export type MiniLectureGenerationState = {
  status: 'idle' | 'queued' | 'running' | 'failed';
  step?: string;
  progress?: number;
  error?: string;
};

const GENERATION_STEP_LABELS: Record<string, string> = {
  planning: '正在规划 1–2 页课堂结构',
  image_generation: 'Image2 正在绘制讲解图片',
  marker_recovery: '正在恢复讲解区域与遮罩',
  narration: '正在生成逐段课堂讲稿',
  tts: 'OpenAI 正在生成课堂语音',
  packaging: '正在保存到本机',
};

const MINI_LECTURE_PLAYBACK_RATE_STORAGE_KEY = 'syntara.native.mini-lecture.playback-rate';
const MINI_LECTURE_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

function readStoredPlaybackRate(): number {
  if (typeof window === 'undefined') return 1;
  const stored = Number(window.localStorage.getItem(MINI_LECTURE_PLAYBACK_RATE_STORAGE_KEY));
  return MINI_LECTURE_PLAYBACK_RATES.includes(
    stored as (typeof MINI_LECTURE_PLAYBACK_RATES)[number],
  )
    ? stored
    : 1;
}

export function MiniLectureGenerateCard({
  state,
  disabled = false,
  unavailableReason,
  onGenerate,
}: {
  state: MiniLectureGenerationState;
  disabled?: boolean;
  unavailableReason?: string;
  onGenerate: () => void;
}) {
  const running = state.status === 'queued' || state.status === 'running';
  const unavailable = disabled && !running;
  const label = unavailable
    ? '登录后生成'
    : state.status === 'failed'
      ? '重新生成'
      : running
        ? '生成中…'
        : '生成课堂讲解';
  return (
    <section
      className={`mini-lecture-invite mini-lecture-generate ${state.status === 'failed' ? 'is-failed' : ''}`}
      aria-label="生成课堂讲解"
    >
      <span className="mini-lecture-invite-icon">
        {state.status === 'failed' ? (
          <AlertCircle size={18} />
        ) : (
          <Sparkles size={18} strokeWidth={1.8} />
        )}
      </span>
      <span className="mini-lecture-invite-copy">
        <strong>
          {running
            ? (GENERATION_STEP_LABELS[state.step ?? ''] ?? '正在生成课堂讲解')
            : unavailable
              ? '课堂讲解等待平台授权'
              : state.status === 'failed'
                ? '课堂讲解生成失败'
                : '把这段回答变成课堂讲解'}
        </strong>
        <small>
          {state.error ??
            (unavailable
              ? unavailableReason || '完成 App 登录后即可生成'
              : '用 GPT Image 2 生成图片，恢复遮罩区域，再配 OpenAI 课堂语音')}
        </small>
        {running && typeof state.progress === 'number' ? (
          <span
            className="mini-lecture-generation-progress"
            style={
              {
                '--lecture-progress': `${Math.max(4, state.progress ?? 8)}%`,
              } as React.CSSProperties
            }
          />
        ) : null}
      </span>
      <span className="mini-lecture-page-count">
        {running
          ? typeof state.progress === 'number'
            ? `${state.progress}%`
            : '处理中'
          : '1–2 页'}
      </span>
      <button type="button" onClick={onGenerate} disabled={running || unavailable}>
        {running ? (
          <Loader2 size={13} className="spin-icon" />
        ) : state.status === 'failed' ? (
          <RefreshCw size={13} />
        ) : (
          <Play size={13} fill="currentColor" />
        )}
        {label}
      </button>
    </section>
  );
}

export function MiniLectureInviteCard({
  deck,
  busy = false,
  onOpen,
}: {
  deck: PersistedMiniLectureDeck;
  busy?: boolean;
  onOpen: () => void;
}) {
  return (
    <section className="mini-lecture-invite" aria-label="已生成的课堂讲解">
      <span className="mini-lecture-invite-icon">
        <BookOpenCheck size={18} strokeWidth={1.8} />
      </span>
      <span className="mini-lecture-invite-copy">
        <strong>{deck.title}</strong>
        <small>课堂讲解已生成 · GPT Image 2 图片、OpenAI 语音与动态聚焦</small>
      </span>
      <span className="mini-lecture-page-count">已就绪</span>
      <button type="button" onClick={onOpen} disabled={busy}>
        {busy ? (
          <Loader2 size={13} className="spin-icon" />
        ) : (
          <Play size={13} fill="currentColor" />
        )}
        {busy ? '正在打开…' : '查看讲解'}
      </button>
    </section>
  );
}

function regionStyle(region: MiniLectureRegion, page: RuntimeMiniLecturePage) {
  const [left, top, width, height] = region.bbox;
  return {
    left: `${(left / page.width) * 100}%`,
    top: `${(top / page.height) * 100}%`,
    width: `${(width / page.width) * 100}%`,
    height: `${(height / page.height) * 100}%`,
  };
}

type SpeechSegment = {
  action: RuntimeMiniLectureSpeechAction;
  actionIndex: number;
  region: MiniLectureRegion | null;
};

function pageSpeechSegments(page: RuntimeMiniLecturePage): SpeechSegment[] {
  return page.actions.flatMap((action, actionIndex) => {
    if (action.type !== 'speech') return [];
    return [
      {
        action,
        actionIndex,
        region: page.regions.find((region) => region.id === action.regionId) || null,
      },
    ];
  });
}

export function MiniLectureClassroom({
  deck,
  onClose,
}: {
  deck: RuntimeMiniLectureDeck | null;
  onClose: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [speechText, setSpeechText] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [playbackRate, setPlaybackRate] = useState(readStoredPlaybackRate);
  const playbackIdRef = useRef(0);
  const playbackRateRef = useRef(playbackRate);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioActionIdRef = useRef<string | null>(null);

  const page = deck?.pages[pageIndex] || null;
  const activeRegion = page?.regions.find((region) => region.id === activeRegionId) || null;
  const speechSegments = useMemo(() => (page ? pageSpeechSegments(page) : []), [page]);
  const activeDimOpacity = useMemo(() => {
    if (!page || !activeRegionId) return 0.68;
    for (let index = Math.min(actionIndex, page.actions.length - 1); index >= 0; index -= 1) {
      const action = page.actions[index];
      if (action.type === 'spotlight' && action.regionId === activeRegionId) {
        return Number.isFinite(action.dimOpacity)
          ? Math.min(0.96, Math.max(0, action.dimOpacity))
          : 0.68;
      }
    }
    return 0.68;
  }, [actionIndex, activeRegionId, page]);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audioRef.current = null;
    audioActionIdRef.current = null;
  }, []);

  const stop = useCallback(() => {
    playbackIdRef.current += 1;
    releaseAudio();
    setPlaying(false);
  }, [releaseAudio]);

  const pause = useCallback(() => {
    playbackIdRef.current += 1;
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const clearFocus = useCallback(() => {
    stop();
    setHasStartedPlayback(false);
    setActiveRegionId(null);
    setSpeechText('');
    setPlaybackError('');
  }, [stop]);

  const goToPage = useCallback(
    (nextPage: number) => {
      stop();
      setPageIndex(nextPage);
      setActionIndex(0);
      setHasStartedPlayback(false);
      setActiveRegionId(null);
      setSpeechText('');
      setPlaybackError('');
    },
    [stop],
  );

  const startOrResumePagePlayback = useCallback(() => {
    playbackIdRef.current += 1;
    if (page && actionIndex >= page.actions.length) {
      releaseAudio();
      setActionIndex(0);
      setActiveRegionId(null);
      setSpeechText('');
    }
    setPlaybackError('');
    setHasStartedPlayback(true);
    setPlaying(true);
  }, [actionIndex, page, releaseAudio]);

  const changePlaybackRate = useCallback((nextRate: number) => {
    if (
      !MINI_LECTURE_PLAYBACK_RATES.includes(
        nextRate as (typeof MINI_LECTURE_PLAYBACK_RATES)[number],
      )
    ) {
      return;
    }
    playbackRateRef.current = nextRate;
    setPlaybackRate(nextRate);
    window.localStorage.setItem(MINI_LECTURE_PLAYBACK_RATE_STORAGE_KEY, String(nextRate));
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = nextRate;
      audio.playbackRate = nextRate;
    }
  }, []);

  useEffect(() => {
    if (!playing || !deck || !page) return;
    const action = page.actions[actionIndex];
    const playbackId = playbackIdRef.current;

    if (!action) {
      const finishFrame = window.setTimeout(() => {
        if (playbackId !== playbackIdRef.current) return;
        if (pageIndex < deck.pages.length - 1) {
          setPageIndex((current) => current + 1);
          setActionIndex(0);
          setHasStartedPlayback(false);
          setActiveRegionId(null);
          setSpeechText('');
        } else {
          releaseAudio();
          setPlaying(false);
        }
      }, 0);
      return () => window.clearTimeout(finishFrame);
    }

    if (action.type === 'spotlight') {
      const focusFrame = window.setTimeout(() => {
        if (playbackId !== playbackIdRef.current) return;
        setActiveRegionId(action.regionId);
        setPlaybackError('');
      }, 0);
      const advanceFrame = window.setTimeout(() => {
        if (playbackId === playbackIdRef.current) {
          setActionIndex((current) => current + 1);
        }
      }, 60);
      return () => {
        window.clearTimeout(focusFrame);
        window.clearTimeout(advanceFrame);
      };
    }

    const captionFrame = window.setTimeout(() => {
      if (playbackId !== playbackIdRef.current) return;
      setActiveRegionId(action.regionId);
      setSpeechText(action.text);
      setPlaybackError('');
    }, 0);

    if (!action.audioUrl) {
      const errorFrame = window.setTimeout(() => {
        if (playbackId !== playbackIdRef.current) return;
        setPlaybackError('这段 OpenAI 语音尚未生成，请重新生成课堂讲解。');
        setPlaying(false);
      }, 0);
      return () => {
        window.clearTimeout(captionFrame);
        window.clearTimeout(errorFrame);
      };
    }

    let audio = audioRef.current;
    if (audio && audioActionIdRef.current !== action.id) {
      releaseAudio();
      audio = null;
    }
    if (!audio) {
      audio = new Audio(action.audioUrl);
      audio.preload = 'auto';
      audioRef.current = audio;
      audioActionIdRef.current = action.id;
    }
    audio.defaultPlaybackRate = playbackRateRef.current;
    audio.playbackRate = playbackRateRef.current;
    audio.preservesPitch = true;
    audio.onended = () => {
      if (playbackId !== playbackIdRef.current) return;
      if (audioRef.current === audio) {
        audioRef.current = null;
        audioActionIdRef.current = null;
      }
      setActionIndex((current) => current + 1);
    };
    audio.onerror = () => {
      if (playbackId !== playbackIdRef.current) return;
      if (audioRef.current === audio) {
        audioRef.current = null;
        audioActionIdRef.current = null;
      }
      setPlaybackError('OpenAI 语音资源加载失败，请检查资源后重试。');
      setPlaying(false);
    };
    void audio.play().catch((error: unknown) => {
      if (playbackId !== playbackIdRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setPlaybackError(`无法播放 OpenAI 语音：${message}`);
      setPlaying(false);
    });

    return () => {
      window.clearTimeout(captionFrame);
      audio.onended = null;
      audio.onerror = null;
    };
  }, [actionIndex, deck, page, pageIndex, playing, releaseAudio]);

  useEffect(
    () => () => {
      playbackIdRef.current += 1;
      releaseAudio();
    },
    [releaseAudio],
  );

  if (!deck || !page) return null;

  return (
    <NativeWorkspaceDialog
      open
      onClose={() => {
        stop();
        onClose();
      }}
      title={deck.title}
      description="GPT Image 2 图片课件、语义遮罩与 OpenAI 中文语音"
      className="mini-lecture-dialog"
    >
      <header className="mini-lecture-classroom-header">
        <div>
          <h2>{deck.title}</h2>
          <p>
            第 {pageIndex + 1}/{deck.pages.length} 页 · {speechSegments.length} 个讲解片段
          </p>
        </div>
        <div className="mini-lecture-header-actions">
          <label className="mini-lecture-speed-control">
            <span>倍速</span>
            <select
              aria-label="讲解播放速度"
              value={playbackRate}
              onChange={(event) => changePlaybackRate(Number(event.target.value))}
            >
              {MINI_LECTURE_PLAYBACK_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mini-lecture-play-button"
            onClick={() => {
              if (playing) {
                pause();
                return;
              }
              startOrResumePagePlayback();
            }}
          >
            {playing ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
            {playing ? '暂停讲解' : hasStartedPlayback ? '继续讲解' : '播放讲解'}
          </button>
          <button
            type="button"
            className="mini-lecture-close-button"
            aria-label="关闭课堂讲解"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="mini-lecture-classroom-body">
        <div className="mini-lecture-stage">
          <div className="mini-lecture-slide">
            <img src={page.imageUrl} alt={page.title} />
            {activeRegion ? (
              <span
                className="mini-lecture-spotlight"
                style={{
                  ...regionStyle(activeRegion, page),
                  borderColor: activeRegion.color,
                  boxShadow: `0 0 0 9999px rgb(15 23 42 / ${Math.round(activeDimOpacity * 100)}%), 0 0 24px ${activeRegion.color}`,
                }}
              />
            ) : null}
          </div>
          <div className="mini-lecture-page-nav">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => goToPage(pageIndex - 1)}
            >
              <ChevronLeft size={15} />
              上一页
            </button>
            <span>
              {deck.pages.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={index === pageIndex ? 'active' : ''}
                  aria-label={`第 ${index + 1} 页`}
                  onClick={() => goToPage(index)}
                />
              ))}
            </span>
            <button
              type="button"
              disabled={pageIndex === deck.pages.length - 1}
              onClick={() => goToPage(pageIndex + 1)}
            >
              下一页
              <ChevronRight size={15} />
            </button>
          </div>
          <p className="mini-lecture-audio-disclosure">
            语音由 OpenAI 人工智能生成，不是真人录音。
          </p>
        </div>

        <aside className="mini-lecture-script">
          <div className="mini-lecture-script-title">
            <span>
              <Volume2 size={15} />
              讲解节奏
            </span>
            <button type="button" className="mini-lecture-clear-focus" onClick={clearFocus}>
              <Eraser size={13} />
              清除聚焦
            </button>
          </div>
          <div className="mini-lecture-region-list">
            {speechSegments.map(({ action, actionIndex: segmentActionIndex, region }, index) => (
              <button
                key={action.id}
                type="button"
                className={
                  activeRegionId === action.regionId && speechText === action.text ? 'active' : ''
                }
                onClick={() => {
                  stop();
                  setActionIndex(segmentActionIndex);
                  setActiveRegionId(action.regionId);
                  setSpeechText(action.text);
                  setPlaybackError('');
                }}
              >
                <span style={{ background: region?.color || '#94a3b8' }} />
                <strong>
                  {index + 1}. {action.title}
                </strong>
                <small>{action.text}</small>
              </button>
            ))}
          </div>
          <div className="mini-lecture-caption">
            <span>{playing ? '正在播放 OpenAI 语音' : speechText ? '当前讲解' : '准备就绪'}</span>
            <p>{speechText || '点击“播放讲解”，遮罩会由动作序列驱动并跟随音频移动。'}</p>
          </div>
          {playbackError ? (
            <div className="mini-lecture-playback-error" role="alert">
              <AlertCircle size={14} />
              <span>{playbackError}</span>
            </div>
          ) : null}
        </aside>
      </div>
    </NativeWorkspaceDialog>
  );
}
