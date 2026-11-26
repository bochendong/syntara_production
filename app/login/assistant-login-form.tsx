'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AssistantLoginForm({ destination }: { destination: string }) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setSubmitting(true);
    try {
      const result = await signIn('student-credentials', {
        email: String(form.get('email') || ''),
        password: String(form.get('password') || ''),
        redirect: false,
        callbackUrl: destination,
      });
      if (result?.ok && !result.error) {
        window.location.assign(destination);
        return;
      }
      setError('登录失败，请检查账号邮箱和密码。');
    } catch {
      setError('登录暂时不可用，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="assistant-login-email">邮箱</Label>
        <Input
          id="assistant-login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="assistant-login-password">密码</Label>
        <Input
          id="assistant-login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? '正在登录…' : '登录'}
      </Button>
    </form>
  );
}
