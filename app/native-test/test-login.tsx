'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

type LoginAs = 'student' | 'teacher';

const COPY: Record<LoginAs, { title: string; hint: string; other: string }> = {
  student: {
    title: '学生登录',
    hint: '使用你自己的 Google 账号即可创建测试账号，无需邀请码或激活码。测试服数据独立保存。',
    other: '我是老师',
  },
  teacher: {
    title: '老师登录',
    hint: '用 Google 账号登录后，先认领你教的课程。一门课只能由一位老师认领。',
    other: '我是学生',
  },
};

function readLoginAs(): LoginAs {
  if (typeof window === 'undefined') return 'student';
  return new URLSearchParams(window.location.search).get('as') === 'teacher'
    ? 'teacher'
    : 'student';
}

export type { LoginAs };

export function NativeTestLogin({ initialAs }: { initialAs: LoginAs }) {
  const { data: session, status } = useSession();
  const [as, setAs] = useState<LoginAs>(initialAs);
  const active = status === 'authenticated' && session.user?.isActive !== false;
  useEffect(() => {
    if (active) window.location.replace(`/test/app?as=${readLoginAs()}`);
  }, [active]);
  const copy = COPY[as];
  const switchTo = (next: LoginAs) => {
    setAs(next);
    window.history.replaceState(null, '', `/test?as=${next}`);
  };
  return (
    <main className="apple-mesh-bg grid min-h-dvh place-items-center px-5 py-12">
      <section className="apple-glass w-full max-w-lg rounded-3xl p-8">
        <p className="text-xs font-semibold tracking-widest text-blue-600">SYNTARA TEST</p>
        <h1 className="mt-4 text-2xl font-semibold">{active ? '正在进入 Syntara' : copy.title}</h1>
        {status === 'loading' ? (
          <p role="status" className="mt-5 text-sm">
            正在检查登录状态…
          </p>
        ) : active ? (
          <>
            <p className="mt-5 break-words text-sm leading-7">
              已使用 {session.user?.email} 登录，正在打开{as === 'teacher' ? '教学' : '学习'}空间。
            </p>
            <button
              type="button"
              className="apple-btn mt-6 rounded-xl px-5 py-3 text-sm"
              onClick={() => void signOut({ callbackUrl: `/test?as=${as}` })}
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <p className="mt-5 text-sm leading-7">{copy.hint}</p>
            {status === 'authenticated' ? (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                当前账号已停用，请退出后更换账号。
              </p>
            ) : null}
            <button
              type="button"
              className="apple-btn apple-btn-primary mt-6 w-full rounded-xl px-5 py-3 text-sm"
              onClick={() =>
                void (status === 'authenticated'
                  ? signOut({ callbackUrl: `/test?as=${as}` })
                  : signIn('google', { callbackUrl: `/test?as=${as}` }))
              }
            >
              {status === 'authenticated' ? '退出并更换账号' : '使用 Google 登录'}
            </button>
            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-blue-600"
              onClick={() => switchTo(as === 'teacher' ? 'student' : 'teacher')}
            >
              {copy.other}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
