'use client';

import { Bell } from 'lucide-react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/notifications/client-toast';
import { useNotificationStore } from '@/lib/store/notifications';

/** All banners share Sonner's stack, timers, keyboard support and hover pause. */
export function GlobalNotificationOverlay() {
  const router = useRouter();
  const item = useNotificationStore((state) => state.activeBanners[0]);
  useEffect(() => {
    if (!item) return;
    const dismiss = () => useNotificationStore.getState().dismissBanner(item.id);
    toast(item.title, {
      id: `notification:${item.id}`,
      description: item.body,
      icon: <Bell className="size-5 text-blue-500" />,
      duration: item.tone === 'negative' ? 10000 : 6500,
      action: {
        label: '查看',
        onClick: () => {
          useNotificationStore.getState().markAsRead(item.id);
          router.push(item.href || '/notifications');
        },
      },
      onDismiss: dismiss,
      onAutoClose: dismiss,
    });
    return () => {
      toast.dismiss(`notification:${item.id}`);
    };
  }, [item, router]);
  return null;
}
