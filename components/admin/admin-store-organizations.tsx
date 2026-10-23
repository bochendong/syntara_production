'use client';

import { useState } from 'react';
import { Building2, Loader2, Plus, Sparkles } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';

export type AdminOrganizationOption = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  verified: boolean;
  _count?: { courses: number };
};

export type AdminStoreCourseState = {
  id: string;
  organizationId: string | null;
  listedInCourseStore: boolean;
  contentVersion: number;
};

type PatchStoreCourseResponse = {
  success: true;
  course: AdminStoreCourseState & { storePublishedAt: string | null };
};

/** 机构列表 + 新建机构。商城只展示挂在机构下的课程。 */
export function AdminOrganizationsCard({
  organizations,
  onCreated,
}: {
  organizations: AdminOrganizationOption[];
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      await backendJson('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          verified: true,
          memberEmails: memberEmails
            .split(/[\s,，]+/)
            .map((email) => email.trim())
            .filter(Boolean),
        }),
      });
      setName('');
      setSlug('');
      setMemberEmails('');
      toast.success('机构已保存');
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存机构失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          商城机构
        </CardTitle>
        <CardDescription>商城只展示机构课程。先建机构，再在下方课程里选择机构并上架。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {organizations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {organizations.map((organization) => (
              <Badge key={organization.id} variant="outline" className="gap-1.5 py-1">
                {organization.name}
                <span className="font-mono text-[10px] text-muted-foreground">
                  {organization.slug}
                </span>
                {organization._count ? (
                  <span className="text-muted-foreground">· {organization._count.courses}</span>
                ) : null}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="org-name">名称</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-slug">slug</Label>
            <Input
              id="org-slug"
              value={slug}
              placeholder="uoft-cs"
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-members">成员邮箱</Label>
            <Input
              id="org-members"
              value={memberEmails}
              placeholder="a@school.edu, b@school.edu"
              onChange={(e) => setMemberEmails(e.target.value)}
            />
          </div>
          <Button onClick={create} disabled={saving || !name.trim() || !slug.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 课程行里的商城控制：所属机构、上架、发布新版。 */
export function AdminStoreCourseControls({
  course,
  organizations,
  onChanged,
}: {
  course: AdminStoreCourseState;
  organizations: AdminOrganizationOption[];
  onChanged: (next: AdminStoreCourseState) => void;
}) {
  const [saving, setSaving] = useState(false);

  const patch = async (body: {
    organizationId?: string | null;
    listedInCourseStore?: boolean;
    publishNewVersion?: boolean;
  }) => {
    setSaving(true);
    try {
      const response = await backendJson<PatchStoreCourseResponse>(
        `/api/admin/courses/${encodeURIComponent(course.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      onChanged(response.course);
      if (body.publishNewVersion) toast.success(`已发布 v${response.course.contentVersion}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-[160px] flex-col items-start gap-2">
      <select
        aria-label="所属机构"
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
        value={course.organizationId ?? ''}
        disabled={saving}
        onChange={(event) => void patch({ organizationId: event.target.value || null })}
      >
        <option value="">个人课程</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={course.listedInCourseStore ? 'default' : 'outline'}
          className={course.listedInCourseStore ? 'h-7 bg-emerald-600 text-xs' : 'h-7 text-xs'}
          disabled={saving || !course.organizationId}
          onClick={() => void patch({ listedInCourseStore: !course.listedInCourseStore })}
        >
          {course.listedInCourseStore ? '商城上架' : '未上架'}
        </Button>
        {course.organizationId ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={saving}
            title="发布新版：已加入的学生会看到更新提示"
            onClick={() => void patch({ publishNewVersion: true })}
          >
            <Sparkles className="h-3.5 w-3.5" />v{course.contentVersion}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
