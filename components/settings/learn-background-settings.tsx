'use client';

import { Check } from 'lucide-react';
import { LearnBackgroundVisual } from '@/components/learn/learn-background-visual';
import { LEARN_BACKGROUNDS } from '@/lib/learn/learn-backgrounds';
import { useSettingsStore } from '@/lib/store/settings';
import { cn } from '@/lib/utils';

export function LearnBackgroundSettings() {
  const learnBackgroundId = useSettingsStore((state) => state.learnBackgroundId);
  const setLearnBackgroundId = useSettingsStore((state) => state.setLearnBackgroundId);

  return (
    <section aria-labelledby="learn-background-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#007aff]">Learn</p>
        <h3
          id="learn-background-title"
          className="mt-1 text-xl font-bold tracking-[-0.025em] text-slate-950"
        >
          学习界面背景
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          选择后会立即应用到学习主页和课程聊天界面，并保存在当前浏览器中。
        </p>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-800">静态背景</h4>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {LEARN_BACKGROUNDS.length} 款
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {LEARN_BACKGROUNDS.map((background) => {
            const selected = background.id === learnBackgroundId;
            return (
              <button
                key={background.id}
                type="button"
                onClick={() => setLearnBackgroundId(background.id)}
                className={cn(
                  'group overflow-hidden rounded-[16px] bg-white text-left outline-none ring-1 transition focus-visible:ring-2 focus-visible:ring-[#007aff]',
                  selected
                    ? 'ring-2 ring-[#007aff] shadow-[0_10px_26px_rgba(0,122,255,0.16)]'
                    : 'ring-black/[0.08] hover:-translate-y-0.5 hover:shadow-lg hover:ring-black/[0.14]',
                )}
                aria-pressed={selected}
              >
                <span className="relative block aspect-[16/9] overflow-hidden bg-slate-100">
                  <LearnBackgroundVisual
                    backgroundId={background.id}
                    preview
                    className="absolute inset-0 transition duration-300 group-hover:scale-[1.025]"
                  />
                  {selected ? (
                    <span className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-[#007aff] text-white shadow-md">
                      <Check className="size-4" strokeWidth={2.6} aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span className="flex min-h-[68px] items-start justify-between gap-3 px-3.5 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      {background.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {background.description}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'mt-1 size-2.5 shrink-0 rounded-full ring-2 ring-white',
                      background.tone === 'dark' ? 'bg-indigo-600' : 'bg-sky-300',
                    )}
                    aria-hidden
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
