'use client';

import { NotificationBannerCard } from '@/components/notifications/notification-banner-card';
import { toast } from '@/lib/notifications/client-toast';
import type { AppNotification } from '@/lib/notifications/types';

const example: AppNotification = {
  id: 'visual-preview',
  kind: 'study_nudge',
  title: '讲义处理完成',
  body: '导数与微分已整理完成，可以开始学习。',
  tone: 'positive',
  presentation: 'banner',
  amountLabel: '笔记本已就绪',
  delta: 0,
  balanceAfter: 0,
  accountType: 'COMPUTE',
  sourceKind: 'NOTEBOOK_GENERATION_GROUP',
  sourceLabel: '课程学习',
  createdAt: '2026-09-14T14:30:00',
  showBalance: false,
  details: [{ key: 'notebook', label: '笔记本', value: '第 3 章 · 导数与微分' }],
};

export default function NotificationComparePreview() {
  return (
    <main className="min-h-screen bg-slate-100 px-8 py-10 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs tracking-widest text-slate-500">SYNTARA · 现有组件预览</p>
        <h1 className="mt-3 text-3xl font-semibold">两种通知，实际长这样</h1>
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">01 · 轻量弹出通知</h2>
          <p className="mt-2 text-sm text-slate-500">当前全局使用；点击后显示在右上角。</p>
          <button
            className="mt-5 rounded-full bg-slate-900 px-5 py-3 text-sm text-white"
            onClick={() =>
              toast.success(example.title, {
                id: 'visual-preview-toast',
                description: example.body,
                duration: Infinity,
                action: { label: '查看', onClick: () => {} },
              })
            }
          >
            显示轻量通知
          </button>
        </section>
        <section className="mt-8">
          <h2 className="text-lg font-semibold">02 · 精致通知卡片</h2>
          <p className="mt-2 text-sm text-slate-500">
            同一个现有组件，展示深色动效与浅色背景；包含陪伴角色。
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-3 text-sm text-slate-500">柔极光 · 青蓝</p>
              <NotificationBannerCard
                item={example}
                previewStageId="soft-aurora"
                previewCardStyle="blue"
                disableLink
              />
            </div>
            <div>
              <p className="mb-3 text-sm text-slate-500">淡紫藤 · 藤紫</p>
              <NotificationBannerCard
                item={{ ...example, id: 'visual-preview-light' }}
                previewStageId="solid-lilac"
                previewCardStyle="purple"
                disableLink
              />
            </div>
          </div>
        </section>
        <p className="mt-8 text-xs text-slate-400">演示内容，不产生真实通知或积分变更。</p>
      </div>
    </main>
  );
}
