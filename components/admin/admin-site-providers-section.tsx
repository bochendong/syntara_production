'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Image as ImageIcon, Info, Search, Volume2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type {
  SiteProviderAdminRow,
  SiteProviderStatusResponse,
} from '@/lib/types/admin-site-providers';
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
      return '服务端为全站统一提供图像生成服务，普通用户不能切换或覆盖。配置来自项目根目录 server-providers.yml 与 .env，修改后需重启服务。';
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
  const [query, setQuery] = useState('');
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
      <div>
        <AdminPageHeader title={titleFor(kind)} description="查看全站服务提供方的配置状态。" />
        <Alert variant="destructive">
          <AlertTitle>配置状态读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <p className="mt-4 text-sm text-muted-foreground">
          若本地连接远程数据库，请确认 SYSTEM_CONFIG_ENCRYPTION_KEY 与部署环境一致。
        </p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          重新读取状态
        </Button>
      </div>
    );
  }

  const visibleRows = rows.filter((row) =>
    (displayName(kind, row.id) + ' ' + row.id).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const configuredCount = rows.filter((row) => row.hasApiKey).length;
  const Icon = kind === 'image' ? ImageIcon : kind === 'tts' ? Volume2 : Search;
  return (
    <div>
      <AdminPageHeader
        title={titleFor(kind)}
        description={
          kind === 'image'
            ? '查看图像生成服务的连接状态、模型和提供方配置。'
            : kind === 'tts'
              ? '查看语音合成服务的连接状态与提供方配置。'
              : '查看网络搜索服务的连接状态与提供方配置。'
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
            <div>
              <h2 className="text-base font-semibold">服务提供方</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {configuredCount} / {rows.length} 已配置
              </p>
            </div>
            <Input
              aria-label="搜索服务提供方"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提供方…"
              className="w-full sm:w-52"
            />
          </div>
          <div className="divide-y">
            {visibleRows.map((row) => {
              const hint = hintFor(kind, row.id, payload?.envHints);
              return (
                <article key={row.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary">
                        <Icon className="size-5" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">{displayName(kind, row.id)}</h3>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{row.id}</p>
                      </div>
                    </div>
                    <span
                      className={
                        row.hasApiKey
                          ? 'flex items-center gap-1.5 text-xs text-primary'
                          : 'flex items-center gap-1.5 text-xs text-muted-foreground'
                      }
                    >
                      {row.hasApiKey ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <Circle className="size-3.5" />
                      )}
                      {row.hasApiKey ? '密钥已配置' : '未配置密钥'}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-[90px_minmax(0,1fr)]">
                    <dt className="text-muted-foreground">服务地址</dt>
                    <dd className="break-all font-mono">{row.baseUrl || '使用提供方默认地址'}</dd>
                    {row.hasApiKey && row.apiKeyLast4 ? (
                      <>
                        <dt className="text-muted-foreground">密钥标识</dt>
                        <dd className="font-mono">•••• {row.apiKeyLast4}</dd>
                      </>
                    ) : null}
                    {kind === 'image' ? (
                      <>
                        <dt className="text-muted-foreground">可用模型</dt>
                        <dd className="flex flex-wrap gap-1.5">
                          {row.models?.length
                            ? row.models.map((model) => (
                                <span
                                  key={model}
                                  className="rounded-md bg-muted/50 px-2 py-1 font-mono"
                                >
                                  {model}
                                </span>
                              ))
                            : '未声明模型列表'}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {hint ? (
                    <details className="mt-4 border-t pt-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        配置变量
                      </summary>
                      <div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3 font-mono text-xs">
                        <p>{hint.apiKey}</p>
                        <p>{hint.baseUrl}</p>
                        {'models' in hint && hint.models ? <p>{hint.models}</p> : null}
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
            {!visibleRows.length ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                没有匹配的服务提供方
              </p>
            ) : null}
          </div>
        </section>
        <aside className="space-y-4">
          <section className="rounded-xl border p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Info className="size-4 text-primary" />
              配置说明
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">{descriptionFor(kind)}</p>
            <p className="mt-4 border-t pt-4 text-xs leading-6 text-muted-foreground">
              修改 <code className="font-mono">server-providers.yml</code>{' '}
              或对应环境变量后，重启服务使配置生效。此页面显示配置状态，不代表已通过连接测试。
            </p>
          </section>
          {kind === 'web-search' && payload?.tavilyRootEnvPresent ? (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>Tavily 环境变量已配置</AlertTitle>
              <AlertDescription>
                检测到 TAVILY_API_KEY，可作为 Tavily 搜索服务的密钥。
              </AlertDescription>
            </Alert>
          ) : null}
          <Button variant="outline" className="w-full" onClick={() => void load()}>
            重新读取状态
          </Button>
        </aside>
      </div>
    </div>
  );
}
