import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { GlassMenu } from './CourseToolsMenu';
import { MaterialUploadButton } from './MaterialUploadButton';
import { useBackDismiss } from '../lib/use-back-dismiss';
import './problem-bank-filters.css';

export type BankFilterValues = { series: string; difficulty: string; type: string };
export type BankFilterGroup = {
  key: keyof BankFilterValues;
  label: string;
  allLabel: string;
  options: { value: string; label: string; count: number; icon?: ReactNode }[];
};

function FilterSelect({
  group,
  value,
  onChange,
}: {
  group: BankFilterGroup;
  value: string;
  onChange: (value: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A resize can hide this trigger in favor of the mobile filter button.
  useEffect(() => {
    if (!anchor) return;
    const observer = new ResizeObserver(() => {
      if (!anchor.getClientRects().length) setAnchor(null);
    });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor]);
  const selected = group.options.find((option) => option.value === value);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`pb-filter-trigger${value !== group.options[0].value ? ' has-selection' : ''}`}
        aria-label={`${group.label}：${selected?.label ?? group.allLabel}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setAnchor(event.currentTarget);
          }
        }}
      >
        <span>{selected?.label ?? group.allLabel}</span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {anchor ? (
        <GlassMenu
          anchor={anchor}
          label={`${group.label}筛选`}
          className="pb-filter-menu"
          maxHeight={380}
          onClose={() => setAnchor(null)}
          items={group.options.map((option) => ({
            key: option.value,
            label: option.label,
            count: option.count,
            selected: option.value === value,
            icon: option.icon ?? null,
            onSelect: () => {
              onChange(option.value);
              setAnchor(null);
              triggerRef.current?.focus();
            },
          }))}
        />
      ) : null}
    </>
  );
}

function FilterSheet({
  groups,
  values,
  resultCount,
  onApply,
  onClose,
  returnFocusTo,
}: {
  groups: BankFilterGroup[];
  values: BankFilterValues;
  resultCount: (values: BankFilterValues) => number;
  onApply: (values: BankFilterValues) => void;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [draft, setDraft] = useState(values);
  const [seriesQuery, setSeriesQuery] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useBackDismiss(true, onClose, 40);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = returnFocusTo.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [returnFocusTo]);
  const count = resultCount(draft);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="pb-filter-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header>
        <h2 id={titleId}>筛选题目</h2>
        <button type="button" className="pb-filter-close" aria-label="关闭筛选" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="pb-filter-sheet-body">
        {groups.map((group) => {
          const options =
            group.key === 'series' && seriesQuery.trim()
              ? group.options.filter(
                  (option, index) =>
                    index === 0 ||
                    option.label
                      .toLocaleLowerCase()
                      .includes(seriesQuery.trim().toLocaleLowerCase()),
                )
              : group.options;
          return (
            <fieldset key={group.key} className={`pb-filter-group is-${group.key}`}>
              <legend>{group.label}</legend>
              {group.key === 'series' && group.options.length > 8 ? (
                <label className="pb-filter-series-search">
                  <Search size={16} aria-hidden />
                  <input
                    type="search"
                    aria-label="搜索系列"
                    placeholder="搜索系列"
                    value={seriesQuery}
                    onChange={(event) => setSeriesQuery(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="pb-filter-options">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={draft[group.key] === option.value}
                    onClick={() =>
                      setDraft((current) => ({ ...current, [group.key]: option.value }))
                    }
                  >
                    {option.icon}
                    <span>{option.label}</span>
                    <small>{option.count}</small>
                    {draft[group.key] === option.value ? <Check size={16} aria-hidden /> : null}
                  </button>
                ))}
              </div>
              {options.length === 1 && seriesQuery ? (
                <p className="pb-filter-no-series">没有匹配的系列</p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <footer>
        <button
          type="button"
          className="pb-filter-reset"
          onClick={() => {
            setDraft({ series: '', difficulty: 'all', type: 'all' });
            setSeriesQuery('');
          }}
        >
          重置
        </button>
        <button type="button" className="pb-filter-apply" onClick={() => onApply(draft)}>
          查看 {count} 道题
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

export function ProblemBankFilters({
  groups,
  values,
  query,
  onQueryChange,
  onChange,
  resultCount,
  onUploadFiles,
}: {
  groups: BankFilterGroup[];
  values: BankFilterValues;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (values: BankFilterValues) => void;
  resultCount: (values: BankFilterValues) => number;
  onUploadFiles?: (files: File[]) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const count =
    Number(Boolean(values.series)) +
    Number(values.difficulty !== 'all') +
    Number(values.type !== 'all');
  return (
    <div className="pb-filter-bar">
      <label className="pb-search">
        <Search size={17} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="搜索题目、章节或知识点"
          placeholder="搜索题目、章节或知识点"
        />
        {query ? (
          <button type="button" aria-label="清空搜索" onClick={() => onQueryChange('')}>
            <X size={14} />
          </button>
        ) : null}
      </label>
      <div className="pb-filter-desktop">
        {groups.map((group) => (
          <FilterSelect
            key={group.key}
            group={group}
            value={values[group.key]}
            onChange={(value) => onChange({ ...values, [group.key]: value })}
          />
        ))}
      </div>
      <button
        ref={sheetTriggerRef}
        type="button"
        className={`pb-filter-mobile${count ? ' has-selection' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label={count ? `筛选，已选 ${count} 项` : '筛选'}
        onClick={() => setSheetOpen(true)}
      >
        <SlidersHorizontal size={17} aria-hidden />
        <span>筛选</span>
        {count ? <b>{count}</b> : null}
      </button>
      {onUploadFiles ? <MaterialUploadButton label="上传题目" onFiles={onUploadFiles} /> : null}
      {sheetOpen ? (
        <FilterSheet
          groups={groups}
          values={values}
          resultCount={resultCount}
          onClose={() => setSheetOpen(false)}
          returnFocusTo={sheetTriggerRef}
          onApply={(next) => {
            onChange(next);
            setSheetOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
