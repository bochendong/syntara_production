import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { transcribeNativeAudio } from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import {
  connectRealtimeTranscription,
  type RealtimeTranscription,
} from '../lib/realtime-transcription';
import './voice-input.css';

/** 一段最多说两分钟，够说一个问题。 */
const MAX_RECORDING_MS = 120_000;

type VoiceState = 'connecting' | 'idle' | 'recording' | 'transcribing';

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? '';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const joinDraft = (base: string, spoken: string) =>
  !spoken ? base : base.trim() ? `${base.trimEnd()} ${spoken}` : spoken;

/**
 * 输入框里的麦克风：点一下开始说，字边说边出现在输入框里（OpenAI Realtime 转写），
 * 再点一下停。不会直接发出去，用户可以先改。
 * Realtime 连不上时退回「录完再转」（/api/native/v1/transcriptions）。
 */
export function VoiceInputButton({
  disabled = false,
  value,
  onChange,
}: {
  disabled?: boolean;
  /** 输入框当前的文字；说的话接在它后面。 */
  value: string;
  onChange: (next: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const activeRef = useRef(false);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 2400);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  /** 音量只用来让弹珠跟着声音跳，不存。到两分钟自动停。 */
  const watchLevel = (stream: MediaStream, startedAt: number, onLimit: () => void) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let limited = false;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      setLevel(Math.min(1, peak / 48));
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
      if (!limited && Date.now() - startedAt >= MAX_RECORDING_MS) {
        limited = true;
        onLimit();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void audioContext.close();
      if (activeRef.current) setLevel(0);
    };
  };

  const startRealtime = async (stream: MediaStream, base: string) => {
    const startedAt = Date.now();
    let live: RealtimeTranscription | null = null;
    const stopLevel = watchLevel(stream, startedAt, () => stopRef.current?.());
    const cleanup = () => {
      stopLevel();
      live?.close();
      stream.getTracks().forEach((track) => track.stop());
      cleanupRef.current = null;
      stopRef.current = null;
    };
    cleanupRef.current = cleanup;
    live = await connectRealtimeTranscription(
      stream,
      (text) => activeRef.current && onChangeRef.current(joinDraft(base, text)),
    );
    if (!activeRef.current) {
      cleanup();
      return;
    }
    setSeconds(0);
    setState('recording');
    stopRef.current = () => {
      stopRef.current = null;
      setState('transcribing');
      stopLevel();
      stream.getTracks().forEach((track) => track.stop());
      void live!
        .finish()
        .then((text) => {
          cleanup();
          if (!activeRef.current) return;
          setState('idle');
          if (text) onChangeRef.current(joinDraft(base, text));
          else setHint('没听清，再说一次');
        })
        .catch(() => {
          cleanup();
          if (activeRef.current) {
            setState('idle');
            setHint('转文字失败了');
          }
        });
    };
  };

  const startRecording = (stream: MediaStream, base: string) => {
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const stopLevel = watchLevel(stream, startedAt, () => stopRef.current?.());
    const cleanup = () => {
      stopLevel();
      stream.getTracks().forEach((track) => track.stop());
      cleanupRef.current = null;
      stopRef.current = null;
    };
    cleanupRef.current = () => {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state === 'recording') recorder.stop();
      cleanup();
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      cleanup();
      if (!activeRef.current) return;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (Date.now() - startedAt < 600 || !blob.size) {
        setState('idle');
        setHint('太短了，再说一次');
        return;
      }
      setState('transcribing');
      try {
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const result = await transcribeNativeAudio({
          fileName: `voice.${extension}`,
          mimeType: type.split(';')[0],
          dataBase64: await blobToBase64(blob),
          language: 'auto',
        });
        if (!activeRef.current) return;
        const text = result.text.trim();
        if (text) onChangeRef.current(joinDraft(base, text));
        else setHint('没听清，再说一次');
      } catch {
        if (activeRef.current) setHint('转文字失败了');
      } finally {
        if (activeRef.current) setState('idle');
      }
    };
    stopRef.current = () => {
      stopRef.current = null;
      if (recorder.state === 'recording') recorder.stop();
    };
    recorder.start(250);
    setSeconds(0);
    setState('recording');
  };

  const start = async () => {
    setState('connecting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setState('idle');
      setHint('没有麦克风权限');
      return;
    }
    if (!activeRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const base = valueRef.current;
    try {
      await startRealtime(stream, base);
    } catch {
      // Realtime 连不上（没配置、网络拦了 WebRTC 等）：同一个麦克风改成录完再转。
      cleanupRef.current?.();
      if (!activeRef.current) return;
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!activeRef.current) {
          fallback.getTracks().forEach((track) => track.stop());
          return;
        }
        startRecording(fallback, base);
      } catch {
        setState('idle');
        setHint('没有麦克风权限');
      }
    }
  };

  const toggle = () => {
    if (state === 'recording') stopRef.current?.();
    else if (state === 'idle') void start();
  };

  if (!supported) return null;

  const busy = state === 'connecting' || state === 'transcribing';
  const label =
    state === 'recording'
      ? '停止说话'
      : state === 'connecting'
        ? '正在打开麦克风'
        : state === 'transcribing'
          ? '正在整理文字'
          : '语音输入';
  return (
    <span className="voice-input">
      {state === 'recording' ? (
        <span className="voice-input-meter" aria-hidden>
          {(['blue', 'purple', 'pink'] as const).map((color, index) => (
            <img
              key={color}
              src={marbleImages[color]}
              alt=""
              style={{ transform: `translateY(${-level * (6 + index * 3)}px)` }}
            />
          ))}
          <small>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</small>
        </span>
      ) : null}
      <button
        type="button"
        className={`composer-icon-button voice-input-button is-${busy ? 'transcribing' : state}`}
        onClick={toggle}
        disabled={disabled || busy}
        aria-label={label}
        aria-pressed={state === 'recording'}
        title={label}
      >
        {state === 'recording' ? <i className="voice-input-stop" aria-hidden /> : <Mic size={18} />}
      </button>
      {hint ? (
        <span className="voice-input-hint" role="status">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
