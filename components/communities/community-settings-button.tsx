'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, Send, Settings, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/notifications/client-toast';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type CommunitySettingsPayload = {
  community: {
    id: string;
    slug: string;
    name: string;
    welcomeText: string;
    description: string;
    bannerUrl: string;
    avatarUrl: string;
    visibility: 'public' | 'private';
    viewerRole: 'admin' | 'member';
  };
  members: CommunityMember[];
};

type CommunityMember = {
  userId: string;
  name: string;
  email: string;
  image: string;
  role: 'admin' | 'member';
  locked: boolean;
  joinedAt: string;
};

type InviteSearchUser = {
  id: string;
  name: string;
  email: string;
  image: string;
};

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '用户';
}

function isImageFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    file.type.startsWith('image/') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.webp')
  );
}

async function loadImage(file: File) {
  if (!isImageFile(file)) {
    throw new Error('请选择图片文件');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('图片不能超过 8 MB');
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = sourceUrl;
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function cropBannerImage(file: File) {
  const image = await loadImage(file);

  const targetWidth = 1600;
  const targetHeight = 448;
  const targetRatio = targetWidth / targetHeight;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片裁剪');

  let sourceWidth = image.naturalWidth;
  let sourceHeight = Math.round(sourceWidth / targetRatio);
  let sourceX = 0;
  const sourceY = 0;

  if (sourceHeight > image.naturalHeight) {
    sourceHeight = image.naturalHeight;
    sourceWidth = Math.round(sourceHeight * targetRatio);
    sourceX = Math.max(0, Math.round((image.naturalWidth - sourceWidth) / 2));
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  if (!blob) throw new Error('图片裁剪失败');
  return new File([blob], 'community-banner.jpg', { type: 'image/jpeg' });
}

async function cropAvatarImage(file: File) {
  const image = await loadImage(file);
  const targetSize = 512;
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, Math.round((image.naturalWidth - sourceSize) / 2));
  const sourceY = Math.max(0, Math.round((image.naturalHeight - sourceSize) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片裁剪');
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    targetSize,
    targetSize,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) throw new Error('图片裁剪失败');
  return new File([blob], 'community-avatar.jpg', { type: 'image/jpeg' });
}

export function CommunitySettingsButton({
  communitySlug,
  children,
  triggerClassName,
  triggerLabel = 'Community 设置',
}: {
  communitySlug: string;
  children?: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'members' | 'invite'>('basic');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [settings, setSettings] = useState<CommunitySettingsPayload | null>(null);
  const [name, setName] = useState('');
  const [welcomeText, setWelcomeText] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<InviteSearchUser[]>([]);
  const [searching, setSearching] = useState(false);

  const settingsPath = useMemo(
    () => `/api/communities/${encodeURIComponent(communitySlug)}/settings`,
    [communitySlug],
  );

  const loadSettings = async () => {
    setLoading(true);
    try {
      const payload = await backendJson<CommunitySettingsPayload>(settingsPath);
      setSettings(payload);
      setName(payload.community.name);
      setWelcomeText(payload.community.welcomeText);
      setDescription(payload.community.description);
      setBannerUrl(payload.community.bannerUrl);
      setAvatarUrl(payload.community.avatarUrl);
      setVisibility(payload.community.visibility);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settingsPath]);

  useEffect(() => {
    if (!open || activeTab !== 'invite') return;
    const q = inviteQuery.trim();
    if (q.length < 2) {
      setInviteResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const payload = await backendJson<{ users: InviteSearchUser[] }>(
          `/api/communities/${encodeURIComponent(communitySlug)}/invite-search?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled) setInviteResults(payload.users);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '搜索失败');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, communitySlug, inviteQuery, open]);

  const saveBasic = async () => {
    if (!name.trim() || saving) return;
    setSaving('basic');
    try {
      await backendJson(settingsPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          welcomeText: welcomeText.trim(),
          description: description.trim(),
          visibility,
        }),
      });
      toast.success('Community 设置已保存');
      await loadSettings();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving('');
    }
  };

  const uploadBanner = async (file: File | null) => {
    if (!file || saving) return;
    setSaving('banner');
    try {
      const cropped = await cropBannerImage(file);
      const formData = new FormData();
      formData.set('kind', 'banner');
      formData.set('image', cropped, 'community-banner.jpg');
      const payload = await backendJson<{ bannerUrl: string }>(
        `/api/communities/${encodeURIComponent(communitySlug)}/assets`,
        {
          method: 'POST',
          body: formData,
        },
      );
      setBannerUrl(payload.bannerUrl);
      toast.success('封面图已更新');
      await loadSettings();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '封面图上传失败');
    } finally {
      setSaving('');
    }
  };

  const uploadAvatar = async (file: File | null) => {
    if (!file || saving) return;
    setSaving('avatar');
    try {
      const cropped = await cropAvatarImage(file);
      const formData = new FormData();
      formData.set('kind', 'avatar');
      formData.set('image', cropped, 'community-avatar.jpg');
      const payload = await backendJson<{ avatarUrl: string }>(
        `/api/communities/${encodeURIComponent(communitySlug)}/assets`,
        {
          method: 'POST',
          body: formData,
        },
      );
      setAvatarUrl(payload.avatarUrl);
      toast.success('Community 头像已更新');
      await loadSettings();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '头像上传失败');
    } finally {
      setSaving('');
    }
  };

  const updateMemberRole = async (member: CommunityMember, nextRole: 'admin' | 'member') => {
    if (member.locked || member.role === nextRole || saving) return;
    setSaving(`role:${member.userId}`);
    try {
      await backendJson(
        `/api/communities/${encodeURIComponent(communitySlug)}/members/${encodeURIComponent(
          member.userId,
        )}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      await loadSettings();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '身份修改失败');
    } finally {
      setSaving('');
    }
  };

  const removeMember = async (member: CommunityMember) => {
    if (member.locked || saving) return;
    setSaving(`remove:${member.userId}`);
    try {
      await backendJson(
        `/api/communities/${encodeURIComponent(communitySlug)}/members/${encodeURIComponent(
          member.userId,
        )}`,
        { method: 'DELETE' },
      );
      toast.success('成员已删除');
      await loadSettings();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving('');
    }
  };

  const sendInvite = async (user: InviteSearchUser) => {
    if (saving) return;
    setSaving(`invite:${user.id}`);
    try {
      await backendJson(`/api/communities/${encodeURIComponent(communitySlug)}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      toast.success('邀请已通过私信发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邀请失败');
    } finally {
      setSaving('');
    }
  };

  return (
    <>
      {children ? (
        <button
          type="button"
          className={triggerClassName}
          onClick={() => setOpen(true)}
          aria-label={triggerLabel}
        >
          {children}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={() => setOpen(true)}
          aria-label={triggerLabel}
        >
          <Settings className="size-4" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,860px)] max-w-none flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
            <DialogTitle>Community 设置</DialogTitle>
            <DialogDescription>编辑基本信息、成员权限和邀请。</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 sm:grid-cols-[180px_minmax(0,1fr)]">
            <nav className="flex gap-2 overflow-x-auto border-b bg-slate-50 p-3 dark:bg-white/[0.03] sm:flex-col sm:border-r sm:border-b-0">
              {[
                ['basic', '基本信息'],
                ['members', '成员'],
                ['invite', '邀请'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key as typeof activeTab)}
                  className={cn(
                    'rounded-xl px-3 py-2 text-left text-sm font-semibold transition',
                    activeTab === key
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/10',
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 overflow-y-auto p-5">
              {loading ? (
                <div className="grid min-h-72 place-items-center text-slate-500">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              ) : activeTab === 'basic' ? (
                <div className="space-y-5">
                  <label className="block">
                    <span className="text-sm font-semibold">Community Name</span>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-2"
                      maxLength={120}
                    />
                  </label>
                  <div>
                    <span className="text-sm font-semibold">Community 封面图</span>
                    <div className="mt-2 overflow-hidden rounded-2xl border bg-slate-100 dark:border-white/10 dark:bg-slate-900">
                      {bannerUrl ? (
                        <img src={bannerUrl} alt="" className="h-40 w-full object-cover" />
                      ) : (
                        <div className="grid h-40 place-items-center text-sm text-slate-500">
                          暂无封面图
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="file"
                        accept="image/*,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"
                        disabled={Boolean(saving)}
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          event.target.value = '';
                          void uploadBanner(file);
                        }}
                      />
                      {saving === 'banner' ? (
                        <Loader2 className="size-5 shrink-0 animate-spin text-slate-500" />
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-semibold">Community 头像</span>
                    <div className="mt-2 flex items-center gap-4">
                      <Avatar className="size-20 border bg-white dark:bg-slate-950">
                        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
                        <AvatarFallback className="bg-violet-100 text-lg font-semibold text-violet-700">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <Input
                          type="file"
                          accept="image/*,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"
                          disabled={Boolean(saving)}
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            event.target.value = '';
                            void uploadAvatar(file);
                          }}
                        />
                      </div>
                      {saving === 'avatar' ? (
                        <Loader2 className="size-5 shrink-0 animate-spin text-slate-500" />
                      ) : null}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-sm font-semibold">右侧栏欢迎语</span>
                    <Input
                      value={welcomeText}
                      onChange={(event) => setWelcomeText(event.target.value)}
                      className="mt-2"
                      maxLength={200}
                      placeholder={`欢迎来到 c/${name || 'community'}`}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold">右侧栏介绍语</span>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      className="mt-2 min-h-32"
                      maxLength={600}
                    />
                  </label>
                  <div>
                    <p className="text-sm font-semibold">Privacy</p>
                    <div className="mt-2 inline-flex rounded-xl border bg-white p-1 dark:bg-white/5">
                      {[
                        ['public', 'Public'],
                        ['private', 'Private'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setVisibility(value as 'public' | 'private')}
                          className={cn(
                            'rounded-lg px-4 py-2 text-sm font-semibold transition',
                            visibility === value
                              ? 'bg-violet-600 text-white'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : activeTab === 'members' ? (
                <div className="space-y-3">
                  {settings?.members.map((member) => (
                    <div
                      key={member.userId}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border p-3"
                    >
                      <Avatar className="size-10">
                        {member.image ? <AvatarImage src={member.image} alt={member.name} /> : null}
                        <AvatarFallback>{initials(member.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{member.name}</p>
                        <p className="truncate text-xs text-slate-500">{member.email}</p>
                      </div>
                      <select
                        value={member.role}
                        disabled={member.locked || Boolean(saving)}
                        onChange={(event) =>
                          void updateMemberRole(member, event.target.value as 'admin' | 'member')
                        }
                        className="h-9 rounded-lg border bg-white px-2 text-sm dark:bg-slate-950"
                      >
                        <option value="member">成员</option>
                        <option value="admin">管理者</option>
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={member.locked || Boolean(saving)}
                        onClick={() => void removeMember(member)}
                        aria-label="删除成员"
                      >
                        {saving === `remove:${member.userId}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={inviteQuery}
                      onChange={(event) => setInviteQuery(event.target.value)}
                      placeholder="搜索用户名称或邮箱"
                      className="pl-9"
                    />
                  </div>
                  {searching ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="size-4 animate-spin" />
                      搜索中
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {inviteResults.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 rounded-2xl border p-3"
                      >
                        <Avatar className="size-10">
                          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
                          <AvatarFallback>{initials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{user.name}</p>
                          <p className="truncate text-xs text-slate-500">{user.email}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="bg-violet-600 hover:bg-violet-700"
                          disabled={Boolean(saving)}
                          onClick={() => void sendInvite(user)}
                        >
                          {saving === `invite:${user.id}` ? (
                            <Loader2 className="mr-1.5 size-4 animate-spin" />
                          ) : (
                            <Send className="mr-1.5 size-4" />
                          )}
                          邀请
                        </Button>
                      </div>
                    ))}
                  </div>
                  {inviteQuery.trim().length >= 2 && !searching && inviteResults.length === 0 ? (
                    <p className="text-sm text-slate-500">没有可邀请的用户。</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={Boolean(saving)}>
              关闭
            </Button>
            {activeTab === 'basic' ? (
              <Button
                className="bg-violet-600 hover:bg-violet-700"
                disabled={!name.trim() || Boolean(saving)}
                onClick={() => void saveBasic()}
              >
                {saving === 'basic' ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                保存
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
