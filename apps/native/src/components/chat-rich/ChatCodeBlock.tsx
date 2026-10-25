import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { codeLanguageColor, codeLanguageLabel, highlightCodeLines } from './code-highlight';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 旧 WebView 没有 clipboard API 时退回 execCommand。
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** 聊天里的代码块：VS Code 深色编辑器的样子（标签页顶栏、行号、语法高亮、复制）。 */
export const ChatCodeBlock = memo(function ChatCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lines = useMemo(
    () => highlightCodeLines(code.replace(/\n+$/, ''), language),
    [code, language],
  );
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleCopy = async () => {
    if (!(await copyText(code.replace(/\n+$/, '')))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <figure className="chat-code" data-language={language || undefined}>
      <header className="chat-code-bar">
        <span className="chat-code-tab">
          <span className="chat-code-dot" style={{ background: codeLanguageColor(language) }} />
          {codeLanguageLabel(language)}
        </span>
        <button
          type="button"
          className={`chat-code-copy${copied ? ' is-copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </header>
      <div className="chat-code-body">
        <div className="chat-code-gutter" aria-hidden>
          {lines.map((_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <pre className="chat-code-pre">
          <code>
            {lines.map((tokens, index) => (
              <span key={index} className="chat-code-line">
                {tokens.map((token, tokenIndex) =>
                  token.kind === 'plain' ? (
                    token.text
                  ) : (
                    <span key={tokenIndex} className={`tk-${token.kind}`}>
                      {token.text}
                    </span>
                  ),
                )}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
});
