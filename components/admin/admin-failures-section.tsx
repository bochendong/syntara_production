'use client';

import { useEffect, useState } from 'react';

type Failure = {
  id: string;
  createdAt: string;
  data: {
    requestId: string;
    route: string;
    method: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    role: string;
    reason: string;
    category?: string;
    categoryLabel?: string;
    suggestion?: string;
    status: number;
    durationMs: number;
    input: unknown;
    requestInput?: unknown;
    source?: string;
    stage?: string;
    attempt?: number;
    model?: string;
    jobId?: string;
    output: unknown;
  };
};
const roles: Record<string, string> = {
  STUDENT: '学生',
  TEACHER: '老师',
  ADMIN: '管理员',
  USER: '用户',
  UNKNOWN: '未识别用户',
};

export function AdminFailuresSection() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [category, setCategory] = useState('');
  const [route, setRoute] = useState('');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<Failure[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  async function openRecord(record: Failure) {
    setDetailLoading(true);
    setDetailError('');
    setSelected(null);
    try {
      const response = await fetch(`/api/admin/failures?id=${encodeURIComponent(record.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '详情读取失败');
      if (!payload.records[0]) throw new Error('记录不存在');
      setSelected(payload.records[0]);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '详情读取失败');
    } finally {
      setDetailLoading(false);
    }
  }
  const [selected, setSelected] = useState<Failure | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/admin/failures?${new URLSearchParams({ search, role, route, category, page: String(page) })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取失败');
        setRecords(data.records);
        setTotal(data.total);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, role, route, category, page]);
  const field = 'rounded-lg border bg-transparent px-3 py-2 text-sm';
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">失败记录</h2>
        <p className="mt-2 text-sm text-slate-500">
          查看上传、生成、做题及 AI
          请求的失败详情。记录保存请求时的身份、输入、输出和文件信息；历史操作不会自动补录。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          aria-label="搜索失败记录"
          className={field}
          placeholder="姓名、邮箱、用户 ID、错误、追踪 ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="失败类型"
          className={field}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部失败类型</option>
          <option value="provider_balance">模型余额 / 额度不足</option>
          <option value="user_credits">用户积分不足</option>
          <option value="rate_limit">模型请求频率限制</option>
          <option value="other">其他失败</option>
        </select>
        <select
          aria-label="用户身份"
          className={field}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部身份</option>
          {Object.entries(roles).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="操作类型"
          className={field}
          value={route}
          onChange={(e) => {
            setRoute(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部操作</option>
          <option value="/generate/">生成</option>
          <option value="/uploads">上传</option>
          <option value="/sources">课程文件</option>
          <option value="/problems">题目操作</option>
          <option value="/quiz-grade">做题评分</option>
          <option value="/chat">AI 对话</option>
        </select>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      ) : loading ? (
        <p role="status">正在读取…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-500/5">
                <tr>
                  {['时间', '用户', '操作', '失败原因', '详情'].map((label) => (
                    <th className="p-3" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="whitespace-nowrap p-3">
                      {new Date(record.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="p-3">
                      <div>
                        {record.data.userName ||
                          record.data.userEmail ||
                          record.data.userId ||
                          '未识别用户'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {roles[record.data.role] || record.data.role}
                      </div>
                    </td>
                    <td className="p-3 break-all">
                      {record.data.method} {record.data.route}
                      <div className="text-xs text-slate-500">
                        HTTP {record.data.status} · {record.data.durationMs} ms
                      </div>
                    </td>
                    <td className="max-w-sm p-3">
                      <div className="mb-1 text-xs font-medium text-red-600">
                        {record.data.categoryLabel}
                      </div>
                      <p className="line-clamp-3 break-all">{record.data.reason}</p>
                    </td>
                    <td className="p-3">
                      <button
                        className="whitespace-nowrap text-sky-600 underline"
                        disabled={detailLoading}
                        onClick={() => void openRecord(record)}
                      >
                        查看记录
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!records.length && (
              <p className="p-8 text-center text-slate-500">暂无符合条件的失败记录</p>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span>
              共 {total} 条 · 第 {page} 页
            </span>
            <button
              disabled={page <= 1}
              className="disabled:opacity-40"
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <button
              disabled={page * 25 >= total}
              className="disabled:opacity-40"
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {detailLoading && <p role="status">正在读取失败详情…</p>}
      {detailError && (
        <p role="alert" className="text-red-600">
          {detailError}
        </p>
      )}
      {selected && (
        <div className="rounded-xl border bg-slate-500/5 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">失败详情</h3>
            <button onClick={() => setSelected(null)}>关闭</button>
          </div>
          <p className="my-3 break-all text-sm">
            追踪 ID：{selected.data.requestId}
            <br />
            用户 ID：{selected.data.userId || '未识别'}
            <br />
            邮箱：{selected.data.userEmail || '未记录'}
          </p>
          {[
            ['失败原因', selected.data.reason],
            ['建议处理', selected.data.suggestion || '根据错误输出和请求输入排查。'],
            [
              '操作信息（模型、阶段、重试、后台任务）',
              {
                source: selected.data.source,
                stage: selected.data.stage,
                attempt: selected.data.attempt,
                model: selected.data.model,
                jobId: selected.data.jobId,
              },
            ],
            ['原始请求及关联文件', selected.data.requestInput ?? selected.data.input],
            ['AI 输入 / 提示词', selected.data.input],
            ['输出及错误堆栈', selected.data.output],
          ].map(([label, value]) => (
            <div key={String(label)} className="mt-4">
              <h4 className="mb-2 text-sm font-medium">{String(label)}</h4>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-white p-3 text-xs dark:bg-slate-950">
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
