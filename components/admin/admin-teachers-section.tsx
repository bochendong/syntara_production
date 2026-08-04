'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, Power, Save, Trash2 } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';

type TeacherRow = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
};

export function AdminTeachersSection() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await backendJson<{ teachers: TeacherRow[] }>('/api/admin/teachers');
      setTeachers(payload.teachers);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '老师账号加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createTeacher = async () => {
    setBusyId('new');
    try {
      await backendJson('/api/admin/teachers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });
      setEmail('');
      setName('');
      setPassword('');
      toast.success('老师账号已创建');
      await load();
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : '创建失败');
    } finally {
      setBusyId('');
    }
  };

  const updateTeacher = async (teacher: TeacherRow, patch: Record<string, unknown>) => {
    setBusyId(teacher.id);
    try {
      await backendJson(`/api/admin/teachers/${encodeURIComponent(teacher.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      toast.success('老师账号已更新');
      await load();
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : '更新失败');
    } finally {
      setBusyId('');
    }
  };

  const resetPassword = async (teacher: TeacherRow) => {
    const next = window.prompt(`为 ${teacher.email} 设置新密码（至少 10 位）`);
    if (!next) return;
    await updateTeacher(teacher, { password: next });
  };

  const deleteTeacher = async (teacher: TeacherRow) => {
    if (!window.confirm(`确认删除 ${teacher.email}？其名下课程和资料也会一并删除。`)) return;
    setBusyId(teacher.id);
    try {
      await backendJson(`/api/admin/teachers/${encodeURIComponent(teacher.id)}`, {
        method: 'DELETE',
      });
      toast.success('老师账号及其数据已删除');
      await load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : '删除失败');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="max-w-5xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> 创建老师账号
          </CardTitle>
          <CardDescription>老师使用这里设置的邮箱和初始密码登录线上教师端。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="teacher-name">姓名</Label>
            <Input
              id="teacher-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teacher-email">邮箱</Label>
            <Input
              id="teacher-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teacher-password">初始密码</Label>
            <Input
              id="teacher-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button type="button" onClick={() => void createTeacher()} disabled={busyId === 'new'}>
              {busyId === 'new' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              创建老师
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">老师数据库</CardTitle>
          <CardDescription>
            共 {teachers.length} 个老师账号。停用后现有登录会话也会失效。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">正在加载老师账号…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">老师</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">课程</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher) => (
                    <tr key={teacher.id} className="border-t">
                      <td className="px-3 py-3">
                        <div className="font-medium">{teacher.name || '未命名老师'}</div>
                        <div className="text-xs text-muted-foreground">{teacher.email}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={teacher.isActive ? 'text-emerald-600' : 'text-amber-600'}>
                          {teacher.isActive ? '启用' : '已停用'}
                        </span>
                      </td>
                      <td className="px-3 py-3">{teacher.courseCount}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === teacher.id}
                            onClick={() => void resetPassword(teacher)}
                          >
                            <KeyRound className="mr-1 size-3.5" />
                            重置密码
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === teacher.id}
                            onClick={() =>
                              void updateTeacher(teacher, { isActive: !teacher.isActive })
                            }
                          >
                            <Power className="mr-1 size-3.5" />
                            {teacher.isActive ? '停用' : '启用'}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === teacher.id}
                            onClick={() => void deleteTeacher(teacher)}
                          >
                            <Trash2 className="mr-1 size-3.5" />
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
