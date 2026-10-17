'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, Plus } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type ActivationCodeRow = {
  id: string;
  code: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
};

type ListResponse = {
  success: true;
  total: number;
  unused: number;
  codes: ActivationCodeRow[];
};

type CreateResponse = {
  success: true;
  codes: Array<Pick<ActivationCodeRow, 'id' | 'code' | 'note' | 'createdAt'>>;
};

type Filter = 'unused' | 'used' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'unused', label: '未使用' },
  { id: 'used', label: '已使用' },
  { id: 'all', label: '全部' },
];

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`已复制${label}`);
  } catch {
    toast.error('复制失败，请手动选择文本');
  }
}

export function AdminActivationCodesSection() {
  const [filter, setFilter] = useState<Filter>('unused');
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState('10');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string[]>([]);

  const load = useCallback(async (nextFilter: Filter) => {
    setLoading(true);
    try {
      setData(await backendJson<ListResponse>(`/api/admin/activation-codes?filter=${nextFilter}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const create = async () => {
    setCreating(true);
    try {
      const response = await backendJson<CreateResponse>('/api/admin/activation-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: Number(count), note }),
      });
      setCreated(response.codes.map((row) => row.code));
      toast.success(`已生成 ${response.codes.length} 个激活码`);
      void load(filter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            生成 App 激活码
          </CardTitle>
          <CardDescription>
            用户登录网页后输入激活码即可开通 Syntara
            App。每个激活码只能使用一次，一个账号只需激活一次。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="activation-count">数量</Label>
              <Input
                id="activation-count"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activation-note">备注（可选）</Label>
              <Input
                id="activation-note"
                placeholder="例如：10 月 MAT136 学员"
                maxLength={200}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <Button onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              生成
            </Button>
          </div>
          {created.length ? (
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">刚生成的 {created.length} 个激活码</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText(created.join('\n'), '全部激活码')}
                >
                  <Copy className="size-4" />
                  全部复制
                </Button>
              </div>
              <pre className="max-h-60 overflow-auto font-mono text-sm leading-6">
                {created.join('\n')}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>激活码列表</CardTitle>
          <CardDescription>
            {data ? `共 ${data.total} 个，未使用 ${data.unused} 个。` : '正在加载…'}
            列表最多显示最近 200 个。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {FILTERS.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={filter === item.id ? 'default' : 'outline'}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {loading && !data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在加载…
            </div>
          ) : data?.codes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">激活码</th>
                    <th className="py-2 pr-4 font-medium">状态</th>
                    <th className="py-2 pr-4 font-medium">使用者</th>
                    <th className="py-2 pr-4 font-medium">备注</th>
                    <th className="py-2 pr-4 font-medium">生成时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.codes.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          className="font-mono hover:underline"
                          onClick={() => void copyText(row.code, '激活码')}
                          title="点击复制"
                        >
                          {row.code}
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant="outline"
                          className={cn(
                            row.redeemedAt
                              ? 'text-muted-foreground'
                              : 'border-emerald-300 text-emerald-700',
                          )}
                        >
                          {row.redeemedAt ? '已使用' : '未使用'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {row.redeemedBy ? (
                          <span>
                            {row.redeemedBy}
                            <span className="block text-xs text-muted-foreground">
                              {formatTime(row.redeemedAt)}
                            </span>
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2 pr-4">{row.note || '-'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatTime(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">没有符合条件的激活码。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
