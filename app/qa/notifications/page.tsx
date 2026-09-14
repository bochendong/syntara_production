'use client';

import { Bell, FileText, ImageIcon, AlertCircle } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';

const examples = [
  {
    title: '讲义处理完成',
    body: '第 3 章 · 导数与微分已整理完成，可以查看课程资料。',
    icon: FileText,
  },
  { title: '课堂讲解已生成', body: '2 页讲解卡片已准备好，可以开始讲解。', icon: ImageIcon },
  { title: '图片未能生成', body: '本次生成未完成，请打开 AI 队列查看并重试。', icon: AlertCircle },
];
export default function NotificationPreview() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100 p-8 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 dark:text-white">
      <div className="mx-auto max-w-4xl pt-12">
        <p className="text-xs font-semibold tracking-widest text-slate-400">SYNTARA · 通知预览</p>
        <h1 className="mt-3 text-3xl font-semibold">重要的结果，轻轻告诉你。</h1>
        <p className="mt-4 text-sm text-slate-500">
          点击卡片，体验右上角通知的出现、堆叠和自动收起。示例不会写入通知历史。
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {examples.map(({ title, body, icon: Icon }) => (
            <button
              key={title}
              onClick={() =>
                toast(title, {
                  description: body,
                  icon: <Icon className="size-5 text-blue-500" />,
                  duration: 6500,
                  action: {
                    label: '查看',
                    onClick: () => toast.info('这是交互预览，正式通知会打开对应任务。'),
                  },
                })
              }
              className="rounded-3xl border border-white/70 bg-white/65 p-6 text-left shadow-sm backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/5"
            >
              <Icon className="mb-6 size-6 text-blue-500" />
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-slate-500">{body}</p>
            </button>
          ))}
        </div>
        <div className="mt-10 flex items-center gap-3 text-xs text-slate-500">
          <Bell className="size-4" />
          自动收起不等于已读 · 悬停暂停计时 · 同一任务去重 · 支持深色模式
        </div>
      </div>
    </main>
  );
}
