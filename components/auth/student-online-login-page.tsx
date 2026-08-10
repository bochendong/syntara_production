'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { signIn, useSession } from 'next-auth/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { GraduationCap, Loader2, LogIn, ShieldCheck, UserRoundCog } from 'lucide-react';
import { SyntaraMark } from '@/components/brand/syntara-mark';
import { useAuthStore } from '@/lib/store/auth';
import { backendFetch } from '@/lib/utils/backend-api';

type LoginMode = 'student' | 'teacher' | 'admin';

const MODE_META = {
  student: {
    label: '学生',
    eyebrow: 'STUDENT PORTAL',
    title: '学生登录',
    subtitle: '使用管理员分配的学生邮箱和密码',
    heroTitle: '课程、AI 笔记本与学习日历，在所有设备上保持同步。',
    heroDescription: '登录后会自动显示管理员分配的课程；老师更新的笔记本和思维导图会从共享数据库自动同步。',
    accentText: 'text-emerald-300',
    icon: GraduationCap,
    button: '进入学生桌面',
    loading: '正在登录…',
  },
  teacher: {
    label: '老师',
    eyebrow: 'TEACHER PORTAL',
    title: '教师登录',
    subtitle: '使用管理员分配的教师邮箱和密码',
    heroTitle: '课程资料、AI 队列与学生管理，统一在线同步。',
    heroDescription: '账号由管理员创建。课程和生成内容统一保存到线上数据库，在不同浏览器与设备之间保持一致。',
    accentText: 'text-sky-300',
    icon: ShieldCheck,
    button: '进入教师工作台',
    loading: '正在登录…',
  },
  admin: {
    label: '管理员',
    eyebrow: 'ADMIN CONSOLE',
    title: '管理员登录',
    subtitle: '使用云端环境变量配置的管理员邮箱和密码',
    heroTitle: '账号、额度、模型与云端成本上限，在一个后台集中管理。',
    heroDescription: '管理员登录独立于学生和老师账号，用于控制全站配置、用户限额和运营后台能力。',
    accentText: 'text-amber-300',
    icon: UserRoundCog,
    button: '进入管理员后台',
    loading: '正在登录…',
  },
} as const;

export function StudentOnlineLoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const syncFromOAuth = useAuthStore((state) => state.syncFromOAuth);
  const [mode, setMode] = useState<LoginMode>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = session?.user;
    if (status !== 'authenticated' || !user?.id) return;
    const role = user.role as 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN' | undefined;
    const syncUser = (fallbackName: string) =>
      syncFromOAuth({
        userId: user.id,
        name: user.name?.trim() || fallbackName,
        email: user.email?.trim().toLowerCase() || '',
        role,
      });

    if (mode === 'admin' && role === 'ADMIN') {
      syncUser('管理员');
      router.replace('/admin');
      return;
    }
    if (mode === 'teacher' && (role === 'TEACHER' || role === 'ADMIN')) {
      syncUser(role === 'ADMIN' ? '管理员' : '老师');
      router.replace('/teacher');
      return;
    }
    if (mode === 'teacher') {
      setError('当前账号没有教师权限，请联系管理员。');
      return;
    }
    if (mode === 'student' && role !== 'STUDENT' && role !== 'USER') {
      setError('当前账号不是学生账号，请切换入口或联系管理员。');
      return;
    }
    syncUser('学生');
    router.replace('/learn');
  }, [mode, router, session, status, syncFromOAuth]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'admin') {
        const response = await backendFetch('/api/admin/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || '管理员邮箱或密码错误。');
        }
        router.replace('/admin');
        return;
      }

      const result = await signIn(mode === 'teacher' ? 'teacher-credentials' : 'student-credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (!result?.ok) throw new Error('邮箱或密码错误，或账号已停用。');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;

  const switchMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    setError('');
    setPassword('');
  };

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#071224] px-5 text-slate-100">
      <Image
        src="/background/login.png"
        alt=""
        aria-hidden
        fill
        priority
        sizes="100vw"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-65"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(3,10,24,.68),rgba(3,10,24,.28),rgba(3,10,24,.72))]" />
      <main className="relative z-10 grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3 text-xl font-semibold">
            <SyntaraMark className="size-10 rounded-xl bg-white/10 ring-1 ring-sky-300/25" />
            Syntara
          </div>
          <p className={`mt-16 text-xs font-bold tracking-[.2em] ${meta.accentText}`}>
            {meta.eyebrow}
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-[-.05em]">
            {meta.heroTitle}
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-slate-300">
            {meta.heroDescription}
          </p>
        </section>
        <section className="rounded-[28px] border border-white/10 bg-white/[.08] p-7 shadow-2xl backdrop-blur-2xl">
          <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[.04] p-1">
            {(['student', 'teacher', 'admin'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchMode(item)}
                className={`h-9 rounded-xl text-xs font-semibold transition ${
                  mode === item
                    ? 'bg-white text-slate-950'
                    : 'text-slate-300 hover:bg-white/[.08] hover:text-white'
                }`}
              >
                {MODE_META[item].label}
              </button>
            ))}
          </div>

          <div className="text-center">
            <span className={`mx-auto grid size-12 place-items-center rounded-2xl bg-white/10 ${meta.accentText} ring-1 ring-white/15`}>
              <ModeIcon className="size-5" />
            </span>
            <h2 className="mt-4 text-3xl font-semibold">{meta.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{meta.subtitle}</p>
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
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white outline-none focus:border-white/40"
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
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white outline-none focus:border-white/40"
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
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-slate-950 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {busy ? meta.loading : meta.button}
            </button>
          </form>

          {mode === 'admin' ? (
            <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-50">
              本地开发管理员：admin@syntara.local / SyntaraAdmin2026!
            </p>
          ) : (
            <p className="mt-5 text-center text-xs text-slate-500">
              忘记密码请联系管理员在后台重置。
            </p>
          )}

          <div className="my-5 flex items-center gap-3 text-[11px] text-slate-500" aria-hidden>
            <span className="h-px flex-1 bg-white/10" />
            或
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {mode !== 'teacher' ? (
              <button
                type="button"
                onClick={() => switchMode('teacher')}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.06] text-sm font-semibold text-slate-100 transition hover:border-sky-300/40 hover:bg-sky-300/10"
              >
                <ShieldCheck className="size-4" />
                我是老师
              </button>
            ) : null}
            {mode !== 'admin' ? (
              <button
                type="button"
                onClick={() => switchMode('admin')}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.06] text-sm font-semibold text-slate-100 transition hover:border-amber-300/40 hover:bg-amber-300/10"
              >
                <UserRoundCog className="size-4" />
                我是管理员
              </button>
            ) : null}
            {mode !== 'student' ? (
              <button
                type="button"
                onClick={() => switchMode('student')}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.06] text-sm font-semibold text-slate-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/10"
              >
                <GraduationCap className="size-4" />
                我是学生
              </button>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
