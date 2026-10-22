'use client';

import { useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

export function NativeTestLogin() {
  const { data: session, status } = useSession();
  const active = status === 'authenticated' && session.user?.isActive !== false;
  useEffect(() => {
    if (active) window.location.replace('/test/app');
  }, [active]);
  return (
    <main className="apple-mesh-bg grid min-h-dvh place-items-center px-5 py-12">
      <section className="apple-glass w-full max-w-lg rounded-3xl p-8">
        <p className="text-xs font-semibold tracking-widest text-blue-600">SYNTARA TEST</p>
        <h1 className="mt-4 text-2xl font-semibold">
          {active ? '正在进入 Syntara' : '欢迎测试 Syntara'}
        </h1>
        {status === 'loading' ? (
          <p role="status" className="mt-5 text-sm">
            正在检查登录状态…
          </p>
        ) : active ? (
          <>
            <p className="mt-5 break-words text-sm leading-7">
              已使用 {session.user?.email} 登录，正在打开新版学习空间。
            </p>
            <button
              type="button"
              className="apple-btn mt-6 rounded-xl px-5 py-3 text-sm"
              onClick={() => void signOut({ callbackUrl: '/test' })}
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <p className="mt-5 text-sm leading-7">
              使用你自己的 Google 账号即可创建测试账号，无需邀请码或激活码。 测试服数据独立保存。
            </p>
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
                  ? signOut({ callbackUrl: '/test' })
                  : signIn('google', { callbackUrl: '/test' }))
              }
            >
              {status === 'authenticated' ? '退出并更换账号' : '使用 Google 登录'}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
