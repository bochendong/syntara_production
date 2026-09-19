'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UsageContentDialog } from '@/components/admin/usage-content-dialog';
import { Button } from '@/components/ui/button';
import { backendJson } from '@/lib/utils/backend-api';
import { formatCreditsLabel, formatUsdLabel } from '@/lib/utils/credits';
import { AdminGlobalLlmConfigCard } from '@/components/admin/admin-global-llm-config-card';

type LLMUsageResponse = {
  summary: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    estimatedCostCredits: number;
  };
  rows: Array<{
    id: string;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    route: string;
    modelString: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    estimatedCostCredits: number | null;
    createdAt: string;
  }>;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function AdminLLMSection() {
  const PAGE_SIZE = 20;
  const [loading, setLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<LLMUsageResponse | null>(null);
  const [usagePage, setUsagePage] = useState(1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setUsageError(null);
    try {
      try {
        const usageResp = await backendJson<LLMUsageResponse>('/api/admin/llm-usage');
        setUsage(usageResp);
      } catch (usageLoadError) {
        setUsage(null);
        setUsageError(
          usageLoadError instanceof Error ? usageLoadError.message : String(usageLoadError),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const usageRows = useMemo(() => usage?.rows ?? [], [usage?.rows]);
  const usageTotalPages = Math.max(1, Math.ceil(usageRows.length / PAGE_SIZE));
  const usagePagedRows = useMemo(() => {
    const start = (usagePage - 1) * PAGE_SIZE;
    return usageRows.slice(start, start + PAGE_SIZE);
  }, [usagePage, usageRows]);

  useEffect(() => {
    setUsagePage(1);
  }, [usage?.rows]);

  useEffect(() => {
    if (usagePage > usageTotalPages) {
      setUsagePage(usageTotalPages);
    }
  }, [usagePage, usageTotalPages]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载语言模型配置…</p>;
  }

  return (
    <div className="space-y-6">
      <AdminGlobalLlmConfigCard />
      {usageError ? (
        <Alert>
          <AlertTitle>用量数据暂不可用</AlertTitle>
          <AlertDescription>{usageError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            用量汇总
          </CardTitle>
          <CardDescription>
            按 OpenAI GPT 公开价上浮 50% 估算用户侧扣费，方便对账和观察毛利空间。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">调用次数</div>
            <div className="mt-1 text-xl font-semibold">
              {formatNumber(usage?.summary.totalRequests || 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">输入 Tokens</div>
            <div className="mt-1 text-xl font-semibold">
              {formatNumber(usage?.summary.totalInputTokens || 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">输出 Tokens</div>
            <div className="mt-1 text-xl font-semibold">
              {formatNumber(usage?.summary.totalOutputTokens || 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">总 Tokens</div>
            <div className="mt-1 text-xl font-semibold">
              {formatNumber(usage?.summary.totalTokens || 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">预估用户扣费</div>
            <div className="mt-1 text-xl font-semibold">
              {formatUsdLabel(usage?.summary.estimatedCostUsd || 0)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">折合积分</div>
            <div className="mt-1 text-xl font-semibold">
              {formatCreditsLabel(usage?.summary.estimatedCostCredits || 0)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近用量明细</CardTitle>
          <CardDescription>按最近调用时间倒序。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">用户</th>
                  <th className="px-3 py-2 font-medium">路由</th>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">输入</th>
                  <th className="px-3 py-2 font-medium">输出</th>
                  <th className="px-3 py-2 font-medium">总计</th>
                  <th className="px-3 py-2 font-medium">预估扣费</th>
                  <th className="px-3 py-2 font-medium">内容</th>
                </tr>
              </thead>
              <tbody>
                {usagePagedRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {row.userName ||
                          row.userEmail ||
                          (row.userId ? '未设置姓名' : '系统任务（未关联用户）')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.userEmail && row.userEmail !== row.userName
                          ? row.userEmail
                          : row.userId || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.route}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.modelString}</td>
                    <td className="px-3 py-2">{formatNumber(row.inputTokens)}</td>
                    <td className="px-3 py-2">{formatNumber(row.outputTokens)}</td>
                    <td className="px-3 py-2 font-medium">{formatNumber(row.totalTokens)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.estimatedCostUsd != null ? formatUsdLabel(row.estimatedCostUsd) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <UsageContentDialog id={row.id} model={row.modelString} />
                    </td>
                  </tr>
                ))}
                {usageRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={9}>
                      暂无用量数据。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {usageRows.length > 0 ? (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                第 {usagePage} / {usageTotalPages} 页 · 共 {formatNumber(usageRows.length)} 条
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={usagePage <= 1}
                  onClick={() => setUsagePage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={usagePage >= usageTotalPages}
                  onClick={() => setUsagePage((p) => Math.min(usageTotalPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
