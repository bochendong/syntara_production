import type { ProblemContentLanguage } from '../lib/problem-language';
import { GlassSpinner } from './GlassLoadMore';

export function ContentLanguageSwitch({
  value,
  onChange,
  busy = false,
  label = '内容语言',
}: {
  value: ProblemContentLanguage;
  onChange: (language: ProblemContentLanguage) => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <div className="content-language-switch" role="group" aria-label={label} aria-busy={busy}>
      {(['zh-CN', 'en-US'] as const).map((language) => (
        <button
          type="button"
          key={language}
          lang={language}
          aria-pressed={value === language}
          disabled={busy}
          onClick={() => onChange(language)}
        >
          {language === 'zh-CN' ? '中文' : 'English'}
        </button>
      ))}
      {busy ? (
        <span role="status" aria-label="正在切换语言">
          <GlassSpinner size={14} />
        </span>
      ) : null}
    </div>
  );
}
