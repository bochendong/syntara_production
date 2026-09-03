'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parsePhoneNumber, phoneLastFour } from '@/lib/profile/phone';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { backendJson } from '@/lib/utils/backend-api';

type MeProfile = {
  phone: string | null;
};

export function ProfilePhoneEditor() {
  const { status } = useSession();
  const phone = useUserProfileStore((state) => state.phone);
  const setPhone = useUserProfileStore((state) => state.setPhone);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return;
    void backendJson<MeProfile>('/api/me')
      .then((profile) => {
        setPhone(profile.phone || '');
        setDraft(profile.phone || '');
      })
      .catch(() => undefined);
  }, [setPhone, status]);

  const save = async () => {
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
    <div className="border-t border-slate-100 px-4 py-3.5">
      <div className="flex min-w-0 items-center justify-between gap-6 text-sm">
        <div>
          <p className="font-medium text-slate-800">手机号</p>
          <p className="mt-0.5 text-xs text-slate-400">
            老师只能看到后四位{phoneLastFour(phone) ? ` · 当前尾号 ${phoneLastFour(phone)}` : ''}
          </p>
        </div>
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
                if (event.key === 'Escape') {
                  setDraft(phone);
                  setEditing(false);
                  setError('');
                }
              }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="输入手机号"
              aria-label="手机号"
              className="h-9 max-w-64"
            />
            <Button
              size="icon-sm"
              onClick={() => void save()}
              disabled={saving}
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
            onClick={() => {
              setDraft(phone);
              setEditing(true);
            }}
            className="inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <span className="truncate">{phone || '未填写'}</span>
            <Pencil className="size-3.5 shrink-0" />
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-right text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
