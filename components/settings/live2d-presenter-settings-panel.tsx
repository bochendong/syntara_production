'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { LIVE2D_PRESENTER_MODELS } from '@/lib/live2d/presenter-models';
import { cn } from '@/lib/utils';

export function Live2dPresenterSettingsPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const live2dPresenterModelId = useSettingsStore((state) => state.live2dPresenterModelId);
  const live2dPresenterVisible = useSettingsStore((state) => state.live2dPresenterVisible);
  const setLive2DPresenterModelId = useSettingsStore((state) => state.setLive2DPresenterModelId);
  const setLive2DPresenterVisible = useSettingsStore((state) => state.setLive2DPresenterVisible);
  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <Label className="text-sm font-medium">伴学角色</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          选择学习主页和课程中的伴学角色，切换后立即生效。
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/70 px-4 py-3">
        <div className="min-w-0">
          <Label className="text-sm font-medium">显示伴学角色</Label>
          <p className="mt-1 text-xs text-muted-foreground">关闭后，学习界面将不再显示伴学角色。</p>
        </div>
        <Switch
          checked={live2dPresenterVisible}
          onCheckedChange={setLive2DPresenterVisible}
          aria-label="显示伴学角色"
        />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {Object.values(LIVE2D_PRESENTER_MODELS).map((model) => {
          const selected = live2dPresenterModelId === model.id;
          return (
            <button
              key={model.id}
              type="button"
              className={cn(
                'apple-btn h-auto w-full overflow-hidden border-0 p-0 text-left transition-all',
                selected
                  ? 'apple-btn-primary shadow-md ring-2 ring-[#007AFF]/35'
                  : 'apple-btn-secondary',
              )}
              onClick={() => setLive2DPresenterModelId(model.id)}
            >
              <span className="flex w-full flex-col">
                <span className="relative aspect-square w-full overflow-hidden rounded-t-[inherit] bg-[radial-gradient(circle_at_50%_15%,rgba(125,211,252,0.2),transparent_58%),linear-gradient(180deg,rgba(148,163,184,0.12),rgba(148,163,184,0.04))]">
                  <img
                    src={model.previewSrc}
                    alt={t(`settings.live2dPresenterOptions.${model.id}.label`)}
                    className="h-full w-full object-cover opacity-90"
                    draggable={false}
                  />
                </span>
                <span className="flex flex-col items-start gap-0.5 px-3 py-2.5">
                  <span className={cn('text-sm font-medium', selected && 'text-white')}>
                    {t(`settings.live2dPresenterOptions.${model.id}.label`)}
                  </span>
                  <span
                    className={cn(
                      'line-clamp-2 text-[11px] leading-4',
                      selected ? 'text-white/85' : 'text-muted-foreground',
                    )}
                  >
                    {t(`settings.live2dPresenterOptions.${model.id}.desc`)}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
