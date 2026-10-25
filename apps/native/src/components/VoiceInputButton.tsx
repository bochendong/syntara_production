import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { transcribeNativeAudio } from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import './voice-input.css';

/** 一段最多录两分钟，够说一个问题，也不会把转写拖得太久。 */
const MAX_RECORDING_MS = 120_000;

type VoiceState = 'idle' | 'recording' | 'transcribing';

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

/**
 * 输入框里的麦克风：点一下开始录，再点一下停，说的话转成文字放进输入框，
 * 不会直接发出去，用户可以先改。转写走平台的 /api/native/v1/transcriptions。
 */
export function VoiceInputButton({
  disabled = false,
  onText,
}: {
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 2400);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setHint('没有麦克风权限');
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();

    // 音量只用来让弹珠跟着声音跳，不存。
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      setLevel(Math.min(1, peak / 48));
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
      if (Date.now() - startedAt >= MAX_RECORDING_MS && recorder.state === 'recording') {
        recorder.stop();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const cleanup = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      cleanup();
      recorderRef.current = null;
      setLevel(0);
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
        const text = result.text.trim();
        if (text) onTextRef.current(text);
        else setHint('没听清，再说一次');
      } catch {
        setHint('转文字失败了');
      } finally {
        setState('idle');
      }
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setSeconds(0);
    setState('recording');
  };

  const toggle = () => {
    if (state === 'recording') recorderRef.current?.stop();
    else if (state === 'idle') void start();
  };

  if (!supported) return null;

  const label =
    state === 'recording' ? '停止录音' : state === 'transcribing' ? '正在转文字' : '语音输入';
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
        className={`composer-icon-button voice-input-button is-${state}`}
        onClick={toggle}
        disabled={disabled || state === 'transcribing'}
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
