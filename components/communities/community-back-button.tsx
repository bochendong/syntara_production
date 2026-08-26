'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export function CommunityBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="absolute top-4 left-4 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/70 bg-white/85 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-950 dark:border-white/10 dark:bg-slate-950/75 dark:text-slate-200 dark:hover:bg-slate-900"
      aria-label="返回上一页"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push('/communities');
        }
      }}
    >
      <ArrowLeft className="size-5" />
    </button>
  );
}
