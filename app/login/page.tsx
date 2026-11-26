import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SyntaraMark } from '@/components/brand/syntara-mark';
import { AssistantLoginForm } from './assistant-login-form';

export const metadata: Metadata = {
  title: '登录 · Syntara',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; user_code?: string }>;
}) {
  const { role, user_code: userCode } = await searchParams;
  if (role !== 'assistant') redirect('/speedup/signed-out?role=student');
  const destination =
    userCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)
      ? `/native-login?user_code=${encodeURIComponent(userCode)}`
      : '/learn';

  return (
    <main className="apple-mesh-bg grid min-h-dvh place-items-center px-4 py-10">
      <section className="apple-glass w-full max-w-sm rounded-3xl p-6 sm:p-8">
        <SyntaraMark className="size-10 rounded-xl" />
        <h1 className="mt-4 text-xl font-semibold">助教账号登录</h1>
        <AssistantLoginForm destination={destination} />
        <Link href="/login" className="mt-4 inline-block text-sm text-muted-foreground underline">
          返回 Speedup 登录指引
        </Link>
      </section>
    </main>
  );
}
