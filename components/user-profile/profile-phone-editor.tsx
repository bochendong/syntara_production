'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, LockKeyhole, Pencil, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parsePhoneNumber, phoneLastFour } from '@/lib/profile/phone';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type MeProfile = {
  phone: string | null;
  phoneEditable: boolean;
};

export function ProfilePhoneEditor({ layout = 'row' }: { layout?: 'row' | 'stacked' }) {
  const { status } = useSession();
  const phone = useUserProfileStore((state) => state.phone);
  const setPhone = useUserProfileStore((state) => state.setPhone);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const readOnly = status !== 'unauthenticated' && !profile?.phoneEditable;
  const displayedPhone = status === 'authenticated' ? profile?.phone || '' : phone;

  useEffect(() => {
    if (status !== 'authenticated') return;
    let active = true;
    void backendJson<MeProfile>('/api/me')
      .then((profile) => {
        if (!active) return;
        setProfile(profile);
        setPhone(profile.phone || '');
        setDraft(profile.phone || '');
      })
      .catch(() => {
        if (active) setError('手机号加载失败，请刷新后重试。');
      });
    return () => {
      active = false;
    };
  }, [setPhone, status]);

  const save = async () => {
    if (saving || status === 'loading' || readOnly) return;
    const parsed = parsePhoneNumber(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (status === 'authenticated') {
        const profile = await backendJson<MeProfile>('/api/me', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: parsed.value || '' }),
        });
        setProfile(profile);
        setPhone(profile.phone || '');
        setDraft(profile.phone || '');
      } else {
        setPhone(parsed.value || '');
        setDraft(parsed.value || '');
      }
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '手机号保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={layout === 'stacked' ? '' : 'border-t border-slate-100 px-4 py-3.5'}>
      <div
        className={cn(
          'flex min-w-0 text-sm',
          layout === 'stacked' ? 'flex-col gap-2' : 'items-center justify-between gap-6',
        )}
      >
        <div>
          <p className="font-medium text-slate-800">手机号</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {readOnly ? '由 Speedup 同步，不可自行修改。' : ''}
            老师只能看到后四位
            {phoneLastFour(displayedPhone) ? ` · 当前尾号 ${phoneLastFour(displayedPhone)}` : ''}
          </p>
        </div>
        {readOnly ? (
          <div
            className={cn(
              'inline-flex min-w-0 items-center gap-2 px-2 py-1.5 text-slate-500',
              layout === 'stacked' &&
                'justify-between rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3',
            )}
          >
            <span className="truncate">
              {displayedPhone ||
                (status === 'loading' || (status === 'authenticated' && !profile && !error)
                  ? '加载中…'
                  : '暂未同步')}
            </span>
            <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
          </div>
        ) : editing ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
                if (event.key === 'Escape') {
                  setDraft(phone);
                  setEditing(false);
                  setError('');
                }
              }}
              inputMode="tel"
              disabled={saving || status === 'loading'}
              autoComplete="tel"
              placeholder="输入手机号"
              aria-label="手机号"
              className={cn('h-9', layout === 'row' && 'max-w-64')}
              aria-invalid={Boolean(error)}
            />
            <Button
              size="icon-sm"
              onClick={() => void save()}
              disabled={saving || status === 'loading'}
              aria-label="保存手机号"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setDraft(phone);
                setEditing(false);
                setError('');
              }}
              disabled={saving}
              aria-label="取消编辑手机号"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="编辑手机号"
            disabled={status === 'loading'}
            onClick={() => {
              setDraft(phone);
              setEditing(true);
            }}
            className={cn(
              'inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
              layout === 'stacked' &&
                'justify-between rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3',
            )}
          >
            <span className="truncate">{phone || '未填写'}</span>
            <Pencil className="size-3.5 shrink-0" />
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-right text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
