import { cn } from '@/lib/utils';

export const forumMarkdownDisplayClassName = cn(
  'text-[15px] leading-7 text-slate-700 dark:text-slate-200',
  '[&_[data-streamdown=code-block]]:my-4 [&_[data-streamdown=code-block]]:max-w-full [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-xl',
  '[&_[data-streamdown=code-block]]:border [&_[data-streamdown=code-block]]:border-slate-200 [&_[data-streamdown=code-block]]:bg-slate-50 [&_[data-streamdown=code-block]]:p-2 dark:[&_[data-streamdown=code-block]]:border-white/10 dark:[&_[data-streamdown=code-block]]:bg-slate-900/60',
  '[&_[data-streamdown=code-block-body]]:rounded-lg [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-white [&_[data-streamdown=code-block-body]]:p-3 [&_[data-streamdown=code-block-body]]:text-[13px] [&_[data-streamdown=code-block-body]]:leading-6 dark:[&_[data-streamdown=code-block-body]]:bg-slate-950',
  '[&_[data-streamdown=code-block-body]_pre]:m-0 [&_[data-streamdown=code-block-body]_pre]:overflow-x-auto [&_[data-streamdown=code-block-body]_pre]:border-0 [&_[data-streamdown=code-block-body]_pre]:bg-transparent [&_[data-streamdown=code-block-body]_pre]:p-0 [&_[data-streamdown=code-block-body]_pre]:text-inherit',
  '[&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-slate-900 dark:[&_pre]:border-white/10 dark:[&_pre]:bg-slate-950 dark:[&_pre]:text-slate-100',
);
