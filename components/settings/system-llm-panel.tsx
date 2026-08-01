'use client';

import { useEffect, useMemo } from 'react';
import { Bot, Info, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/lib/store/settings';

export function SystemLLMPanel() {
  const providerId = useSettingsStore((s) => s.providerId);
  const modelId = useSettingsStore((s) => s.modelId);
  const setModel = useSettingsStore((s) => s.setModel);
  const provider = useSettingsStore((s) => s.providersConfig[s.providerId]);
  const availableModels = useMemo(() => {
    if (!provider) return [];
    let models = provider.models || [];
    // In server-managed mode without custom key, only allow admin-exposed models.
    if (provider.isServerConfigured && !provider.apiKey && provider.serverModels?.length) {
      const allowed = new Set(provider.serverModels);
      models = models.filter((m) => allowed.has(m.id));
    }
    return models;
  }, [provider]);

  useEffect(() => {
    if (!availableModels.length) return;
    if (!availableModels.some((m) => m.id === modelId)) {
      setModel(providerId, availableModels[0].id);
    }
  }, [availableModels, modelId, providerId, setModel]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            系统模型
          </CardTitle>
          <CardDescription>
            模型来源于管理员配置。你可以在管理员开放的模型范围内切换，API Key 仍由系统统一托管。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Provider: {provider?.name || providerId}</Badge>
            <Badge variant="secondary">Model: {modelId || 'gpt-5.6-terra'}</Badge>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              系统托管
            </Badge>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">选择模型（管理员开放范围）</p>
            <Select
              value={modelId}
              onValueChange={(nextModelId) => setModel(providerId, nextModelId)}
              disabled={!availableModels.length}
            >
              <SelectTrigger className="h-9 w-full max-w-md">
                <SelectValue placeholder="暂无可用模型" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                你的调用将统一走站点管理员配置的 OpenAI
                Key，系统会自动记录每位用户的使用量用于后续统计与计费。
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
