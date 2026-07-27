'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { SiteProviderAdminRow, SiteProviderStatusResponse } from '@/lib/types/admin-site-providers';
import { backendJson } from '@/lib/utils/backend-api';

export type AdminSiteProviderKind = 'image' | 'tts' | 'web-search';

function mergeWithRegistry(
  kind: AdminSiteProviderKind,
  rows: SiteProviderAdminRow[] | undefined,
): SiteProviderAdminRow[] {
  const fromServer = rows ?? [];
  const map = new Map(fromServer.map((r) => [r.id, r]));
  const registryIds =
    kind === 'image'
      ? Object.keys(IMAGE_PROVIDERS)
      : kind === 'tts'
        ? Object.keys(TTS_PROVIDERS)
        : Object.keys(WEB_SEARCH_PROVIDERS);

  const ordered: SiteProviderAdminRow[] = registryIds.map((id) => {
    const hit = map.get(id);
    if (hit) return hit;
    return { id, hasApiKey: false, apiKeyLast4: null, baseUrl: null, models: null };
  });

  for (const r of fromServer) {
    if (!registryIds.includes(r.id)) ordered.push(r);
  }
  return ordered;
}

function titleFor(kind: AdminSiteProviderKind): string {
  switch (kind) {
    case 'image':
      return '图像生成';
    case 'tts':
      return '语音合成';
    case 'web-search':
      return '网络搜索';
    default:
      return '';
  }
}

function descriptionFor(kind: AdminSiteProviderKind): string {
  switch (kind) {
    case 'image':
      return '服务端为全站提供的图像生成 Key（用户可在设置里覆盖）。配置来自项目根目录 server-providers.yml 与 .env，修改后需重启服务。';
    case 'tts':
      return '服务端为全站提供的语音合成 Key。配置来源同上。';
    case 'web-search':
      return '服务端为全站提供的网络搜索（如 Tavily）。配置来源同上。';
    default:
      return '';
  }
}

function displayName(kind: AdminSiteProviderKind, id: string): string {
  if (kind === 'image') return IMAGE_PROVIDERS[id as keyof typeof IMAGE_PROVIDERS]?.name || id;
  if (kind === 'tts') return TTS_PROVIDERS[id as keyof typeof TTS_PROVIDERS]?.name || id;
  return WEB_SEARCH_PROVIDERS[id as keyof typeof WEB_SEARCH_PROVIDERS]?.name || id;
}

function hintFor(
  kind: AdminSiteProviderKind,
  id: string,
  hints: SiteProviderStatusResponse['envHints'] | undefined,
):
  | { apiKey: string; baseUrl: string; models?: string }
  | { apiKey: string; baseUrl: string }
  | undefined {
  if (!hints) return undefined;
  if (kind === 'image') return hints.image[id];
  if (kind === 'tts') return hints.tts[id];
  return hints.webSearch[id];
}

export function AdminSiteProvidersSection({ kind }: { kind: AdminSiteProviderKind }) {
  const [payload, setPayload] = useState<SiteProviderStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendJson<SiteProviderStatusResponse>('/api/admin/site-provider-status');
      setPayload(res);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const raw =
      kind === 'image' ? payload?.image : kind === 'tts' ? payload?.tts : payload?.webSearch;
    return mergeWithRegistry(kind, raw);
  }, [kind, payload]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载站点提供方状态…</p>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{titleFor(kind)}</CardTitle>
          <CardDescription>{descriptionFor(kind)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {kind === 'web-search' && payload?.tavilyRootEnvPresent ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>检测到 TAVILY_API_KEY</AlertTitle>
              <AlertDescription>
                根级环境变量 <code className="rounded bg-muted px-1 py-0.5 text-xs">TAVILY_API_KEY</code>{' '}
                已设置；在未写入 <code className="rounded bg-muted px-1 py-0.5 text-xs">server-providers.yml</code>{' '}
                时也会作为 Tavily 密钥使用。
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">提供方</th>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">密钥</th>
                  <th className="px-3 py-2 font-medium">Base URL</th>
                  {kind === 'image' ? (
                    <th className="px-3 py-2 font-medium">模型列表</th>
                  ) : null}
                  <th className="px-3 py-2 font-medium">环境变量（参考）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const hint = hintFor(kind, row.id, payload?.envHints);
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{displayName(kind, row.id)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                      <td className="px-3 py-2">
                        {row.hasApiKey ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            已配置{row.apiKeyLast4 ? `（后四位 ${row.apiKeyLast4}）` : ''}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未配置</span>
                        )}
                      </td>
                      <td className="px-3 py-2 break-all font-mono text-xs">
                        {row.baseUrl || '—'}
                      </td>
                      {kind === 'image' ? (
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.models?.length ? row.models.join(', ') : '—'}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-mono text-[11px] leading-snug text-muted-foreground">
                        {hint ? (
                          <span>
                            {hint.apiKey}
                            <br />
                            {hint.baseUrl}
                            {kind === 'image' && 'models' in hint && hint.models ? (
                              <>
                                <br />
                                {hint.models}
                              </>
                            ) : null}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            修改 <code className="rounded bg-muted px-1">server-providers.yml</code> 或对应{' '}
            <code className="rounded bg-muted px-1">.env.local</code> 后，请重启 Next 进程使配置生效。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
