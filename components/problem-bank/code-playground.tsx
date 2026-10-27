'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CodeFileChips, type CodeFileView } from './code-files';
import { runPythonScriptInBrowser, type BrowserScriptResult } from '@/lib/client/browser-python';
import type { NotebookCodeFile } from '@/lib/problem-bank';

/**
 * 编辑器下面的「自己试」：在浏览器里跑当前代码，可以接一个表达式看返回值，
 * 带上题目文件（可以改一份副本）和 stdin。不计分，提交仍走服务器测试。
 */
export function CodePlayground({
  problemId,
  code,
  files,
  stdin,
  locale,
  className,
}: {
  problemId: string;
  code: string;
  files?: NotebookCodeFile[];
  stdin?: string;
  locale: 'zh-CN' | 'en-US';
  className?: string;
}) {
  const zh = locale === 'zh-CN';
  const inputFiles = (files ?? []).filter((file) => file.role !== 'expected_output');
  const expectedFiles = (files ?? []).filter((file) => file.role === 'expected_output');
  const [expression, setExpression] = useState('');
  const [stdinValue, setStdinValue] = useState(stdin ?? '');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(BrowserScriptResult & { problemId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsStdin = stdin !== undefined || /\binput\s*\(/.test(code);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const trimmed = expression.trim();
      const program = trimmed
        ? `${code}\n\n__syntara_value__ = (${trimmed})\nprint(repr(__syntara_value__))\n`
        : code;
      const output = await runPythonScriptInBrowser({
        code: program,
        files: inputFiles.map((file) => ({
          path: file.path,
          content: edits[file.path] ?? file.content,
        })),
        stdin: stdinValue,
      });
      setResult({ ...output, problemId });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunning(false);
    }
  };

  const shown = result?.problemId === problemId ? result : null;
  const chipFiles: CodeFileView[] = [
    ...inputFiles.map((file) => ({
      path: file.path,
      content: edits[file.path] ?? file.content,
      format: file.format,
    })),
    ...expectedFiles.map((file) => ({
      path: file.path,
      content: file.content,
      format: file.format,
      role: 'expected_output' as const,
    })),
    ...(shown?.files ?? [])
      .filter((file) => !expectedFiles.some((expected) => expected.path === file.path))
      .map((file) => ({ ...file, changed: true })),
  ];

  return (
    <div
      className={cn('space-y-2 border-t border-slate-200 bg-slate-50/70 px-3 py-2.5', className)}
    >
      <CodeFileChips
        files={chipFiles}
        locale={locale}
        editedPaths={new Set(Object.keys(edits))}
        onEdit={(path, content) => setEdits((prev) => ({ ...prev, [path]: content }))}
        onReset={(path) =>
          setEdits((prev) => {
            const next = { ...prev };
            delete next[path];
            return next;
          })
        }
      />
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-400">&gt;&gt;&gt;</span>
        <input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void run();
            }
          }}
          placeholder={zh ? '自己试：比如 alt_case("abc")' : 'Try: e.g. alt_case("abc")'}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-full border border-slate-200 bg-white/90 px-3 font-mono text-xs text-slate-800 shadow-inner outline-none focus:border-sky-400"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          aria-label={zh ? '在浏览器里运行' : 'Run in browser'}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 bg-gradient-to-br from-white via-sky-100 to-sky-300 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_6px_rgba(14,165,233,0.25)] transition hover:scale-105 disabled:opacity-70"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </button>
      </div>
      {needsStdin ? (
        <textarea
          value={stdinValue}
          onChange={(event) => setStdinValue(event.target.value)}
          rows={2}
          placeholder="stdin"
          spellCheck={false}
          className="block w-full resize-y rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 font-mono text-xs text-slate-700 outline-none focus:border-sky-400"
        />
      ) : null}
      {error ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700">
          {error}
        </pre>
      ) : shown ? (
        <pre
          className={cn(
            'max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border px-3 py-2 font-mono text-xs',
            shown.error
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-white text-slate-800',
          )}
        >
          {shown.stdout}
          {shown.error ? `${shown.stdout ? '\n' : ''}${shown.error}` : ''}
          {!shown.stdout && !shown.error ? '∅' : ''}
        </pre>
      ) : null}
    </div>
  );
}
