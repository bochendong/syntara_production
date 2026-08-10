'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Gauge, Loader2, Save, Search, Users } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type UsageSummary = {
  estimatedCostUsd: number;
  requestCount: number;
};

type GlobalLimit = {
  enabled: boolean;
  monthlyCostLimitUsd: number | null;
  monthlyRequestLimit: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type UserLimit = {
  userId: string;
  monthlyCostLimitUsd: number | null;
  monthlyRequestLimit: number | null;
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
};

type SaveGlobalResponse = {
  success: true;
  global: {
    limit: GlobalLimit;
    usage: UsageSummary;
  };
};

type SaveUserResponse = {
  success: true;
  user: Pick<UsageLimitUser, 'id' | 'limit' | 'usage'>;
};

type BulkTargetRole = 'STUDENT' | 'TEACHER';

type SaveBulkResponse = {
  success: true;
  updatedCount: number;
  users: Array<{ id: string }>;
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
  const [savingUser, setSavingUser] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [globalLimit, setGlobalLimit] = useState<GlobalLimit | null>(null);
  const [globalUsage, setGlobalUsage] = useState<UsageSummary | null>(null);
  const [globalCost, setGlobalCost] = useState('');
  const [globalRequests, setGlobalRequests] = useState('');
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [editingUser, setEditingUser] = useState<UsageLimitUser | null>(null);
  const [userCost, setUserCost] = useState('');
  const [userRequests, setUserRequests] = useState('');
  const [userDisabled, setUserDisabled] = useState(false);
  const [userNote, setUserNote] = useState('');
  const [bulkTargetRole, setBulkTargetRole] = useState<BulkTargetRole>('STUDENT');
  const [bulkCost, setBulkCost] = useState('');
  const [bulkRequests, setBulkRequests] = useState('');
  const [bulkDisabled, setBulkDisabled] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkUsers, setBulkUsers] = useState<UsageLimitUser[]>([]);
  const [selectedBulkUserIds, setSelectedBulkUserIds] = useState<string[]>([]);
  const [loadingBulkUsers, setLoadingBulkUsers] = useState(false);
  const [bulkSearch, setBulkSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    void backendJson<UsageLimitsResponse>('/api/admin/usage-limits')
      .then((response) => {
        if (cancelled) return;
        setGlobalLimit(response.global.limit);
        setGlobalUsage(response.global.usage);
        setGlobalEnabled(response.global.limit.enabled);
        setGlobalCost(response.global.limit.monthlyCostLimitUsd?.toString() ?? '');
        setGlobalRequests(response.global.limit.monthlyRequestLimit?.toString() ?? '');
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const limit = editingUser?.limit;
    setUserCost(limit?.monthlyCostLimitUsd?.toString() ?? '');
    setUserRequests(limit?.monthlyRequestLimit?.toString() ?? '');
    setUserDisabled(Boolean(limit?.disabled));
    setUserNote(limit?.note ?? '');
  }, [editingUser]);

  useEffect(() => {
    let cancelled = false;
    setLoadingBulkUsers(true);
    setBulkSearch('');
    void backendJson<UsageLimitsResponse>(
      `/api/admin/usage-limits?listRole=${encodeURIComponent(bulkTargetRole)}`,
    )
      .then((response) => {
        if (cancelled) return;
        setBulkUsers(response.users);
        setSelectedBulkUserIds(response.users.map((user) => user.id));
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingBulkUsers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bulkTargetRole]);

  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      const response = await backendJson<SaveGlobalResponse>('/api/admin/usage-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          enabled: globalEnabled,
          monthlyCostLimitUsd: globalCost,
          monthlyRequestLimit: globalRequests,
        }),
      });
      setGlobalLimit(response.global.limit);
      setGlobalUsage(response.global.usage);
      toast.success('已保存全站云端上限');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveUser = async () => {
    if (!editingUser) {
      toast.error('先选择一个用户');
      return;
    }

    setSavingUser(true);
    try {
      const response = await backendJson<SaveUserResponse>(
        '/api/admin/usage-limits',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: 'user',
            userId: editingUser.id,
            disabled: userDisabled,
            monthlyCostLimitUsd: userCost,
            monthlyRequestLimit: userRequests,
            note: userNote,
          }),
        },
      );
      const updateUser = (user: UsageLimitUser) =>
        user.id === response.user.id
          ? { ...user, limit: response.user.limit, usage: response.user.usage }
          : user;
      setBulkUsers((current) => current.map(updateUser));
      setEditingUser((current) =>
        current && current.id === response.user.id ? updateUser(current) : current,
      );
      toast.success('已保存用户云端上限');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingUser(false);
    }
  };

  const saveBulkUsers = async () => {
    if (selectedBulkUserIds.length === 0) {
      toast.error('请先勾选至少一个老师或学生账号');
      return;
    }

    const targetLabel =
      bulkTargetRole === 'STUDENT' ? '学生列表' : '老师列表';
    const confirmed = window.confirm(
      `确认批量覆盖${targetLabel}中已勾选的 ${selectedBulkUserIds.length} 个账号吗？`,
    );
    if (!confirmed) return;

    setSavingBulk(true);
    try {
      const response = await backendJson<SaveBulkResponse>('/api/admin/usage-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'bulk-users',
          targetRole: bulkTargetRole,
          userIds: selectedBulkUserIds,
          disabled: bulkDisabled,
          monthlyCostLimitUsd: bulkCost,
          monthlyRequestLimit: bulkRequests,
          note: bulkNote,
        }),
      });

      const updatedIds = new Set(response.users.map((user) => user.id));
      setBulkUsers((current) =>
        current.map((user) => {
          if (!updatedIds.has(user.id)) return user;
          return {
            ...user,
            limit: {
              userId: user.id,
              monthlyCostLimitUsd: bulkCost.trim() ? Number.parseFloat(bulkCost) : null,
              monthlyRequestLimit: bulkRequests.trim()
                ? Number.parseInt(bulkRequests, 10)
                : null,
              disabled: bulkDisabled,
              note: bulkNote.trim() || null,
              updatedBy: null,
              updatedAt: new Date().toISOString(),
            },
          };
        }),
      );
      toast.success(`已批量更新 ${response.updatedCount} 个账号`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingBulk(false);
    }
  };

  const globalCostStatus = limitStatus(
    globalUsage?.estimatedCostUsd ?? 0,
    globalLimit?.monthlyCostLimitUsd,
  );
  const globalRequestStatus = limitStatus(
    globalUsage?.requestCount ?? 0,
    globalLimit?.monthlyRequestLimit,
  );
  const filteredBulkUsers = useMemo(() => {
    const keyword = bulkSearch.trim().toLowerCase();
    if (!keyword) return bulkUsers;
    return bulkUsers.filter((user) =>
      [user.email, user.name, user.role]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword)),
    );
  }, [bulkSearch, bulkUsers]);
  const allBulkUsersSelected =
    filteredBulkUsers.length > 0 &&
    filteredBulkUsers.every((user) => selectedBulkUserIds.includes(user.id));
  const toggleBulkUser = (userId: string, checked: boolean) => {
    setSelectedBulkUserIds((current) =>
      checked ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId),
    );
  };
  const toggleAllBulkUsers = (checked: boolean) => {
    const visibleIds = filteredBulkUsers.map((user) => user.id);
    setSelectedBulkUserIds((current) =>
      checked
        ? Array.from(new Set([...current, ...visibleIds]))
        : current.filter((id) => !visibleIds.includes(id)),
    );
  };
  const openUserDialog = (user: UsageLimitUser) => {
    setEditingUser(user);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            全站云端总上限
          </CardTitle>
          <CardDescription>
            按云端数据库中的本月 API 用量统计，触顶后服务端会拒绝新的模型、图片和搜索调用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">本月成本</p>
              <p className="mt-1 text-lg font-semibold">
                {formatUsd(globalUsage?.estimatedCostUsd)}
              </p>
              <Badge variant={globalCostStatus.danger ? 'destructive' : 'secondary'}>
                {globalCostStatus.label}
              </Badge>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">成本上限</p>
              <p className="mt-1 text-lg font-semibold">
                {formatUsd(globalLimit?.monthlyCostLimitUsd)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">本月请求</p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(globalUsage?.requestCount)}
              </p>
              <Badge variant={globalRequestStatus.danger ? 'destructive' : 'secondary'}>
                {globalRequestStatus.label}
              </Badge>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">请求上限</p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(globalLimit?.monthlyRequestLimit)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[160px_1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>启用全站拦截</Label>
              <div className="flex h-10 items-center gap-2">
                <Switch checked={globalEnabled} onCheckedChange={setGlobalEnabled} />
                <span className="text-sm text-muted-foreground">{globalEnabled ? '已启用' : '未启用'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="global-cost">月成本上限 USD</Label>
              <Input
                id="global-cost"
                inputMode="decimal"
                placeholder="例如 200"
                value={globalCost}
                onChange={(event) => setGlobalCost(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="global-requests">月请求数上限</Label>
              <Input
                id="global-requests"
                inputMode="numeric"
                placeholder="例如 10000"
                value={globalRequests}
                onChange={(event) => setGlobalRequests(event.target.value)}
              />
            </div>
            <Button type="button" onClick={saveGlobal} disabled={savingGlobal}>
              {savingGlobal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            批量用户云端上限
          </CardTitle>
          <CardDescription>
            选择一组账号后统一覆盖月成本、月请求数和暂停状态。留空表示不限。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr_1fr]">
            <div className="space-y-2">
              <Label>筛选账号</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBulkTargetRole('TEACHER')}
                  className={cn(
                    'bg-white',
                    bulkTargetRole === 'TEACHER'
                      ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:text-white'
                      : 'text-foreground',
                  )}
                >
                  老师
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBulkTargetRole('STUDENT')}
                  className={cn(
                    'bg-white',
                    bulkTargetRole === 'STUDENT'
                      ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:text-white'
                      : 'text-foreground',
                  )}
                >
                  学生
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-cost">月成本上限 USD</Label>
              <Input
                id="bulk-cost"
                inputMode="decimal"
                placeholder="留空表示不限"
                value={bulkCost}
                onChange={(event) => setBulkCost(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-requests">月请求数上限</Label>
              <Input
                id="bulk-requests"
                inputMode="numeric"
                placeholder="留空表示不限"
                value={bulkRequests}
                onChange={(event) => setBulkRequests(event.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-sm font-medium">账号列表</p>
                <p className="text-xs text-muted-foreground">
                  已选择 {selectedBulkUserIds.length} 个账号，当前显示 {filteredBulkUsers.length} / {bulkUsers.length}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-60 max-w-full">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-9"
                    placeholder="搜索邮箱或姓名"
                    value={bulkSearch}
                    onChange={(event) => setBulkSearch(event.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={allBulkUsersSelected}
                    onCheckedChange={(checked) => toggleAllBulkUsers(Boolean(checked))}
                    disabled={filteredBulkUsers.length === 0 || loadingBulkUsers}
                  />
                  全选
                </label>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto p-2">
              {loadingBulkUsers ? (
                <div className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取账号列表…
                </div>
              ) : null}
              {!loadingBulkUsers && bulkUsers.length === 0 ? (
                <div className="rounded-md px-3 py-2 text-sm text-muted-foreground">
                  这个筛选下还没有账号
                </div>
              ) : null}
              {!loadingBulkUsers && bulkUsers.length > 0 && filteredBulkUsers.length === 0 ? (
                <div className="rounded-md px-3 py-2 text-sm text-muted-foreground">
                  没有匹配这个搜索的账号
                </div>
              ) : null}
              {filteredBulkUsers.map((user) => {
                const checked = selectedBulkUserIds.includes(user.id);
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/60"
                  >
                    <label className="flex cursor-pointer items-center">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleBulkUser(user.id, Boolean(value))}
                      />
                      <span className="sr-only">选择 {user.email || user.name || user.id}</span>
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user.email || user.name || user.id}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.name || '未填写姓名'}
                      </p>
                    </div>
                    <Badge variant={user.limit?.disabled ? 'destructive' : 'outline'}>
                      {user.role || 'USER'}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openUserDialog(user)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      查看
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>这组用户 API 状态</Label>
              <div className="flex h-10 items-center justify-between rounded-md border bg-background px-3">
                <span className="text-sm font-medium">
                  {bulkDisabled ? '暂停' : '调用'}
                </span>
                <Switch
                  checked={!bulkDisabled}
                  onCheckedChange={(checked) => setBulkDisabled(!checked)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-note">备注</Label>
              <Input
                id="bulk-note"
                value={bulkNote}
                onChange={(event) => setBulkNote(event.target.value)}
                placeholder="例如：统一测试额度、首月老师额度等"
              />
            </div>
            <Button
              type="button"
              onClick={saveBulkUsers}
              disabled={savingBulk || loadingBulkUsers || selectedBulkUserIds.length === 0}
            >
              {savingBulk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              批量保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="w-[min(760px,calc(100vw-32px))] rounded-2xl p-0">
          <DialogHeader className="border-b px-6 py-5 pr-14">
            <DialogTitle>单独修改用户云端上限</DialogTitle>
            <DialogDescription>
              {editingUser?.email || editingUser?.name || editingUser?.id}
            </DialogDescription>
          </DialogHeader>
          {editingUser ? (
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">本月成本</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatUsd(editingUser.usage.estimatedCostUsd)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">成本上限</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatUsd(editingUser.limit?.monthlyCostLimitUsd)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">本月请求</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatNumber(editingUser.usage.requestCount)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">请求上限</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatNumber(editingUser.limit?.monthlyRequestLimit)}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>该用户 API 状态</Label>
                  <div className="flex h-10 items-center justify-between rounded-md border bg-background px-3">
                    <span className="text-sm font-medium">
                      {userDisabled ? '暂停' : '调用'}
                    </span>
                    <Switch
                      checked={!userDisabled}
                      onCheckedChange={(checked) => setUserDisabled(!checked)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-cost">月成本上限 USD</Label>
                  <Input
                    id="user-cost"
                    inputMode="decimal"
                    placeholder="留空表示不限"
                    value={userCost}
                    onChange={(event) => setUserCost(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-requests">月请求数上限</Label>
                  <Input
                    id="user-requests"
                    inputMode="numeric"
                    placeholder="留空表示不限"
                    value={userRequests}
                    onChange={(event) => setUserRequests(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="user-note">备注</Label>
                <Textarea
                  id="user-note"
                  value={userNote}
                  onChange={(event) => setUserNote(event.target.value)}
                  placeholder="例如：测试班级额度、老师演示账号等"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
              取消
            </Button>
            <Button type="button" onClick={saveUser} disabled={savingUser || !editingUser}>
              {savingUser ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              单独保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
