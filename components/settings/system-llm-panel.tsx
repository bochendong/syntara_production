'use client';

import { useEffect, useMemo } from 'react';
import { BookOpenCheck, Bot, Info, ShieldCheck } from 'lucide-react';
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
import { useOrchestratorNotebookGenStore } from '@/lib/store/orchestrator-notebook-generation';
import {
  NOTEBOOK_MODEL_PRESET_FULL,
  NOTEBOOK_MODEL_PRESET_MINI,
} from '@/lib/constants/notebook-generation-model-presets';
import { NOTEBOOK_GENERATION_MODEL_STAGES } from '@/lib/constants/notebook-generation-model-stages';

export function SystemLLMPanel() {
  const providerId = useSettingsStore((s) => s.providerId);
  const modelId = useSettingsStore((s) => s.modelId);
  const setModel = useSettingsStore((s) => s.setModel);
  const provider = useSettingsStore((s) => s.providersConfig[s.providerId]);
  const notebookModelMode = useOrchestratorNotebookGenStore((s) => s.notebookModelMode);
  const setNotebookModelMode = useOrchestratorNotebookGenStore((s) => s.setNotebookModelMode);
  const notebookModelOverride = useOrchestratorNotebookGenStore((s) => s.modelIdOverride);
  const setNotebookModelOverride = useOrchestratorNotebookGenStore((s) => s.setModelIdOverride);
  const setNotebookStageModelOverride = useOrchestratorNotebookGenStore(
    (s) => s.setNotebookStageModelOverride,
  );
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
  const notebookModelId =
    notebookModelMode === 'recommended'
      ? NOTEBOOK_MODEL_PRESET_MINI
      : notebookModelMode === 'max'
        ? NOTEBOOK_MODEL_PRESET_FULL
        : notebookModelOverride?.trim() || modelId;

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
            日常语言模型
          </CardTitle>
          <CardDescription>
            老师备课、学生学习与聊天默认使用 GPT-5.6 Luna。你可以在管理员开放的模型范围内切换。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Provider: {provider?.name || providerId}</Badge>
            <Badge variant="secondary">Model: {modelId || 'gpt-5.6-luna'}</Badge>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-4 w-4" />
            笔记本整理模型
          </CardTitle>
          <CardDescription>
            将课程资料整理成笔记本时默认使用 GPT-5.6 Terra，与上方日常语言模型相互独立。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Provider: {provider?.name || providerId}</Badge>
            <Badge variant="secondary">Model: {notebookModelId}</Badge>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              系统托管
            </Badge>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              选择整理模型（管理员开放范围）
            </p>
            <Select
              value={notebookModelId}
              onValueChange={(nextModelId) => {
                setNotebookModelMode('custom');
                setNotebookModelOverride(nextModelId);
                for (const stage of NOTEBOOK_GENERATION_MODEL_STAGES) {
                  setNotebookStageModelOverride(stage, null);
                }
              }}
              disabled={!availableModels.length}
            >
              <SelectTrigger className="h-9 w-full max-w-md">
                <SelectValue placeholder="暂无可用模型" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name || model.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                在这里切换会统一应用到标题、角色、大纲、页面内容与讲解口播。生成页仍可继续使用分阶段高级设置。
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
