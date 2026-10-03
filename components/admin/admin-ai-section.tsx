'use client';

import { useState } from 'react';
import { Bot, Image as ImageIcon, Search, Volume2 } from 'lucide-react';
import { AdminGlobalLlmConfigCard } from '@/components/admin/admin-global-llm-config-card';
import { AdminSiteProvidersSection } from '@/components/admin/admin-site-providers-section';
import { cn } from '@/lib/utils';

const PANELS = [
  { id: 'models', label: '模型设置', description: '模型与服务连接', icon: Bot },
  { id: 'image', label: '图像生成', description: '图像服务状态', icon: ImageIcon },
  { id: 'tts', label: '语音合成', description: '语音服务状态', icon: Volume2 },
  { id: 'web-search', label: '网络搜索', description: '搜索服务状态', icon: Search },
] as const;

type PanelId = (typeof PANELS)[number]['id'];

export function AdminAiSection() {
  const [panel, setPanel] = useState<PanelId>('models');

  return (
    <div className="grid min-h-[640px] items-stretch gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside
        aria-label="AI 设置"
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background/40"
      >
        <div className="border-b px-4 py-4 text-xs text-muted-foreground">
          共 {PANELS.length} 项设置
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {PANELS.map((item) => {
            const Icon = item.icon;
            const selected = panel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPanel(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-primary',
                  selected ? 'bg-primary/10' : 'hover:bg-muted/50',
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      <section aria-label="AI 设置详情" className="h-full min-w-0 rounded-xl border p-5 lg:p-6">
        {panel === 'models' ? <AdminGlobalLlmConfigCard /> : null}
        {panel === 'image' ? <AdminSiteProvidersSection kind="image" /> : null}
        {panel === 'tts' ? <AdminSiteProvidersSection kind="tts" /> : null}
        {panel === 'web-search' ? <AdminSiteProvidersSection kind="web-search" /> : null}
      </section>
    </div>
  );
}
