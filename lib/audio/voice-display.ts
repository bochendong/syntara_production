import { getTTSVoices } from '@/lib/audio/constants';
import type { TTSProviderId, TTSVoiceInfo } from '@/lib/audio/types';

/** 与设置页、Composer 音色列表右侧说明一致 */
export function voiceRowBlurb(v: TTSVoiceInfo, t: (key: string) => string, locale: string): string {
  if (v.description) {
    const key = `settings.${v.description}`;
    const s = t(key);
    if (s !== key) return s;
  }
  const zh = locale.startsWith('zh');
  const g =
    v.gender === 'female'
      ? zh
        ? '女'
        : 'Female'
      : v.gender === 'male'
        ? zh
          ? '男'
          : 'Male'
        : v.gender === 'neutral'
          ? zh
            ? '中性'
            : 'Neutral'
          : '';
  return [g, v.language].filter(Boolean).join(' · ');
}

export function getActiveVoiceDisplay(
  providerId: TTSProviderId,
  voiceId: string,
  t: (key: string) => string,
  locale: string,
): { name: string; blurb: string } {
  const voices = getTTSVoices(providerId);
  const v = voices.find((x) => x.id === voiceId);
  if (!v) return { name: voiceId, blurb: '' };
  return { name: v.name, blurb: voiceRowBlurb(v, t, locale) };
}
