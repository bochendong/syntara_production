'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PreviewRole = 'student' | 'teacher';

export type FrontendPreviewCourse = {
  id: string;
  code: string;
  name: string;
  term: string;
};

type PreviewSurface = {
  id: string;
  label: string;
  description: string;
  href: string;
  Icon: typeof LayoutDashboard;
};

function previewSurfaces(role: PreviewRole, courseId: string): PreviewSurface[] {
  const encodedCourseId = encodeURIComponent(courseId);
  if (role === 'teacher') {
    return [
      {
        id: 'teacher-studio',
        label: '课程工作台',
        description: '资料库、笔记本、AI 队列与课程导航',
        href: `/teacher/courses/${encodedCourseId}?mock=1`,
        Icon: LayoutDashboard,
      },
      {
        id: 'teacher-forum',
        label: '教师论坛',
        description: '置顶、回答、已解决状态与发布弹窗',
        href: `/course/${encodedCourseId}/forum?mock=1&asTeacher=1`,
        Icon: MessagesSquare,
      },
    ];
  }

  return [
    {
      id: 'student-home',
      label: '所有课程',
      description: '学生免登录课程桌面与课程切换',
      href: '/learn?uiPreview=1',
      Icon: GraduationCap,
    },
    {
      id: 'student-course',
      label: '课程概览',
      description: '学生课程工具、笔记本列表与进度限制',
      href: `/student/courses/${encodedCourseId}?mock=1`,
      Icon: BookOpen,
    },
    {
      id: 'student-chat',
      label: '课程聊天',
      description: '聊天布局、课程工具与本地演示回复',
      href: `/learn?courseId=${encodedCourseId}&uiPreview=1&asStudent=1`,
      Icon: MessageCircle,
    },
    {
      id: 'student-forum',
      label: '学生论坛',
      description: '帖子列表、Markdown 正文与回答区',
      href: `/course/${encodedCourseId}/forum?mock=1`,
      Icon: MessagesSquare,
    },
  ];
}

export function FrontendPreviewDashboard({ courses }: { courses: FrontendPreviewCourse[] }) {
  const [role, setRole] = useState<PreviewRole>('student');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? 'demo-csc148');
  const surfaces = useMemo(() => previewSurfaces(role, courseId), [courseId, role]);
  const [surfaceId, setSurfaceId] = useState('student-home');
  const activeSurface = surfaces.find((surface) => surface.id === surfaceId) ?? surfaces[0];

  return (
    <main className="min-h-dvh bg-[#f4f6f8] text-slate-950">
      <div className="mx-auto flex min-h-dvh max-w-[1680px] flex-col gap-4 p-4 sm:p-5">
        <header className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm">
                <ShieldCheck className="size-6" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    前端免登录测试台
                  </h1>
                  <Badge className="border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                    Mock only
                  </Badge>
                </div>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">
                  直接切换身份、课程和页面。所有入口只使用演示数据，不创建登录会话，也不会写入真实课程数据库。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/test">
                  <ArrowLeft className="size-4" />
                  返回测试中心
                </Link>
              </Button>
              {activeSurface ? (
                <Button asChild className="rounded-xl bg-slate-950 hover:bg-slate-800">
                  <a href={activeSurface.href} target="_blank" rel="noreferrer">
                    新窗口打开
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
              {(
                [
                  ['student', '学生', UserRound],
                  ['teacher', '老师', GraduationCap],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                    role === value
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>

            <label className="mt-5 text-xs font-semibold tracking-wide text-slate-500">
              测试课程
              <select
                value={courseId}
                onChange={(event) => setCourseId(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} · {course.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-5 space-y-2" aria-label="可预览页面">
              {surfaces.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  onClick={() => setSurfaceId(surface.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition',
                    activeSurface?.id === surface.id
                      ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                      : 'border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-9 shrink-0 place-items-center rounded-xl',
                      activeSurface?.id === surface.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-600 shadow-sm',
                    )}
                  >
                    <surface.Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm">{surface.label}</strong>
                    <small className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {surface.description}
                    </small>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-auto rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">
              这里测试的是页面布局与前端交互。涉及真实
              AI、上传、数据库写入和权限同步的流程，仍需使用测试账号。
            </div>
          </aside>

          <div className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4 sm:px-5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{activeSurface?.label}</div>
                <div className="truncate font-mono text-[11px] text-slate-400">
                  {activeSurface?.href}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0 rounded-lg text-slate-500">
                无需登录
              </Badge>
            </div>
            {activeSurface ? (
              <iframe
                key={activeSurface.href}
                src={activeSurface.href}
                title={`${role === 'teacher' ? '老师' : '学生'}端 ${activeSurface.label}预览`}
                className="min-h-0 w-full flex-1 bg-white"
              />
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-slate-500">
                暂无可预览页面
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
