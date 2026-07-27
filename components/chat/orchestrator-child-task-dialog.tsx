import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { safeJsonStringify } from '@/lib/utils/safe-json';
import { formatTs } from './chat-message-utils';
import type { OrchestratorChildTaskView } from './chat-page-types';

export function OrchestratorChildTaskDialog({
  task,
  onOpenChange,
}: {
  task: OrchestratorChildTaskView | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task?.title || '子任务详情'}</DialogTitle>
          <DialogDescription>
            查看该子任务的协议事件快照、路由信息与最新 payload。
          </DialogDescription>
        </DialogHeader>

        {task ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-900/[0.08] bg-muted/20 p-3 dark:border-white/[0.1]">
              <div>
                <p className="text-[11px] text-muted-foreground">状态</p>
                <p className="font-medium">{task.status}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">更新时间</p>
                <p className="font-medium">{formatTs(task.updatedAt)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] text-muted-foreground">详情</p>
                <p className="font-medium">{task.detail || 'N/A'}</p>
              </div>
            </div>

            {task.lastEnvelope ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Protocol Envelope
                </p>
                <div className="rounded-lg border border-slate-900/[0.08] bg-white/70 p-3 dark:border-white/[0.1] dark:bg-black/30">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">type</span>
                      <p className="font-medium">{task.lastEnvelope.type}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">protocol</span>
                      <p className="font-medium">{task.lastEnvelope.protocol}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">messageId</span>
                      <p className="font-mono text-[11px] break-all">
                        {task.lastEnvelope.messageId}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">conversationId</span>
                      <p className="font-mono text-[11px] break-all">
                        {task.lastEnvelope.conversationId}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">sender</span>
                      <p>
                        {task.lastEnvelope.sender.name} ({task.lastEnvelope.sender.role})
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">receiver</span>
                      <p>
                        {task.lastEnvelope.receiver.name} ({task.lastEnvelope.receiver.role})
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">createdAt</span>
                      <p>{formatTs(task.lastEnvelope.createdAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="mb-1 text-xs text-muted-foreground">payload</p>
                    <pre className="max-h-72 overflow-auto rounded bg-black/90 p-3 text-[11px] leading-relaxed text-slate-100">
                      {safeJsonStringify(task.lastEnvelope.payload)}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">该任务尚无 envelope 快照。</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
