'use client';

import { useMemo, useState } from 'react';
import { FileText, RotateCcw, Sheet } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type CodeFileView = {
  path: string;
  content: string;
  format?: 'csv' | 'txt' | 'json';
  /// 程序运行后新写出 / 改过的文件
  changed?: boolean;
  role?: 'input' | 'expected_output';
};

function fileFormat(file: CodeFileView) {
  if (file.format) return file.format;
  if (/\.csv$/i.test(file.path)) return 'csv';
  if (/\.json$/i.test(file.path)) return 'json';
  return 'txt';
}

/** 简单的 CSV 拆分：支持双引号包起来的字段和 "" 转义。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 题面和编辑器之间的一排文件胶囊；点开看内容。 */
export function CodeFileChips({
  files,
  locale,
  className,
  onEdit,
  editedPaths,
  onReset,
}: {
  files: CodeFileView[];
  locale: 'zh-CN' | 'en-US';
  className?: string;
  /// 传了就允许改一份副本来「自己试」
  onEdit?: (path: string, content: string) => void;
  editedPaths?: Set<string>;
  onReset?: (path: string) => void;
}) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = files.find((file) => file.path === openPath) ?? null;
  if (files.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {files.map((file) => {
        const Icon = fileFormat(file) === 'csv' ? Sheet : FileText;
        return (
          <button
            key={file.path}
            type="button"
            onClick={() => setOpenPath(file.path)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-semibold shadow-sm backdrop-blur transition hover:-translate-y-px',
              file.changed
                ? 'animate-[pulse_1.2s_ease-out_2] border-emerald-300 bg-emerald-50/80 text-emerald-800'
                : file.role === 'expected_output'
                  ? 'border-violet-200 bg-violet-50/80 text-violet-800'
                  : 'border-sky-200 bg-white/80 text-slate-700',
              editedPaths?.has(file.path) && 'border-amber-300 bg-amber-50/80 text-amber-800',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {file.path}
          </button>
        );
      })}
      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpenPath(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          {open ? (
            <CodeFileViewer
              file={open}
              locale={locale}
              edited={editedPaths?.has(open.path) ?? false}
              onEdit={onEdit && !open.changed ? (content) => onEdit(open.path, content) : undefined}
              onReset={onReset ? () => onReset(open.path) : undefined}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CodeFileViewer({
  file,
  locale,
  edited,
  onEdit,
  onReset,
}: {
  file: CodeFileView;
  locale: 'zh-CN' | 'en-US';
  edited: boolean;
  onEdit?: (content: string) => void;
  onReset?: () => void;
}) {
  const zh = locale === 'zh-CN';
  const format = fileFormat(file);
  const [mode, setMode] = useState<'table' | 'raw'>(format === 'csv' ? 'table' : 'raw');
  const rows = useMemo(
    () => (format === 'csv' ? parseCsv(file.content) : []),
    [file.content, format],
  );
  const lines = file.content.split('\n');
  return (
    <div className="flex max-h-[85vh] flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <DialogTitle className="font-mono text-sm">{file.path}</DialogTitle>
        <div className="ml-auto flex items-center gap-1 pr-8">
          {format === 'csv' ? (
            <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {(['table', 'raw'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 font-semibold',
                    mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                  )}
                >
                  {value === 'table' ? (zh ? '表格' : 'Table') : zh ? '原始文本' : 'Raw'}
                </button>
              ))}
            </div>
          ) : null}
          {edited && onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800"
            >
              <RotateCcw className="h-3 w-3" />
              {zh ? '还原' : 'Reset'}
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'table' && rows.length > 0 ? (
          <table className="w-full border-collapse font-mono text-xs">
            <thead className="sticky top-0 bg-sky-50/95 backdrop-blur">
              <tr>
                {rows[0].map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-sky-100 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-white even:bg-slate-50/60">
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className="border-b border-slate-100 px-3 py-1.5 text-slate-800"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : onEdit ? (
          <textarea
            value={file.content}
            onChange={(event) => onEdit(event.target.value)}
            spellCheck={false}
            wrap="off"
            className="block h-[60vh] w-full resize-none bg-white p-4 font-mono text-xs leading-5 text-slate-800 outline-none"
          />
        ) : (
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] font-mono text-xs leading-5">
            <div className="select-none border-r border-slate-100 bg-slate-50 py-3 pr-2 text-right text-slate-400">
              {lines.map((_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <pre className="overflow-x-auto whitespace-pre px-4 py-3 text-slate-800">
              {file.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
