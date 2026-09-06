export const SYNTARA_DIALOG_OVERLAY_CLASS =
  'bg-slate-900/28 backdrop-blur-[7px] supports-backdrop-filter:backdrop-blur-[7px]';

export const SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS =
  'bg-slate-900/22 backdrop-blur-[10px] supports-backdrop-filter:backdrop-blur-[10px]';

export const SYNTARA_ACTION_DIALOG_CONTENT_CLASS =
  'flex h-auto w-[calc(100vw-1rem)] min-w-[min(960px,calc(100vw-1rem))] max-w-[1040px] min-h-[min(620px,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] flex-col gap-4 overflow-y-auto rounded-[28px] border border-white/80 bg-slate-50/96 p-5 shadow-[0_28px_90px_rgba(15,23,42,0.25)] ring-0 backdrop-blur-[32px] supports-backdrop-filter:backdrop-blur-[32px] dark:border-white/12 dark:bg-slate-950/96';

/** Legacy appearance only; shared viewport dimensions also apply to confirmations. */
export const SYNTARA_COMPACT_DIALOG_CONTENT_CLASS =
  'flex w-[calc(100vw-2rem)] max-w-[480px] max-h-[min(620px,88dvh)] min-h-0 flex-col gap-4 overflow-y-auto rounded-[22px] border border-white/80 bg-slate-50/96 p-5 shadow-[0_28px_90px_rgba(15,23,42,0.25)] ring-0 backdrop-blur-[32px] supports-backdrop-filter:backdrop-blur-[32px] dark:border-white/12 dark:bg-slate-950/96';

export const SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS =
  'flex h-[min(760px,86dvh)] w-[calc(100vw-1rem)] max-w-[1180px] min-h-0 flex-col gap-0 overflow-hidden rounded-[28px] border border-slate-900/12 bg-white p-0 shadow-[0_28px_90px_rgba(15,23,42,0.28)] ring-0 sm:h-[min(780px,86dvh)] dark:border-white/12 dark:bg-slate-950';

export const SYNTARA_DIALOG_HEADER_CLASS =
  'shrink-0 border-b border-slate-900/8 px-5 py-4 pr-14 text-left dark:border-white/10';

export const SYNTARA_DIALOG_FOOTER_CLASS =
  'shrink-0 border-t border-slate-900/8 bg-white/72 px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]';
/** Every popup uses the same near-full-screen workspace dimensions. */
export const SYNTARA_DIALOG_VIEWPORT_STYLE = {
  width: 'calc(100vw - 2rem)',
  height: 'calc(100dvh - 2rem)',
  minWidth: 0,
  minHeight: 0,
  maxWidth: 1600,
  maxHeight: 1000,
} as const;
