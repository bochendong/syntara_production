'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { SyntaraMark } from '@/components/brand/syntara-mark';
import { useAuthStore } from '@/lib/store/auth';

export function TeacherOnlineLoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const syncFromOAuth = useAuthStore((state) => state.syncFromOAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = session?.user;
    if (status !== 'authenticated' || !user?.id) return;
    if (user.role !== 'TEACHER' && user.role !== 'ADMIN') {
      setError('当前账号没有教师权限，请联系管理员。');
      return;
    }
    syncFromOAuth({
      userId: user.id,
      name: user.name?.trim() || '老师',
      email: user.email?.trim().toLowerCase() || '',
      role: user.role,
    });
    router.replace('/teacher');
  }, [router, session, status, syncFromOAuth]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await signIn('teacher-credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (!result?.ok) throw new Error('邮箱或密码错误，或账号已停用。');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '教师登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#071224] px-5 text-slate-100">
      <img
        src="/background/login.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-65"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(3,10,24,.68),rgba(3,10,24,.28),rgba(3,10,24,.72))]" />
      <main className="relative z-10 grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3 text-xl font-semibold">
            <SyntaraMark className="size-10 rounded-xl bg-white/10 ring-1 ring-sky-300/25" />
            Syntara
          </div>
          <p className="mt-16 text-xs font-bold tracking-[.2em] text-sky-300">TEACHER PORTAL</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-[-.05em]">
            课程资料、AI 队列与学生管理，统一在线同步。
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-slate-300">
            账号由管理员创建。课程和生成内容统一保存到线上数据库，在不同浏览器与设备之间保持一致。
          </p>
        </section>
        <section className="rounded-[28px] border border-white/10 bg-white/[.08] p-7 shadow-2xl backdrop-blur-2xl">
          <div className="text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-300/20">
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="mt-4 text-3xl font-semibold">教师登录</h2>
            <p className="mt-2 text-sm text-slate-400">使用管理员分配的邮箱和密码</p>
          </div>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <label className="block space-y-1.5 text-xs text-slate-400">
              <span>邮箱</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white outline-none focus:border-sky-300/40"
              />
            </label>
            <label className="block space-y-1.5 text-xs text-slate-400">
              <span>密码</span>
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white outline-none focus:border-sky-300/40"
              />
            </label>
            {error ? (
              <p className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || status === 'loading'}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-100 text-sm font-semibold text-sky-950 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {busy ? '正在登录…' : '进入教师工作台'}
            </button>
          </form>
          <p className="mt-5 text-center text-xs text-slate-500">
            忘记密码请联系管理员在后台重置。
          </p>
          <div className="my-5 flex items-center gap-3 text-[11px] text-slate-500" aria-hidden>
            <span className="h-px flex-1 bg-white/10" />
            或
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <a
            href="/login"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.06] text-sm font-semibold text-slate-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
          >
            <GraduationCap className="size-4" />
            我是学生，返回学生登录
          </a>
        </section>
      </main>
    </div>
  );
}
