/** Disposable browser-only fixture for the 管理 page. Loopback dev server only; all data is fake. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppNavigationRail } from '../src/components/AppNavigationRail';
import { AppNavigationContext } from '../src/components/app-navigation-context';
import { AdminPage } from '../src/components/AdminPage';
import { setBrowserAccount } from '../src/data/browser-runtime';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/compact-layout.css';
import '../src/components/avatar-theme.css';
import '../src/components/global-calendar.css';

if (
  !import.meta.env.DEV ||
  '__TAURI_INTERNALS__' in window ||
  !['127.0.0.1', 'localhost'].includes(location.hostname)
) {
  throw new Error('This fixture is restricted to a disposable loopback browser preview.');
}

setBrowserAccount('qa-admin');
const noop = () => undefined;
const compact = window.innerWidth <= 1099;
const M = 1_000_000;
const option = (
  id: string,
  label: string,
  description: string,
  price: [number, number, number],
  week: [number, number, number] | null,
) => ({
  id,
  label,
  description,
  contextWindow: 1_050_000,
  outputWindow: 128_000,
  capabilities: { vision: true, tools: true, thinking: true },
  pricing: { inputUsdPerMillion: price[0], cachedInputUsdPerMillion: price[1], outputUsdPerMillion: price[2] },
  weekUsage: week
    ? { requestCount: week[0], inputTokens: week[1], outputTokens: week[2], estimatedCostUsd: 0 }
    : { requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
});
const modelOptions = [
  option('gpt-6-astra', 'GPT-6 Astra', '复杂推理与高难度任务', [10, 1, 50], null),
  option('gpt-6-sol', 'GPT-6 Sol', '复杂编程与多步骤任务', [2, 0.2, 10], [412, 3.1 * M, 0.62 * M]),
  option('gpt-6-luna', 'GPT-6 Luna', '日常问答与高频任务', [0.1, 0.01, 0.5], null),
  option('gpt-5.6-sol', 'GPT-5.6 Sol', '综合分析与专业任务', [5, 0.5, 30], null),
  option('gpt-5.6-terra', 'GPT-5.6 Terra', '能力与成本平衡', [2.5, 0.25, 15], [1830, 12.4 * M, 2.2 * M]),
  option('gpt-5.6-luna', 'GPT-5.6 Luna', '轻量问答与批量任务', [1, 0.1, 6], [36, 0.2 * M, 0.04 * M]),
  option('gpt-5.4', 'GPT-5.4', '通用推理与编程', [2.5, 0.25, 15], null),
  option('gpt-5.4-mini', 'GPT-5.4 Mini', '轻量推理', [0.75, 0.075, 4.5], [5210, 18.9 * M, 3.4 * M]),
  option('gpt-5.4-nano', 'GPT-5.4 Nano', '简单高频任务', [0.2, 0.02, 1.25], null),
];
for (const o of modelOptions) {
  const w = o.weekUsage;
  w.estimatedCostUsd =
    ((w.inputTokens * o.pricing.inputUsdPerMillion + w.outputTokens * o.pricing.outputUsdPerMillion) / M) * 1.5;
}

const overview = {
  me: { id: 'qa-admin', email: 'admin@example.com', role: 'ADMIN' },
  llm: {
    modelId: 'gpt-5.6-terra',
    tierModels: { low: 'gpt-5.4-mini', medium: 'gpt-5.6-terra', high: 'gpt-6-sol' },
    baseUrl: '',
    hasApiKey: true,
    maskedApiKey: 'sk-…a91f',
    source: 'database',
    updatedAt: '2026-11-01T18:20:00Z',
  },
  modelOptions,
  providers: [],
  usage: {
    limit: { enabled: true, weeklyCostLimitUsd: 200, weeklyRequestLimit: null, periodTimezone: 'America/Toronto', updatedBy: null, updatedAt: null },
    usage: { estimatedCostUsd: 96.4, requestCount: 7488 },
  },
  roleCounts: { USER: 12, STUDENT: 204, TEACHING_ASSISTANT: 3, TEACHER: 6, ADMIN: 2 },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url, location.href);
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), {
      headers: { 'content-type': 'application/json' },
    });
  if (url.pathname === '/api/native/v1/auth/browser') {
    return reply({ user: { id: 'qa-admin', name: '管理员', email: null, image: null, role: 'ADMIN' } });
  }
  if (url.pathname === '/api/native/v1/admin') {
    if ((init?.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.modelId) overview.llm.modelId = body.modelId;
      if (body.tierModels) overview.llm.tierModels = body.tierModels;
      overview.llm.updatedAt = new Date().toISOString();
      return reply({ llm: overview.llm });
    }
    if (url.searchParams.get('check')) return reply({ admin: true });
    return reply(overview);
  }
  return realFetch(input, init);
};

const navigation = {
  active: 'admin' as const,
  avatarUrl: '',
  onOpenProblemBanks: noop,
  onOpenCalendar: noop,
  onOpenStore: noop,
  onOpenSettings: noop,
  onOpenAdmin: noop,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppNavigationContext.Provider value={navigation}>
      <main className={`syntara-native-shell${compact ? '' : ' has-global-navigation'}`}>
        {compact ? null : <AppNavigationRail {...navigation} onOpenChat={noop} />}
        <div className="native-global-page">
          <AdminPage onBack={noop} />
        </div>
      </main>
    </AppNavigationContext.Provider>
  </StrictMode>,
);
