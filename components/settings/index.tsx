'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SettingsButton } from '@/components/settings/settings-button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SettingsSection } from '@/lib/types/settings';
import {
  Settings,
  Image as ImageIcon,
  Volume2,
  Mic,
  UserRound,
  ChevronRight,
  Wallpaper,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { SystemLLMPanel } from './system-llm-panel';
import { useSettingsStore } from '@/lib/store/settings';

const settingsPanelLoading = () => (
  <div className="py-10 text-center text-sm text-slate-500" role="status">
    加载设置项…
  </div>
);

const loadImageSettings = () => import('./image-settings').then((mod) => mod.ImageSettings);
const loadTTSSettings = () => import('./tts-settings').then((mod) => mod.TTSSettings);
const loadASRSettings = () => import('./asr-settings').then((mod) => mod.ASRSettings);
const loadLive2dPresenterSettingsPanel = () =>
  import('./live2d-presenter-settings-panel').then((mod) => mod.Live2dPresenterSettingsPanel);
const loadLearnBackgroundSettings = () =>
  import('./learn-background-settings').then((mod) => mod.LearnBackgroundSettings);

const ImageSettings = dynamic(loadImageSettings, {
  loading: settingsPanelLoading,
});
const TTSSettings = dynamic(loadTTSSettings, {
  loading: settingsPanelLoading,
});
const ASRSettings = dynamic(loadASRSettings, {
  loading: settingsPanelLoading,
});
const Live2dPresenterSettingsPanel = dynamic(loadLive2dPresenterSettingsPanel, {
  loading: settingsPanelLoading,
});
const LearnBackgroundSettings = dynamic(loadLearnBackgroundSettings, {
  loading: settingsPanelLoading,
});

const PRELOADABLE_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'image',
  'tts',
  'asr',
  'live2d',
  'background',
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
  /** 为 true 时不使用模态 Dialog，在主内容区以整页/嵌入式面板展示（用于 /settings 路由） */
  embedded?: boolean;
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection,
  embedded = false,
}: SettingsDialogProps) {
  const { t } = useI18n();
  const imageProviderId = useSettingsStore((state) => state.imageProviderId);
  const ttsProviderId = useSettingsStore((state) => state.ttsProviderId);
  const asrProviderId = useSettingsStore((state) => state.asrProviderId);

  // Navigation
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers');
  const preloadSection = useCallback((section: SettingsSection) => {
    const loaders: Partial<Record<SettingsSection, () => Promise<unknown>>> = {
      image: loadImageSettings,
      tts: loadTTSSettings,
      asr: loadASRSettings,
      live2d: loadLive2dPresenterSettingsPanel,
      background: loadLearnBackgroundSettings,
    };
    const loader = loaders[section];
    void loader?.();
  }, []);

  useEffect(() => {
    const preloadAll = () => {
      PRELOADABLE_SETTINGS_SECTIONS.forEach(preloadSection);
    };
    const idleId = window.requestIdleCallback(preloadAll, { timeout: 1200 });
    return () => window.cancelIdleCallback(idleId);
  }, [preloadSection]);
  // Navigate to initialSection when dialog opens or embedded page loads / query changes
  useEffect(() => {
    const active = embedded || open;
    if (active && initialSection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync section from prop
      setActiveSection(initialSection);
    }
  }, [embedded, open, initialSection]);

  const navigationItems: Array<{
    id: SettingsSection;
    label: string;
    Icon: typeof Settings;
    iconClassName: string;
  }> = [
    {
      id: 'providers',
      label: t('settings.providers'),
      Icon: Settings,
      iconClassName: 'bg-[#8e8e93]',
    },
    {
      id: 'image',
      label: t('settings.imageSettings'),
      Icon: ImageIcon,
      iconClassName: 'bg-[#34c759]',
    },
    {
      id: 'background',
      label: '学习背景',
      Icon: Wallpaper,
      iconClassName: 'bg-[#5ac8fa]',
    },
    {
      id: 'live2d',
      label: '伴学角色',
      Icon: UserRound,
      iconClassName: 'bg-[#af52de]',
    },
    {
      id: 'tts',
      label: t('settings.ttsSettings'),
      Icon: Volume2,
      iconClassName: 'bg-[#ff9500]',
    },
    {
      id: 'asr',
      label: t('settings.asrSettings'),
      Icon: Mic,
      iconClassName: 'bg-[#ff3b30]',
    },
  ];

  const activeNavigationItem =
    navigationItems.find((item) => item.id === activeSection) || navigationItems[0];
  const ActiveSectionIcon = activeNavigationItem.Icon;

  const settingsPanel = (
    <>
      {activeSection === 'providers' && <SystemLLMPanel />}
      {activeSection === 'image' && <ImageSettings selectedProviderId={imageProviderId} />}
      {activeSection === 'background' && <LearnBackgroundSettings />}
      {activeSection === 'live2d' && <Live2dPresenterSettingsPanel />}
      {activeSection === 'tts' && <TTSSettings selectedProviderId={ttsProviderId} />}
      {activeSection === 'asr' && <ASRSettings selectedProviderId={asrProviderId} />}
    </>
  );

  const embeddedColumn = (
    <div className="learn-dock-profile-shell learn-dock-settings-shell">
      <aside className="learn-dock-profile-navigation">
        <div className="learn-dock-profile-brand">
          <span>
            <Sparkles size={19} strokeWidth={2.2} />
          </span>
          <strong>Syntara</strong>
        </div>
        <nav aria-label={t('settings.title')}>
          {navigationItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              onMouseEnter={() => preloadSection(id)}
              onFocus={() => preloadSection(id)}
              data-active={activeSection === id ? 'true' : 'false'}
              aria-current={activeSection === id ? 'page' : undefined}
            >
              <span>
                <Icon size={17} strokeWidth={1.9} />
              </span>
              {label}
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          ))}
        </nav>
        <p className="learn-dock-profile-navigation-note">
          设置管理模型、图像、学习背景、Live2D 和语音偏好，不包含个人公开资料。
        </p>
        <div className="learn-dock-profile-navigation-footer">
          <button type="button" onClick={() => onOpenChange(false)}>
            <ArrowLeft size={17} strokeWidth={1.9} />
            返回主屏
          </button>
        </div>
      </aside>

      <div className="learn-dock-profile-main">
        <div className="learn-dock-profile-content">
          <div className="learn-dock-settings-card">
            <div className="learn-dock-settings-heading">
              <span>
                <ActiveSectionIcon size={21} strokeWidth={1.9} />
              </span>
              <div>
                <small>设置</small>
                <h2>{activeNavigationItem.label}</h2>
              </div>
            </div>
            <div className="learn-dock-settings-panel" style={{ overflow: 'visible' }}>
              {settingsPanel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const mainColumn = (
    <div
      className={cn(
        'flex overflow-hidden bg-[#f2f2f7] text-slate-950',
        embedded ? 'min-h-0 w-full flex-1' : 'h-full',
      )}
    >
      <aside
        className="w-[286px] shrink-0 border-r border-black/[0.09] bg-[#f2f2f7] px-4 py-5 max-md:w-[230px] max-sm:hidden"
        role="navigation"
        aria-label={t('settings.title')}
      >
        <h1 className="px-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
          {t('settings.title')}
        </h1>
        <p className="mt-1 px-2 text-xs leading-5 text-slate-500">模型、媒体与学习体验</p>

        <div className="mt-5 space-y-1">
          {navigationItems.map(({ id, label, Icon, iconClassName }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              onMouseEnter={() => preloadSection(id)}
              onFocus={() => preloadSection(id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-[11px] px-2 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500',
                activeSection === id ? 'bg-black/[0.08]' : 'hover:bg-black/[0.04]',
              )}
              aria-current={activeSection === id ? 'page' : undefined}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-[8px] text-white shadow-sm',
                  iconClassName,
                )}
              >
                <Icon className="size-4" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                {label}
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f2f2f7]">
        <div className="shrink-0 border-b border-black/[0.06] bg-[#f2f2f7]/95 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="hidden max-sm:block">
            <h1 className="text-3xl font-bold tracking-[-0.04em] text-slate-950">
              {t('settings.title')}
            </h1>
            <div className="mt-3 flex gap-1 overflow-x-auto rounded-[12px] bg-black/[0.06] p-1">
              {navigationItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  onMouseEnter={() => preloadSection(item.id)}
                  onFocus={() => preloadSection(item.id)}
                  className={cn(
                    'min-w-max rounded-[9px] px-3 py-1.5 text-xs font-semibold outline-none',
                    activeSection === item.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs font-semibold text-[#007aff] max-sm:mt-4">Syntara</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
            {activeNavigationItem.label}
          </h2>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="mx-auto w-full max-w-6xl">
            <div className="ipados-settings-content overflow-hidden rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04] sm:p-5">
              {settingsPanel}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-black/[0.06] bg-[#f2f2f7]/95 px-5 py-3 backdrop-blur-xl sm:px-7">
          <SettingsButton
            variant="secondary"
            size="sm"
            className="rounded-full bg-white px-4 text-slate-700 shadow-sm ring-1 ring-black/[0.05] hover:bg-white"
            onClick={() => onOpenChange(false)}
          >
            {t('settings.close')}
          </SettingsButton>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {embedded ? (
        <>
          <h1 className="sr-only">{t('settings.title')}</h1>
          <p className="sr-only">{t('settings.description')}</p>
          {embeddedColumn}
        </>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="h-[85vh] p-0 gap-0 block">
            <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('settings.description')}</DialogDescription>
            {mainColumn}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
