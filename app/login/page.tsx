'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Github, LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuthStore } from '@/lib/store/auth';
import { SyntaraMark } from '@/components/brand/syntara-mark';

type OauthConfig = { google: boolean; github: boolean; demoAuth: boolean };

const POST_LOGIN_HREF = '/learn';
const DEV_LOCAL_USER = { name: '本机开发者', email: 'dev@localhost' } as const;

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV !== 'production';
  const preview = isDev && searchParams.get('previewLogin') === '1';
  const { data: session, status } = useSession();
  const login = useAuthStore((s) => s.login);
  const syncFromOAuth = useAuthStore((s) => s.syncFromOAuth);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const authMode = useAuthStore((s) => s.authMode);

  const [oauth, setOauth] = useState<OauthConfig | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [oauthBusy, setOauthBusy] = useState<'google' | 'github' | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/auth/oauth-config');
        const j = (await r.json()) as OauthConfig;
        if (alive) setOauth(j);
      } catch {
        if (alive) setOauth({ google: false, github: false, demoAuth: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (
      !preview &&
      (oauth?.demoAuth || isDev) &&
      status !== 'loading' &&
      status !== 'authenticated' &&
      isLoggedIn &&
      authMode === 'email'
    ) {
      router.replace(POST_LOGIN_HREF);
    }
  }, [authMode, isDev, isLoggedIn, oauth?.demoAuth, preview, router, status]);

  useEffect(() => {
    if (preview || status !== 'authenticated' || !session?.user) return;
    const id = session.user.id?.trim();
    if (!id) {
      void signOut({ redirect: false });
      return;
    }
    syncFromOAuth({
      userId: id,
      name: session.user.name?.trim() ?? '',
      email: session.user.email?.trim().toLowerCase() ?? '',
      role: session.user.role ?? 'USER',
    });
    router.replace(POST_LOGIN_HREF);
  }, [preview, status, session, router, syncFromOAuth]);

  const enterLocalDev = () => {
    login({ ...DEV_LOCAL_USER });
    router.push(POST_LOGIN_HREF);
  };

  const onSubmitLocal = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalName = name.trim();
    const finalEmail = email.trim().toLowerCase();
    if (!finalName) {
      setError('请输入昵称');
      return;
    }
    if (!finalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    login({ name: finalName, email: finalEmail });
    router.push(POST_LOGIN_HREF);
  };

  const hasOauth = Boolean(oauth && (oauth.google || oauth.github));
  if (status === 'loading' || oauth === null) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#071224]">
        <img
          src="/background/login.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,15,34,0.28)_0%,rgba(5,15,34,0.08)_42%,rgba(5,15,34,0.42)_100%)]"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10"
        >
          <div className="size-8 rounded-full border-2 border-sky-300 border-t-transparent animate-spin" />
        </motion.div>
      </div>
    );
  }

  if (!preview && status === 'authenticated' && session?.user?.id?.trim()) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#071224]">
        <img
          src="/background/login.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,15,34,0.28)_0%,rgba(5,15,34,0.08)_42%,rgba(5,15,34,0.42)_100%)]"
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative z-10 text-sm text-slate-300"
        >
          正在进入学习页…
        </motion.p>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#071224] text-slate-200">
      <img
        src="/background/login.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left select-none"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,15,34,0.28)_0%,rgba(5,15,34,0.08)_42%,rgba(5,15,34,0.42)_100%),linear-gradient(180deg,rgba(5,15,34,0.22)_0%,transparent_18%,transparent_78%,rgba(5,15,34,0.28)_100%)]"
      />

      <main className="relative z-10 grid min-h-[100dvh] w-full items-stretch lg:grid-cols-[minmax(0,1.14fr)_minmax(390px,0.86fr)]">
        <motion.section
          initial={{ opacity: 0, x: -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          className="hidden min-w-0 lg:flex lg:flex-col lg:justify-between lg:p-[clamp(48px,7vw,92px)]"
        >
          <div className="relative">
            <div className="mb-16 flex items-center gap-3 text-xl font-semibold tracking-[-0.03em] text-white">
              <SyntaraMark className="size-10 rounded-xl bg-white/10 shadow-none ring-1 ring-sky-300/25" />
              Syntara
            </div>
            <p className="mb-5 inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-sky-300">
              YOUR LEARNING SPACE
            </p>
            <h2 className="max-w-[660px] text-[clamp(38px,4.7vw,68px)] font-semibold leading-[1.14] tracking-[-0.055em] text-slate-50">
              让每一次学习，
              <br />
              都延续上一次的理解。
            </h2>
            <p className="mt-7 max-w-[520px] text-[15px] leading-[1.8] text-slate-300/90">
              登录后进入你的课程、课堂讲解、复习计划与学习记忆。
            </p>
          </div>
        </motion.section>
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="grid w-full place-items-center p-[clamp(32px,6vw,78px)]"
        >
          <div className="w-full max-w-[410px] rounded-[28px] border border-slate-400/15 bg-[linear-gradient(145deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] p-8 shadow-[0_34px_90px_rgba(0,0,0,0.28)] backdrop-blur-[30px] saturate-[1.15]">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mb-6 space-y-2 text-center"
            >
              <span className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl border border-sky-300/25 bg-sky-400/10 text-sky-300">
                <LogIn className="size-[22px]" />
              </span>
              <p className="text-[10px] font-bold tracking-[0.18em] text-sky-300">
                SYNTARA ACCOUNT
              </p>
              <h1 className="text-3xl font-semibold tracking-[-0.045em] text-slate-50">
                登录后继续
              </h1>
              <p className="text-sm leading-6 text-slate-400">
                我们会通过安全登录完成身份验证。确认后，网页会自动进入你的学习空间。
              </p>
              <p className="text-xs text-slate-500">
                还没有账号？
                <Link href="/register" className="ml-1 font-medium text-sky-300 hover:underline">
                  去注册
                </Link>
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="space-y-6"
            >
              {isDev ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={enterLocalDev}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#e0f2fe,#bae6fd)] text-sm font-semibold text-sky-950 shadow-[0_14px_32px_rgba(14,165,233,0.18)] transition hover:brightness-105"
                  >
                    <LogIn className="size-[17px]" />
                    本机开发登录
                  </button>
                  <p className="text-center text-[11px] text-slate-500">
                    仅开发环境可见，跳过 Google / GitHub
                  </p>
                </div>
              ) : null}

              {isDev && (hasOauth || oauth.demoAuth) ? (
                <div className="relative flex items-center justify-center py-1">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                  <span className="relative rounded-full border border-white/10 bg-slate-950/50 px-4 py-0.5 text-xs text-slate-400">
                    或正式登录
                  </span>
                </div>
              ) : null}

              {hasOauth && oauth ? (
                <div className="space-y-3">
                  {oauth.google ? (
                    <button
                      type="button"
                      disabled={oauthBusy !== null}
                      onClick={() => {
                        setOauthBusy('google');
                        void signIn('google', { callbackUrl: POST_LOGIN_HREF });
                      }}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/90 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-white disabled:opacity-60"
                    >
                      <span className="text-base font-semibold text-[#4285F4]">G</span>
                      使用 Google 登录
                    </button>
                  ) : null}
                  {oauth.github ? (
                    <button
                      type="button"
                      disabled={oauthBusy !== null}
                      onClick={() => {
                        setOauthBusy('github');
                        void signIn('github', { callbackUrl: POST_LOGIN_HREF });
                      }}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f172a] text-sm font-medium text-white shadow-sm transition hover:bg-[#1e293b] disabled:opacity-60"
                    >
                      <Github className="size-5" strokeWidth={1.75} />
                      使用 GitHub 登录
                    </button>
                  ) : null}
                </div>
              ) : !oauth.demoAuth && !isDev ? (
                <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-left text-xs text-amber-100">
                  <p className="font-medium">尚未配置第三方登录</p>
                  <p className="mt-1 text-amber-200/90">
                    在 <code className="rounded bg-white/10 px-1">.env.local</code> 中设置{' '}
                    <code className="rounded bg-white/10 px-1">GOOGLE_CLIENT_ID</code> /{' '}
                    <code className="rounded bg-white/10 px-1">GITHUB_CLIENT_ID</code> 及对应
                    Secret，并配置 <code className="rounded bg-white/10 px-1">NEXTAUTH_URL</code>、
                    <code className="rounded bg-white/10 px-1">NEXTAUTH_SECRET</code>
                    后重启开发服务。
                  </p>
                </div>
              ) : null}

              {hasOauth && oauth.demoAuth ? (
                <div className="relative flex items-center justify-center py-1">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                  <span className="relative rounded-full border border-white/10 bg-slate-950/50 px-4 py-0.5 text-xs text-slate-400">
                    或使用邮箱登录（不验证邮箱所有权）
                  </span>
                </div>
              ) : null}

              {oauth.demoAuth ? (
                <form className="space-y-4" onSubmit={onSubmitLocal}>
                  <div className="space-y-1.5">
                    <label htmlFor="login-name" className="text-xs font-medium text-slate-400">
                      昵称
                    </label>
                    <input
                      id="login-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="例如：Dongpo"
                      autoComplete="nickname"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-300/40 focus:bg-white/10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="login-email" className="text-xs font-medium text-slate-400">
                      邮箱
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-sky-300/40 focus:bg-white/10"
                    />
                  </div>
                  {error ? (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
                    >
                      {error}
                    </motion.p>
                  ) : null}
                  <button
                    type="submit"
                    className="h-11 w-full rounded-xl bg-[linear-gradient(135deg,#e0f2fe,#bae6fd)] text-sm font-semibold text-sky-950 shadow-[0_14px_32px_rgba(14,165,233,0.18)] transition hover:brightness-105"
                  >
                    {hasOauth ? '邮箱登录并进入学习页' : '登录并进入学习页'}
                  </button>
                </form>
              ) : null}
            </motion.div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#071224]">
          <img
            src="/background/login.png"
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left"
          />
          <div className="relative z-10 size-8 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
