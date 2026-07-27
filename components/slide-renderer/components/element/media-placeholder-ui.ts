/**
 * Shared Tailwind fragments for image/video placeholder states.
 * Matches the academy-paper slide skin while staying neutral in other contexts.
 */
export const mediaPlaceholderUi = {
  disabledWrap:
    'w-full h-full flex items-center justify-center rounded-[14px] border border-[#bca985]/25 dark:border-white/[0.08] bg-[#fffdf8]/80 dark:bg-white/[0.04] backdrop-blur-sm',
  caption:
    'flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[#6f6471] dark:text-[#a1a1a6]',
  skeletonWrap:
    'w-full h-full flex items-center justify-center rounded-[14px] border border-[#bca985]/28 dark:border-[#0A84FF]/20 bg-gradient-to-br from-[#fffdf8]/95 via-[#f4f7ff]/78 to-[#fbf1f7]/58 dark:from-[#0a1c33]/55 dark:via-[#0d2240]/42 dark:to-[#061020]/38',
  pulseRing: 'absolute inset-0 rounded-full border-2 border-[#4b72e8]/30 dark:border-[#0A84FF]/38',
  skeletonIcon: 'absolute inset-0 m-auto w-5 h-5 text-[#4b72e8]/78 dark:text-[#0A84FF]/72',
  errorWrap:
    'w-full h-full flex flex-col items-center justify-center gap-1.5 rounded-[14px] border border-red-500/12 dark:border-red-400/18 bg-red-50/85 dark:bg-red-950/22',
  warningCaption:
    'flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[#c2410c] dark:text-[#fdba74]',
  retryBtn:
    'flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-[10px] border border-red-300/55 dark:border-red-500/35 text-red-700 dark:text-red-300 bg-[#fffdf8]/90 dark:bg-white/[0.06] hover:bg-red-50/90 dark:hover:bg-red-950/35 transition-colors',
  imageIdleWrap:
    'w-full h-full flex items-center justify-center rounded-[14px] border border-[#bca985]/20 dark:border-white/[0.08] bg-[#fffdf8]/58 dark:bg-white/[0.03]',
  imageIdleIcon: 'w-10 h-10 text-[#8f7c9c] dark:text-[#636366]',
  videoIdleWrap:
    'w-full h-full flex items-center justify-center rounded-[14px] border border-[#bca985]/20 dark:border-white/[0.08] bg-[#fffdf8]/58 dark:bg-white/[0.03]',
  videoIdleIcon: 'w-12 h-12 text-[#8f7c9c] dark:text-[#636366]',
} as const;
