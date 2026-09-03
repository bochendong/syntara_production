'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';

type SystemConfig = {
  providerId: 'openai';
  modelId: string;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: 'database' | 'environment';
  updatedAt: string | null;
};

export function AdminGlobalLlmConfigCard() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [modelId, setModelId] = useState('gpt-5.6-terra');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await backendJson<{ config: SystemConfig }>('/api/admin/llm-config');
      setConfig(payload.config);
      setModelId(payload.config.modelId);
      setBaseUrl(payload.config.baseUrl || 'https://api.openai.com/v1');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '全站模型配置加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = await backendJson<{ config: SystemConfig }>('/api/admin/llm-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, baseUrl, apiKey }),
      });
      setConfig(payload.config);
      setApiKey('');
      toast.success('全站 API Key 已加密保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-4xl border-emerald-200/70 dark:border-emerald-300/15">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-600" />
          全站 OpenAI API Key 与默认模型
        </CardTitle>
        <CardDescription>
          保存后供全站 OpenAI 语言、图像和语音能力统一使用。Key
          会加密保存且只在服务端解密，浏览器只能看到掩码。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取全站配置…</p>
        ) : (
          <>
            <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className={config?.hasApiKey ? 'text-emerald-600' : 'text-amber-600'}>
                  {config?.hasApiKey ? `已配置 ${config.maskedApiKey}` : '尚未配置 API Key'}
                </span>
                <span className="text-muted-foreground">
                  来源：{config?.source === 'database' ? 'Railway PostgreSQL' : 'Vercel 环境变量'}
                </span>
                {config?.updatedAt ? (
                  <span className="text-muted-foreground">
                    更新：{new Date(config.updatedAt).toLocaleString('zh-CN')}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="system-model-id">模型 ID</Label>
                <Input
                  id="system-model-id"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system-base-url">Base URL</Label>
                <Input
                  id="system-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="system-api-key">OpenAI API Key</Label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="system-api-key"
                    type="password"
                    className="pl-9"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={config?.hasApiKey ? '留空则保留当前 Key' : '首次保存必须填写'}
                    autoComplete="new-password"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !modelId.trim()}
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  保存
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
