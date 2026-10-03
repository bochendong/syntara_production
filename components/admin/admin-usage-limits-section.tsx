'use client';
import { useEffect, useRef, useState } from 'react';
import { Gauge, Loader2, Save, Search, Users, RotateCcw } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { backendJson } from '@/lib/utils/backend-api';
type Role = 'TEACHER' | 'STUDENT';
type UsageSummary = {
  estimatedCostUsd: number;
  requestCount: number;
};

type GlobalLimit = {
  enabled: boolean;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type UserLimit = {
  userId: string;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
  disabled: boolean;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type UsageLimitUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  createdAt: string;
  limit: UserLimit | null;
  usage: UsageSummary;
};

type UsageLimitsResponse = {
  success: true;
  global: {
    limit: GlobalLimit;
    usage: UsageSummary;
  };
  users: UsageLimitUser[];
  roleLimits: Record<Role, number | null>;
};

type SaveGlobalResponse = {
  success: true;
  global: {
    limit: GlobalLimit;
    usage: UsageSummary;
  };
};

function formatUsd(value: number | null | undefined) {
  if (value == null) return '-';
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function limitStatus(used: number, limit: number | null | undefined) {
  if (limit == null) return { label: '未设置', danger: false };
  if (used >= limit) return { label: '已触顶', danger: true };
  if (used >= limit * 0.8) return { label: '接近上限', danger: false };
  return { label: '正常', danger: false };
}

export function AdminUsageLimitsSection() {
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalLimit, setGlobalLimit] = useState<GlobalLimit | null>(null);
  const [globalUsage, setGlobalUsage] = useState<UsageSummary | null>(null);
  const [globalCost, setGlobalCost] = useState('');
  const [globalRequests, setGlobalRequests] = useState('');
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [roleLimits, setRoleLimits] = useState<Record<Role, string>>({ TEACHER: '', STUDENT: '' });
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState(0);
  const editedRoles = useRef(new Set<Role>());
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UsageLimitUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    setConfigError(null);
    void backendJson<UsageLimitsResponse>('/api/admin/usage-limits')
      .then((response) => {
        if (cancelled) return;
        setGlobalLimit(response.global.limit);
        setGlobalUsage(response.global.usage);
        setGlobalEnabled(response.global.limit.enabled);
        setGlobalCost(response.global.limit.weeklyCostLimitUsd?.toString() ?? '');
        setGlobalRequests(response.global.limit.weeklyRequestLimit?.toString() ?? '');
        if (!response.roleLimits) throw new Error('限额接口尚未更新，请更新服务端后重试');
        setRoleLimits((current) => ({
          TEACHER: editedRoles.current.has('TEACHER')
            ? current.TEACHER
            : (response.roleLimits.TEACHER?.toString() ?? ''),
          STUDENT: editedRoles.current.has('STUDENT')
            ? current.STUDENT
            : (response.roleLimits.STUDENT?.toString() ?? ''),
        }));
      })
      .catch((error) => {
        if (!cancelled) setConfigError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configVersion]);
  useEffect(() => {
    let cancelled = false;
    setUsers([]);
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void backendJson<UsageLimitsResponse>(
        `/api/admin/usage-limits?query=${encodeURIComponent(query.trim())}`,
      )
        .then((response) => {
          if (!cancelled) setUsers(response.users);
        })
        .catch((error) => {
          if (!cancelled) toast.error(String(error));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchVersion]);
  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      const response = await backendJson<SaveGlobalResponse>('/api/admin/usage-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          enabled: globalEnabled,
          weeklyCostLimitUsd: globalCost,
          weeklyRequestLimit: globalRequests,
        }),
      });
      setGlobalLimit(response.global.limit);
      setGlobalUsage(response.global.usage);
      toast.success('已保存全站云端上限');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSavingGlobal(false);
    }
  };
  const saveRoles = async () => {
    setSaving(true);
    try {
      await backendJson('/api/admin/usage-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'role', roleLimits }),
      });
      setSearchVersion((v) => v + 1);
      setConfigError(null);
      toast.success('已保存老师和学生每周限额');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };
  const resetQuota = async (
    target: { userId: string; label: string } | { targetRole: Role; label: string },
  ) => {
    if (
      !window.confirm(`确认重置${target.label}的本周已用额度吗？重置后可重新使用完整的每周限额。`)
    )
      return;
    setResetting(true);
    try {
      const response = await backendJson<{ updatedCount: number }>('/api/admin/usage-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'reset', ...target }),
      });
      setSearchVersion((v) => v + 1);
      toast.success(`已重置 ${response.updatedCount} 个用户的本周额度`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setResetting(false);
    }
  };
  const globalCostStatus = limitStatus(
    globalUsage?.estimatedCostUsd ?? 0,
    globalLimit?.weeklyCostLimitUsd,
  );
  const globalRequestStatus = limitStatus(
    globalUsage?.requestCount ?? 0,
    globalLimit?.weeklyRequestLimit,
  );
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            全站云端总上限
          </CardTitle>
          <CardDescription>
            按每周一 00:00 UTC 重置的 API 用量统计，触顶后服务端会拒绝新的模型、图片和搜索调用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-y-4 rounded-lg bg-muted/25 py-4 md:grid-cols-4">
            <div className="border-r px-4 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">本周成本</p>
              <p className="mt-1 text-lg font-semibold">
                {formatUsd(globalUsage?.estimatedCostUsd)}
              </p>
              <Badge variant={globalCostStatus.danger ? 'destructive' : 'secondary'}>
                {globalCostStatus.label}
              </Badge>
            </div>
            <div className="border-r px-4 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">成本上限</p>
              <p className="mt-1 text-lg font-semibold">
                {formatUsd(globalLimit?.weeklyCostLimitUsd)}
              </p>
            </div>
            <div className="border-r px-4 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">本周请求</p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(globalUsage?.requestCount)}
              </p>
              <Badge variant={globalRequestStatus.danger ? 'destructive' : 'secondary'}>
                {globalRequestStatus.label}
              </Badge>
            </div>
            <div className="border-r px-4 py-2 last:border-r-0">
              <p className="text-xs text-muted-foreground">请求上限</p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(globalLimit?.weeklyRequestLimit)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[160px_1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>启用全站拦截</Label>
              <div className="flex h-10 items-center gap-2">
                <Switch
                  aria-label="启用全站拦截"
                  checked={globalEnabled}
                  onCheckedChange={setGlobalEnabled}
                />
                <span className="text-sm text-muted-foreground">
                  {globalEnabled ? '已启用' : '未启用'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="global-cost">每周成本上限 USD</Label>
              <Input
                id="global-cost"
                inputMode="decimal"
                placeholder="例如 200"
                value={globalCost}
                onChange={(event) => setGlobalCost(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="global-requests">每周请求数上限</Label>
              <Input
                id="global-requests"
                inputMode="numeric"
                placeholder="例如 10000"
                value={globalRequests}
                onChange={(event) => setGlobalRequests(event.target.value)}
              />
            </div>
            <Button type="button" onClick={saveGlobal} disabled={savingGlobal}>
              {savingGlobal ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            老师 / 学生每周限额
          </CardTitle>
          <CardDescription>
            每个账号按所属角色使用统一的每周 USD 预算，新账号自动继承。留空表示不限，每周一 00:00
            UTC 自动恢复。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loadingConfig ? (
            <p className="text-sm text-muted-foreground">正在读取已保存限额，可先输入…</p>
          ) : null}
          {configError ? (
            <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3">
              <p className="text-sm text-destructive">限额配置加载失败：{configError}</p>
              <p className="text-xs text-muted-foreground">可以继续输入；保存成功后才会生效。</p>
              <Button
                variant="outline"
                size="sm"
                disabled={saving || resetting}
                onClick={() => setConfigVersion((v) => v + 1)}
              >
                重新加载
              </Button>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {(['TEACHER', 'STUDENT'] as const).map((role) => (
              <div key={role} className="space-y-2">
                <Label htmlFor={`quota-${role}`}>
                  {role === 'TEACHER' ? '老师' : '学生'}每周限额 USD
                </Label>
                <Input
                  id={`quota-${role}`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="留空表示不限"
                  disabled={saving}
                  value={roleLimits[role]}
                  onChange={(event) => {
                    editedRoles.current.add(role);
                    setRoleLimits((current) => ({ ...current, [role]: event.target.value }));
                  }}
                />
              </div>
            ))}
            <Button onClick={saveRoles} disabled={loadingConfig || saving || resetting}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存限额
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {(['STUDENT', 'TEACHER'] as const).map((role) => (
              <Button
                key={role}
                variant="outline"
                disabled={loadingConfig || resetting || saving}
                onClick={() =>
                  resetQuota({
                    targetRole: role,
                    label: role === 'STUDENT' ? '全部学生' : '全部老师',
                  })
                }
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {role === 'STUDENT' ? '全部学生重置' : '全部老师重置'}
              </Button>
            ))}
          </div>
          <div className="space-y-3 border-t pt-4">
            <Label htmlFor="quota-search">搜索用户并重置额度</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="quota-search"
                className="pl-9"
                placeholder="搜索邮箱或姓名"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              重置会恢复本周可用额度，保留历史用量和全站成本统计。
            </p>
            {loading ? (
              <p className="text-sm text-muted-foreground">正在搜索…</p>
            ) : query.trim() && users.length === 0 ? (
              <p className="text-sm text-muted-foreground">没有匹配的用户</p>
            ) : null}
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.name || user.email || user.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Badge variant="outline">
                    {user.role === 'TEACHER'
                      ? '老师'
                      : user.role === 'STUDENT'
                        ? '学生'
                        : user.role || '用户'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    本周已用 {formatUsd(user.usage.estimatedCostUsd)} /{' '}
                    {user.limit?.weeklyCostLimitUsd == null
                      ? '不限'
                      : formatUsd(user.limit.weeklyCostLimitUsd)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resetting || saving}
                    onClick={() =>
                      resetQuota({ userId: user.id, label: user.name || user.email || user.id })
                    }
                  >
                    重置额度
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
