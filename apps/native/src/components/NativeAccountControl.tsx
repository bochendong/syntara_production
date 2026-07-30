import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import loginBackgroundUrl from '../../../../public/background/login.png?url';
import {
  getNativeDeviceIdentity,
  loadNativeAuthSession,
  saveNativeAuthSession,
  subscribeNativeAuth,
  validateNativeAuthSession,
  type NativeAuthSession,
} from '../data/native-auth';
import {
  pollNativeDeviceAuth,
  startNativeDeviceAuth,
  type NativeDeviceAuthorization,
} from '../data/platform-api-client';

type LoginState = 'idle' | 'starting' | 'waiting' | 'error';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function NativeAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<NativeAuthSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [browserPreviewUnlocked, setBrowserPreviewUnlocked] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>('idle');
  const [authorization, setAuthorization] = useState<NativeDeviceAuthorization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollGenerationRef = useRef(0);
  const browserPreview = !isTauriRuntime();

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeNativeAuth((nextSession) => {
      if (!cancelled) setSession(nextSession);
    });
    void loadNativeAuthSession()
      .then((stored) => {
        if (!cancelled) setSession(stored);
        return validateNativeAuthSession();
      })
      .then((validated) => {
        if (!cancelled) setSession(validated);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
      pollGenerationRef.current += 1;
      unsubscribe();
    };
  }, []);

  const stopPolling = useCallback(() => {
    pollGenerationRef.current += 1;
  }, []);

  const resetLogin = useCallback(() => {
    stopPolling();
    setAuthorization(null);
    setLoginState('idle');
    setError(null);
  }, [stopPolling]);

  const beginPolling = useCallback(async (nextAuthorization: NativeDeviceAuthorization) => {
    const generation = ++pollGenerationRef.current;
    const expiresAt = Date.now() + nextAuthorization.expiresInSeconds * 1_000;
    const intervalMs = Math.max(2_000, nextAuthorization.intervalSeconds * 1_000);

    while (generation === pollGenerationRef.current && Date.now() < expiresAt) {
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
      if (generation !== pollGenerationRef.current) return;
      try {
        const result = await pollNativeDeviceAuth(nextAuthorization.deviceCode);
        if (result.status === 'pending') continue;
        const stored = await saveNativeAuthSession(result);
        setSession(stored);
        return;
      } catch (cause) {
        const message = errorMessage(cause);
        if (/pending|等待|202/i.test(message)) continue;
        setError(message);
        setLoginState('error');
        return;
      }
    }
    if (generation === pollGenerationRef.current) {
      setError('登录请求已过期，请重新发起登录。');
      setLoginState('error');
    }
  }, []);

  const startLogin = useCallback(async () => {
    stopPolling();
    setLoginState('starting');
    setAuthorization(null);
    setError(null);
    try {
      const nextAuthorization = await startNativeDeviceAuth(getNativeDeviceIdentity());
      setAuthorization(nextAuthorization);
      setLoginState('waiting');
      await openUrl(nextAuthorization.verificationUriComplete);
      void beginPolling(nextAuthorization);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoginState('error');
    }
  }, [beginPolling, stopPolling]);

  const reopenBrowser = useCallback(async () => {
    if (!authorization) return;
    try {
      await openUrl(authorization.verificationUriComplete);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [authorization]);

  if (sessionLoading) {
    return (
      <main className="native-auth-gate is-loading">
        <div className="native-auth-loading" role="status">
          <span className="native-auth-mark">
            <Sparkles size={23} />
          </span>
          <strong>Syntara</strong>
          <span>
            <Loader2 className="is-spinning" size={15} />
            正在验证登录状态
          </span>
        </div>
      </main>
    );
  }

  if (session || browserPreviewUnlocked) return children;

  return (
    <main className="native-auth-gate">
      <img
        className="native-auth-background"
        src={loginBackgroundUrl}
        alt=""
        aria-hidden
        draggable={false}
      />
      <span className="native-auth-scrim" aria-hidden />

      <section className="native-auth-brand" aria-label="Syntara">
        <div className="native-auth-wordmark">
          <span className="native-auth-mark">
            <Sparkles size={23} />
          </span>
          <span>Syntara</span>
        </div>
        <div className="native-auth-promise">
          <p>YOUR LEARNING SPACE</p>
          <h1>
            让每一次学习，
            <br />
            都延续上一次的理解。
          </h1>
          <p className="native-auth-lead">
            登录后进入你的课程、课堂讲解、复习计划与学习记忆。
          </p>
        </div>
        <div className="native-auth-trust">
          <span>
            <ShieldCheck size={16} />
            平台 AI 仅对登录用户开放
          </span>
          <span>
            <LockKeyhole size={16} />
            凭据由系统钥匙串保护
          </span>
        </div>
      </section>

      <section className="native-auth-panel" aria-labelledby="native-auth-title">
        <div className="native-auth-card">
          <div className="native-auth-card-icon">
            <LogIn size={22} />
          </div>
          <p className="native-account-eyebrow">Syntara Account</p>
          <h2 id="native-auth-title">{browserPreview ? '本机预览模式' : '登录后继续'}</h2>
          <p className="native-account-copy">
            {browserPreview
              ? '当前是浏览器预览，无法使用平台登录与平台 AI。可先进入本机预览改界面；正式登录请打开 macOS 开发版窗口。'
              : '我们会在浏览器中完成安全登录。确认后，这个 App 会自动进入你的学习空间。'}
          </p>

          {browserPreview ? (
            <button
              className="native-account-primary native-auth-submit"
              type="button"
              onClick={() => setBrowserPreviewUnlocked(true)}
            >
              进入本机预览
            </button>
          ) : null}

          {!browserPreview && loginState === 'idle' ? (
            <button
              className="native-account-primary native-auth-submit"
              type="button"
              onClick={() => void startLogin()}
            >
              <LogIn size={17} />
              登录 Syntara
            </button>
          ) : null}

          {!browserPreview && loginState === 'starting' ? (
            <div className="native-account-progress" role="status">
              <Loader2 className="is-spinning" size={18} />
              正在创建一次性登录请求…
            </div>
          ) : null}

          {!browserPreview && authorization && loginState === 'waiting' ? (
            <>
              <div className="native-device-code">
                <span>设备验证码</span>
                <strong>{authorization.userCode}</strong>
              </div>
              <div className="native-account-progress" role="status">
                <Loader2 className="is-spinning" size={17} />
                等待你在浏览器中确认…
              </div>
              <button
                className="native-account-secondary native-auth-submit"
                type="button"
                onClick={() => void reopenBrowser()}
              >
                <ExternalLink size={16} />
                重新打开登录页面
              </button>
              <button className="native-auth-cancel" type="button" onClick={resetLogin}>
                取消
              </button>
            </>
          ) : null}

          {error ? (
            <div className="native-account-error" role="alert">
              {error}
            </div>
          ) : null}

          {!browserPreview && loginState === 'error' ? (
            <button
              className="native-account-primary native-auth-submit"
              type="button"
              onClick={() => void startLogin()}
            >
              重新登录
            </button>
          ) : null}

          <div className="native-auth-divider" />
          <p className="native-account-footnote">
            <CheckCircle2 size={13} />
            课程资料保存在本机；AI 密钥不会写入安装包。
          </p>
        </div>
      </section>
    </main>
  );
}
