/** 管理员「站点提供方」状态 API 载荷（与 /api/admin/site-provider-status 一致） */
export interface SiteProviderAdminRow {
  id: string;
  hasApiKey: boolean;
  apiKeyLast4?: string | null;
  baseUrl?: string | null;
  models?: string[] | null;
}

export type AdminProviderEnvHints = {
  llm: Record<string, { apiKey: string; baseUrl: string; models: string }>;
  image: Record<string, { apiKey: string; baseUrl: string; models: string }>;
  tts: Record<string, { apiKey: string; baseUrl: string }>;
  webSearch: Record<string, { apiKey: string; baseUrl: string }>;
};

export type SiteProviderStatusResponse = {
  llm: SiteProviderAdminRow[];
  image: SiteProviderAdminRow[];
  tts: SiteProviderAdminRow[];
  webSearch: SiteProviderAdminRow[];
  envHints: AdminProviderEnvHints;
  tavilyRootEnvPresent: boolean;
};
