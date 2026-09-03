'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SettingsDialog } from '@/components/settings';
import type { SettingsSection } from '@/lib/types/settings';

const SECTION_KEYS = new Set<string>(['background', 'live2d']);

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get('section');
  const initialSection = useMemo((): SettingsSection | undefined => {
    if (sectionParam && SECTION_KEYS.has(sectionParam)) {
      return sectionParam as SettingsSection;
    }
    return undefined;
  }, [sectionParam]);

  return (
    <div className="flex min-h-full w-full flex-col overflow-visible rounded-[22px] border border-black/[0.08] bg-[#f2f2f7] shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <SettingsDialog
        embedded
        open
        initialSection={initialSection}
        onOpenChange={(next) => {
          if (!next) router.push('/learn');
        }}
      />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[560px] items-center justify-center rounded-[22px] bg-[#f2f2f7] px-4 py-12">
          <div className="rounded-[15px] bg-white px-8 py-6 text-sm text-slate-500 shadow-sm">
            加载设置…
          </div>
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}
