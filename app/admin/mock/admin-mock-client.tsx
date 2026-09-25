'use client';

import { Suspense, useEffect, useState } from 'react';
import { AdminConsole } from '@/components/admin/admin-console';

type MockConfig = {
  providerId: 'openai';
  modelId: string;
  tierModels: { low: string; medium: string; high: string };
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: 'database';
  updatedAt: string;
};

const initialConfig: MockConfig = {
  providerId: 'openai',
  modelId: 'gpt-5.6-sol',
  tierModels: { low: 'gpt-5.6-luna', medium: 'gpt-5.6-sol', high: 'gpt-6-astra' },
  baseUrl: 'https://api.openai.com/v1',
  hasApiKey: true,
  maskedApiKey: 'sk-••••DEMO',
  source: 'database',
  updatedAt: new Date().toISOString(),
};
const now = new Date().toISOString();
const teacher = {
  id: 'mock-teacher-1',
  email: 'teacher@example.invalid',
  name: '陈老师',
  isActive: true,
  courseCount: 2,
  createdAt: now,
  updatedAt: now,
};
const course = {
  id: 'mock-course-1',
  name: 'UTSG-CSC108',
  courseCode: 'CSC108',
  academicYear: 2026,
  academicTerm: 'fall',
};
const student = {
  id: 'mock-student-1',
  email: 'student@example.invalid',
  name: '示例学生',
  isActive: true,
  courses: [{ ...course, notebookAccessLimit: null, joinedAt: now }],
  createdAt: now,
  updatedAt: now,
};

function mockResponse(path: string, config: MockConfig, searchParams: URLSearchParams) {
  if (path.includes('/api/admin/llm-config')) return { config };
  if (path.includes('/api/admin/llm-usage/'))
    return {
      row: {
        id: path.split('/').pop() || 'demo-usage-1',
        requestContent: '请解释 Python 循环。',
        responseContent: '循环会重复执行代码块。',
      },
    };
  if (path.includes('/api/admin/llm-usage')) {
    const requestedPage = Number(searchParams.get('page'));
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const total = 43;
    const pageSize = 20;
    return {
      summary: {
        totalRequests: 128,
        totalInputTokens: 580000,
        totalOutputTokens: 120000,
        totalTokens: 700000,
        estimatedCostUsd: 12.4,
      },
      rows: Array.from(
        { length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) },
        (_, index) => {
          const number = (page - 1) * pageSize + index + 1;
          return {
            id: `demo-usage-${number}`,
            userId: teacher.id,
            userEmail: teacher.email,
            userName: teacher.name,
            route: '/api/notebooks/send-message',
            modelString: 'openai:gpt-5.6-sol',
            inputTokens: 1450,
            outputTokens: 380,
            totalTokens: 1830,
            estimatedCostUsd: 0.01,
            createdAt: new Date(Date.parse(now) - number * 60_000).toISOString(),
          };
        },
      ),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }
  if (path.includes('/api/admin/teachers/') && path.includes('/resources'))
    return {
      teacher,
      courses: [course],
      notebookCount: 2,
      problemCount: 3,
      page: 1,
      pages: 1,
      total: 2,
      rows: [
        {
          id: 'demo-notebook-1',
          name: '第 1 讲：基础运算',
          description: '示例笔记本',
          notebookKind: 'image',
          removedAt: null,
          course: { name: course.name },
          _count: { pages: 6, scenes: 0, markdownSections: 0, problems: 3 },
        },
      ],
    };
  if (path.includes('/api/admin/teachers')) return { teachers: [teacher] };
  if (path.includes('/api/admin/students')) return { students: [student] };
  if (path.includes('/api/admin/courses')) return { courses: [], totalCount: 0 };
  if (path.includes('/api/admin/usage-limits'))
    return {
      success: true,
      global: {
        limit: { enabled: false, weeklyCostLimitUsd: null, weeklyRequestLimit: null },
        usage: { requestCount: 0, estimatedCostUsd: 0 },
      },
      users: [],
    };
  if (path.includes('/api/admin/site-provider-status'))
    return {
      llm: [],
      image: [],
      tts: [],
      webSearch: [],
      envHints: { llm: {}, image: {}, tts: {}, webSearch: {} },
      tavilyRootEnvPresent: false,
    };
  if (path.includes('/api/admin/credits')) return { users: [], results: [], total: 0 };
  return { success: true };
}

export default function AdminMockClient() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    let config: MockConfig = { ...initialConfig, tierModels: { ...initialConfig.tierModels } };
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const parsedUrl = new URL(url, window.location.origin);
      const path = parsedUrl.pathname;
      if (path.startsWith('/api/')) {
        if (path === '/api/admin/llm-config' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Partial<MockConfig>;
          config = {
            ...config,
            modelId: body.modelId || config.modelId,
            tierModels: body.tierModels || config.tierModels,
            baseUrl: body.baseUrl || config.baseUrl,
            updatedAt: new Date().toISOString(),
          };
          return Response.json({ config });
        }
        if (init?.method && init.method !== 'GET')
          return Response.json({ error: 'Mock 中不执行账户或数据操作' }, { status: 403 });
        return Response.json(mockResponse(path, config, parsedUrl.searchParams));
      }
      return originalFetch(input, init);
    };
    queueMicrotask(() => setReady(true));
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  if (!ready) return <p className="p-8 text-sm text-muted-foreground">正在打开管理员 Mock…</p>;
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-xs font-medium text-amber-900">
        管理员后台 Mock · 演示数据 · 设置仅在此页面内生效
      </div>
      <Suspense>
        <AdminConsole basePath="/admin/mock" />
      </Suspense>
    </div>
  );
}
