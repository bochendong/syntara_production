'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, ShieldCheck, RotateCcw } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';
import { ADMIN_TEXT_MODEL_OPTIONS, type ChatTierModels } from '@/lib/ai/admin-model-options';
import { SYSTEM_CHAT_MODEL_BY_STRENGTH } from '@/lib/ai/system-model-policy';
import { CHAT_RESPONSE_STRENGTHS } from '@/lib/ai/chat-response-strength';

type SystemConfig = {
  modelId: string;
  tierModels: ChatTierModels;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  updatedAt: string | null;
};
const tierLabels = { low: '低强度', medium: '中强度', high: '高强度' };

function ModelSelect({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
      <div>
        <Label htmlFor={id} className="font-semibold">
          {label}
        </Label>
        <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!ADMIN_TEXT_MODEL_OPTIONS.some((model) => model.id === value) ? (
          <option value={value} disabled>
            {value}（原配置，请选择支持的模型）
          </option>
        ) : null}
        {ADMIN_TEXT_MODEL_OPTIONS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label} · {model.description}
          </option>
        ))}
      </select>
      <p className="font-mono text-[11px] text-muted-foreground">{value}</p>
    </div>
  );
}

export function AdminGlobalLlmConfigCard() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [modelId, setModelId] = useState('gpt-5.6-sol');
  const [tiers, setTiers] = useState<ChatTierModels>({ ...SYSTEM_CHAT_MODEL_BY_STRENGTH });
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const apply = useCallback((next: SystemConfig) => {
    setConfig(next);
    setModelId(next.modelId);
    setTiers(next.tierModels || { ...SYSTEM_CHAT_MODEL_BY_STRENGTH });
    setBaseUrl(next.baseUrl || 'https://api.openai.com/v1');
    setApiKey('');
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await backendJson<{ config: SystemConfig }>('/api/admin/llm-config');
      apply(payload.config);
    } catch {
      setError('配置加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    void load();
  }, [load]);
  const dirty = Boolean(
    config &&
    (modelId !== config.modelId ||
      baseUrl !== config.baseUrl ||
      apiKey ||
      CHAT_RESPONSE_STRENGTHS.some((key) => tiers[key] !== config.tierModels?.[key])),
  );
  const save = async () => {
    setSaving(true);
    try {
      const payload = await backendJson<{ config: SystemConfig }>('/api/admin/llm-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, tierModels: tiers, baseUrl, apiKey }),
      });
      apply(payload.config);
      toast.success('模型配置已保存，新请求立即生效');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        正在读取模型配置…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="rounded-xl border p-5">
        {error}
        <Button variant="outline" onClick={() => void load()}>
          重新加载
        </Button>
      </div>
    );
  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">模型分配</CardTitle>
          <CardDescription>
            为默认任务和三档聊天回复分别选择模型。修改后点击保存，新请求使用新的配置。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={saving} className="grid gap-4 lg:grid-cols-2">
            <ModelSelect
              id="default-model"
              label="默认模型"
              description="讲义、题库导入和其他通用 AI 任务使用。"
              value={modelId}
              onChange={setModelId}
            />
            {CHAT_RESPONSE_STRENGTHS.map((key) => (
              <ModelSelect
                key={key}
                id={`model-${key}`}
                label={tierLabels[key]}
                description={`用户选择「${tierLabels[key]}」聊天时使用，可按你的教学需求分配。`}
                value={tiers[key]}
                onChange={(value) => setTiers((old) => ({ ...old, [key]: value }))}
              />
            ))}
          </fieldset>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            候选项来自 OpenAI 官方模型目录；实际访问权限取决于当前
            Key。图像、语音等专用模型独立配置。
            <a
              className="ml-1 underline underline-offset-4"
              href="https://developers.openai.com/api/docs/models"
              target="_blank"
              rel="noreferrer"
            >
              查看模型说明
            </a>
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            全站连接
          </CardTitle>
          <CardDescription>各项 OpenAI 服务共用此 Key，密钥加密保存在服务端。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span>{config?.hasApiKey ? `已配置 ${config.maskedApiKey}` : '尚未配置 API Key'}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="system-api-key">更换 API Key</Label>
            <Input
              id="system-api-key"
              type="password"
              disabled={saving}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config?.hasApiKey ? '留空保留当前 Key' : '请输入 OpenAI API Key'}
              autoComplete="new-password"
            />
          </div>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">高级连接设置</summary>
            <div className="mt-3 space-y-2">
              <Label htmlFor="system-base-url">服务地址（Base URL）</Label>
              <Input
                id="system-base-url"
                disabled={saving}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
          </details>
        </CardContent>
      </Card>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-4 shadow-sm backdrop-blur">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {dirty
            ? '有未保存的修改'
            : config?.updatedAt
              ? `已保存 · ${new Date(config.updatedAt).toLocaleString('zh-CN')}`
              : '当前配置已加载'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              if (config) apply(config);
            }}
          >
            <RotateCcw className="mr-2 size-4" />
            撤销修改
          </Button>
          <Button disabled={!dirty || saving || !config} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            保存配置
          </Button>
        </div>
      </div>
    </div>
  );
}
