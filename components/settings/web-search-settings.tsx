'use client';

import { useSettingsStore } from '@/lib/store/settings';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { ShieldCheck } from 'lucide-react';

interface WebSearchSettingsProps {
  selectedProviderId: WebSearchProviderId;
}

export function WebSearchSettings({ selectedProviderId }: WebSearchSettingsProps) {
  const webSearchProvidersConfig = useSettingsStore((state) => state.webSearchProvidersConfig);

  const provider = WEB_SEARCH_PROVIDERS[selectedProviderId];
  const isServerConfigured = !!webSearchProvidersConfig[selectedProviderId]?.isServerConfigured;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {isServerConfigured
              ? `${provider.name} 凭据由 Syntara 内置 Keychain 统一托管，无需手动设置。`
              : '网络搜索服务暂不可用，请联系管理员。'}
          </span>
        </p>
      </div>
    </div>
  );
}
