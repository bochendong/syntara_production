'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { backendJson } from '@/lib/utils/backend-api';

type CreateCommunityResponse = {
  community: {
    slug: string;
  };
};

function normalizeCommunitySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function CommunityCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackSlug] = useState(() => `community-${Math.random().toString(36).slice(2, 8)}`);

  const resolvedSlug = useMemo(
    () => slug || normalizeCommunitySlug(name) || fallbackSlug,
    [fallbackSlug, name, slug],
  );
  const canSubmit = name.trim().length >= 2 && !submitting;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = await backendJson<CreateCommunityResponse>('/api/communities', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: resolvedSlug,
          description: description.trim(),
          privacy,
        }),
      });
      setOpen(false);
      router.push(`/communities/${encodeURIComponent(payload.community.slug)}`);
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '新建 Community 失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl">
          <Plus className="mr-1.5 size-4" />
          新建 Community
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,520px)] rounded-[24px] p-6">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>新建 Community</DialogTitle>
            <DialogDescription>创建后你会自动成为管理者。</DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="community-name">名称</Label>
              <Input
                id="community-name"
                value={name}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setName(nextName);
                  if (!slugTouched) setSlug(normalizeCommunitySlug(nextName));
                }}
                placeholder="例如 Study Lounge"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="community-slug">链接</Label>
              <Input
                id="community-slug"
                value={resolvedSlug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(normalizeCommunitySlug(event.target.value));
                }}
                placeholder="study-lounge"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="community-description">介绍</Label>
              <Textarea
                id="community-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="简单介绍这个 community"
                maxLength={600}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>权限</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPrivacy('public')}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-sm transition',
                    privacy === 'public'
                      ? 'border-violet-300 bg-violet-50 text-violet-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="block font-semibold">Public</span>
                  <span className="mt-0.5 block text-xs opacity-70">任何人可以加入</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrivacy('private')}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-sm transition',
                    privacy === 'private'
                      ? 'border-violet-300 bg-violet-50 text-violet-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="block font-semibold">Private</span>
                  <span className="mt-0.5 block text-xs opacity-70">需要邀请才能加入</span>
                </button>
              </div>
            </div>
            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={!canSubmit} className="rounded-xl">
              {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
