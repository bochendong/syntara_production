'use client';

import { useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { ArrowRight, CheckCircle2, Github, Laptop, Loader2, ShieldCheck } from 'lucide-react';

type NativeLoginPageClientProps = {
  userCode: string;
  providers: {
    google: boolean;
    github: boolean;
  };
};

type ApprovalState =
  | { status: 'idle' }
  | { status: 'approving' }
  | { status: 'approved'; deviceName: string }
  | { status: 'error'; message: string };

function approvalError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '设备授权失败，请重新生成登录码。';
  const record = payload as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : null;
  return (
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof record.error === 'string' && record.error) ||
    '设备授权失败，请重新生成登录码。'
  );
}

export function NativeLoginPageClient({ userCode, providers }: NativeLoginPageClientProps) {
  const { data: session, status } = useSession();
  const [approval, setApproval] = useState<ApprovalState>({ status: 'idle' });
  const callbackUrl = `/native-login?user_code=${encodeURIComponent(userCode)}`;

  const approveDevice = async () => {
    if (!userCode || approval.status === 'approving') return;
    setApproval({ status: 'approving' });
    try {
      const response = await fetch('/api/native/v1/auth/device/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userCode }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { deviceName?: string };
      } | null;
      if (!response.ok) throw new Error(approvalError(payload));
      setApproval({
        status: 'approved',
        deviceName: payload?.data?.deviceName?.trim() || 'Syntara App',
      });
    } catch (error) {
      setApproval({
        status: 'error',
        message: error instanceof Error ? error.message : '设备授权失败，请重试。',
      });
    }
  };

  return (
    <main className="apple-mesh-bg flex min-h-[100dvh] items-center justify-center px-4 py-12">
      <section className="apple-glass w-full max-w-lg rounded-[30px] p-7 shadow-[0_24px_80px_rgba(15,23,42,0.14)] md:p-9">
        <header className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#007AFF] text-white shadow-[0_12px_28px_rgba(0,122,255,0.3)]">
            <ShieldCheck size={28} strokeWidth={1.8} />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
            登录 Syntara App
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#6e6e73] dark:text-[#a1a1a6]">
            授权后，这台设备才能调用平台 AI。你的 OpenAI Key 不会发送到 App。
          </p>
        </header>

        {!userCode ? (
          <div className="mt-7 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
            登录码无效。请回到 Syntara App 重新发起登录。
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-black/[0.06] bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.06]">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#007AFF]/10 text-[#007AFF]">
                <Laptop size={20} />
              </span>
              <span>
                <small className="block text-xs text-[#86868b]">设备登录码</small>
                <strong className="mt-0.5 block font-mono text-xl tracking-[0.16em] text-[#1d1d1f] dark:text-white">
                  {userCode}
                </strong>
              </span>
            </div>
          </div>
        )}

        {status === 'loading' ? (
          <div className="mt-7 flex items-center justify-center gap-2 text-sm text-[#86868b]">
            <Loader2 size={16} className="animate-spin" />
            正在检查登录状态…
          </div>
        ) : status !== 'authenticated' ? (
          <div className="mt-7 space-y-3">
            {providers.google ? (
              <button
                type="button"
                className="apple-btn apple-btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium"
                onClick={() => void signIn('google', { callbackUrl })}
                disabled={!userCode}
              >
                <span className="font-semibold">G</span>
                使用 Google 登录
                <ArrowRight size={16} />
              </button>
            ) : null}
            {providers.github ? (
              <button
                type="button"
                className="apple-btn flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] text-sm font-medium text-white"
                onClick={() => void signIn('github', { callbackUrl })}
                disabled={!userCode}
              >
                <Github size={17} />
                使用 GitHub 登录
              </button>
            ) : null}
            {!providers.google && !providers.github ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                平台尚未配置 OAuth 登录。
              </p>
            ) : null}
          </div>
        ) : approval.status === 'approved' ? (
          <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-400/30 dark:bg-emerald-400/10">
            <CheckCircle2 className="mx-auto text-emerald-600" size={28} />
            <strong className="mt-3 block text-emerald-800 dark:text-emerald-200">
              已授权 {approval.deviceName}
            </strong>
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
              可以关闭此页面，App 会自动完成登录。
            </p>
          </div>
        ) : (
          <div className="mt-7">
            <p className="mb-3 text-center text-sm text-[#6e6e73] dark:text-[#a1a1a6]">
              将使用账号 {session.user?.email || session.user?.name || '当前用户'} 授权此设备。
            </p>
            {approval.status === 'error' ? (
              <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                {approval.message}
              </p>
            ) : null}
            <button
              type="button"
              className="apple-btn apple-btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium"
              onClick={() => void approveDevice()}
              disabled={!userCode || approval.status === 'approving'}
            >
              {approval.status === 'approving' ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <ShieldCheck size={17} />
              )}
              {approval.status === 'approving' ? '正在授权…' : '授权这台设备'}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
