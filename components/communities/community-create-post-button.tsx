'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ImagePlus, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { ForumMarkdownEditor } from '@/components/course-forum/forum-markdown-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/notifications/client-toast';
import { backendFetch } from '@/lib/utils/backend-api';

async function requestError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function ImagePicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const addFiles = (nextFiles: File[]) => {
    onChange([...files, ...nextFiles].slice(0, 5));
  };

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-white/15 dark:bg-white/5">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        <ImagePlus className="size-4 text-violet-600" />
        添加图片
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP,.gif,.GIF"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.currentTarget.value = '';
          }}
        />
      </label>
      <p className="mt-1 text-xs text-slate-400">
        最多 5 张，单张不超过 5 MB；发布后统一显示在帖子正文下方。
      </p>
      {files.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <button
              type="button"
              key={`${file.name}-${file.size}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm dark:bg-white/10 dark:text-slate-200"
              onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
              title="点击移除"
            >
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CommunityCreatePostButton({
  communitySlug,
  disabled = false,
}: {
  communitySlug: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const submitPost = async () => {
    if (!title.trim() || !bodyMarkdown.trim() || submitting) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('bodyMarkdown', bodyMarkdown.trim());
      images.forEach((file) => form.append('images', file));
      const response = await backendFetch(
        `/api/communities/${encodeURIComponent(communitySlug)}/posts`,
        {
          method: 'POST',
          body: form,
          timeoutMs: 30_000,
        },
      );
      if (!response.ok) throw new Error(await requestError(response, '发布失败'));

      setOpen(false);
      setTitle('');
      setBodyMarkdown('');
      setImages([]);
      toast.success('帖子已发布');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="rounded-full"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1.5 size-4" />
        Create Post
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[96dvh] max-h-[1100px] w-[min(98vw,1540px)] max-w-none flex-col overflow-hidden p-0"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>发布 Community 帖子</DialogTitle>
            <DialogDescription>
              用 Markdown、代码块和数学公式完整描述内容；帖子只会出现在当前 community。
            </DialogDescription>
          </DialogHeader>
          <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4 z-10 size-8 shrink-0 rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="关闭"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
            <div className="pr-12">
              <label className="text-sm font-medium">标题</label>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="一句话说明你想发布的内容"
                maxLength={200}
                className="mt-2 rounded-xl"
              />
            </div>
            <ForumMarkdownEditor
              value={bodyMarkdown}
              onChange={setBodyMarkdown}
              placeholder={'支持 Markdown，例如：\n\n```python\na = [1, 2]\nb = a\n```'}
              className="min-h-[620px] lg:h-[calc(96dvh-260px)] lg:max-h-[800px]"
            />
          </div>
          <DialogFooter className="flex-col items-stretch gap-3 border-t border-slate-200 px-6 py-4 dark:border-white/10 sm:flex-col">
            <ImagePicker files={images} onChange={setImages} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                取消
              </Button>
              <Button
                className="bg-violet-600 hover:bg-violet-700"
                disabled={!title.trim() || !bodyMarkdown.trim() || submitting}
                onClick={() => void submitPost()}
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 size-4" />
                )}
                发布帖子
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
