'use client';

import { signIn, signOut, useSession } from 'next-auth/react';

export function NativeTestLogin() {
  const { data: session, status } = useSession();
  const active = status === 'authenticated' && session.user?.isActive !== false;
  return (
    <main className="apple-mesh-bg grid min-h-dvh place-items-center px-5 py-12">
      <section className="apple-glass w-full max-w-lg rounded-3xl p-8">
        <p className="text-xs font-semibold tracking-widest text-blue-600">SYNTARA TEST</p>
        <h1 className="mt-4 text-2xl font-semibold">
          {active ? '测试账号已就绪' : '欢迎测试 Syntara'}
        </h1>
        {status === 'loading' ? (
          <p role="status" className="mt-5 text-sm">
            正在检查登录状态…
          </p>
        ) : active ? (
          <>
            <p className="mt-5 break-words text-sm leading-7">
              已使用 {session.user?.email} 登录测试服。打开 Syntara Test App 并点击登录，
              在浏览器中确认设备后即可开始使用。
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
