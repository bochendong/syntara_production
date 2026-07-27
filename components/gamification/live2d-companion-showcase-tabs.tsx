'use client';

import { Heart, ImageIcon, Mic2, Palette, Star, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComponentType } from 'react';
import type { ShowcasePanelId } from '@/components/gamification/live2d-companion-data';

const SHOWCASE_PANEL_TABS: Array<{
  id: ShowcasePanelId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: 'mentor-info', label: '导师信息', icon: User },
  { id: 'benefit', label: '收益效果', icon: Heart },
  { id: 'voice', label: '语音包', icon: Mic2 },
  { id: 'motion', label: '动作', icon: Star },
  { id: 'skin', label: '皮肤', icon: Palette },
  { id: 'stage-background', label: '舞台背景', icon: ImageIcon },
];

export function Live2DCompanionShowcaseTabs({
  activePanel,
  onChange,
}: {
  activePanel: ShowcasePanelId;
  onChange: (panel: ShowcasePanelId) => void;
}) {
  return (
    <div className="absolute left-2 top-1/2 z-30 -translate-y-1/2 md:left-4">
      <div className="flex flex-col gap-2">
        {SHOWCASE_PANEL_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-[0_10px_28px_rgba(15,23,42,0.25)] backdrop-blur-xl transition-colors',
                activePanel === tab.id
                  ? 'border-sky-200/45 bg-sky-300/18 text-sky-50'
                  : 'border-white/18 bg-slate-950/34 text-slate-100 hover:bg-slate-900/52',
              )}
              onClick={() => onChange(tab.id)}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
