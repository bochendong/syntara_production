import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  getSpeedupPhoneState,
  saveSpeedupPhoneLast4,
  type SpeedupPhoneState,
} from '../data/platform-api-client';
import { readLoginIntent } from '../lib/login-intent';
import { GlassSpinner } from './GlassLoadMore';
import './speedup-phone.css';

const LATER_KEY = 'syntara.speedup-phone.later.v1';

/**
 * 学生登录后：加入的课里有 Speedup 的课、还没留手机尾号，就弹一次（几门课也只弹一次）。
 * 只记录 4 位尾号，不做比对。「稍后」只在这次打开期间不再弹，下次打开 App 还会问。
 * 老师登录不弹。
 */
export function SpeedupPhoneDialog({ courseCount }: { courseCount: number }) {
  const [state, setState] = useState<SpeedupPhoneState | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (readLoginIntent() === 'teacher') return;
    try {
      if (sessionStorage.getItem(LATER_KEY)) return;
    } catch {
      /* ignore */
    }
    let cancelled = false;
    getSpeedupPhoneState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // 加入新课（例如从商城加了一门 Speedup 课）后重新看一次。
  }, [courseCount]);

  useEffect(() => {
    if (state?.needed) inputRef.current?.focus();
  }, [state?.needed]);

  if (!state?.needed) return null;

  const later = () => {
    try {
      sessionStorage.setItem(LATER_KEY, '1');
    } catch {
      /* ignore */
    }
    setState(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(value)) {
      setError('请输入 4 位数字');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setState(await saveSpeedupPhoneLast4(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '没保存上，请重试');
    } finally {
      setBusy(false);
    }
  };

  const courses = state.courses.slice(0, 3).join('、') + (state.courses.length > 3 ? ' 等' : '');

  return (
    <div className="phone-confirm-layer" role="presentation">
      <div className="phone-confirm-backdrop" aria-hidden />
      <form
        className="phone-confirm sp-phone"
        role="dialog"
        aria-modal="true"
        aria-label="手机尾号"
        onSubmit={(event) => void submit(event)}
      >
        <strong className="phone-confirm-title">手机尾号</strong>
        <p className="phone-confirm-message">
          {courses ? `${courses} 是 Speedup 的课，` : ''}机构需要你手机号的后 4 位。
        </p>
        <label className="sp-phone-slots" onClick={() => inputRef.current?.focus()}>
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`sp-phone-slot${value[index] ? ' is-filled' : ''}${
                index === Math.min(value.length, 3) ? ' is-current' : ''
              }`}
              aria-hidden
            >
              {value[index] ?? ''}
            </span>
          ))}
          <input
            ref={inputRef}
            className="sp-phone-input"
            value={value}
            onChange={(event) => {
              setValue(event.target.value.replace(/\D/g, '').slice(0, 4));
              setError(null);
            }}
            inputMode="numeric"
            autoComplete="tel"
            pattern="[0-9]{4}"
            maxLength={4}
            aria-label="手机号后 4 位"
          />
        </label>
        {error ? (
          <p className="sp-phone-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="phone-confirm-actions">
          <button type="button" className="phone-confirm-button" onClick={later} disabled={busy}>
            稍后
          </button>
          <button
            type="submit"
            className="phone-confirm-button is-primary"
            disabled={busy || value.length !== 4}
          >
            {busy ? <GlassSpinner size={16} /> : null}
            确定
          </button>
        </div>
      </form>
    </div>
  );
}
