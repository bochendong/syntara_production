'use client';

import { Card } from '@/components/ui/card';
import { TokenUsageAccountPanel } from './token-usage-card';
import { cn } from '@/lib/utils';

export function NotificationCenterUsageCard({ className }: { className?: string }) {
  return (
    <Card
      id="notification-center-usage-card"
      className={cn(
        'border-muted/40 bg-white/80 p-5 !gap-0 shadow-xl backdrop-blur-xl dark:bg-slate-900/80',
        className,
      )}
    >
      <div id="notification-center-token" className="scroll-mt-4">
        <TokenUsageAccountPanel variant="tab" />
      </div>
    </Card>
  );
}
