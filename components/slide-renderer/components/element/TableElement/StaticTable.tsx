'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PPTTableElement } from '@/lib/types/slides';
import { getTableSubThemeColor } from '@/lib/utils/element';
import {
  academyPaperTheme,
  isLightPaperColor,
  mixHexColor,
  normalizeAccentForAcademyPaper,
} from '../academyPaperTheme';
import { formatPlainText, formatText, getHiddenCells, getTextStyle } from './tableUtils';

interface StaticTableProps {
  elementInfo: PPTTableElement;
}

/**
 * Static table rendering component, ported from PPTist StaticTable.vue.
 * Renders table data with theme colors, outline borders, and merged cells.
 */
export function StaticTable({ elementInfo }: StaticTableProps) {
  const { width, height, data, colWidths, cellMinHeight, outline, theme } = elementInfo;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [contentSize, setContentSize] = useState(() => ({
    width,
    height,
  }));

  const hiddenCells = useMemo(() => getHiddenCells(data), [data]);

  const [, subThemeLight] = useMemo(() => {
    if (!theme) return ['', ''];
    return getTableSubThemeColor(theme.color);
  }, [theme]);
  const tableAccent = normalizeAccentForAcademyPaper(theme?.color || academyPaperTheme.primary);

  const borderStyle = useMemo(() => {
    if (!outline) return `1px solid ${academyPaperTheme.softBorder}`;
    const w = outline.width ?? 1;
    const c =
      isLightPaperColor(outline.color) || outline.color === '#000'
        ? academyPaperTheme.softBorder
        : outline.color;
    const s = outline.style === 'dashed' ? 'dashed' : 'solid';
    return `${w}px ${s} ${c}`;
  }, [outline]);

  useEffect(() => {
    const tableElement = tableRef.current;
    if (!tableElement) return;

    const updateContentSize = () => {
      const nextWidth =
        tableElement.scrollWidth || tableElement.getBoundingClientRect().width || width;
      const nextHeight =
        tableElement.scrollHeight || tableElement.getBoundingClientRect().height || height;

      setContentSize((prev) => {
        if (Math.abs(prev.width - nextWidth) < 0.5 && Math.abs(prev.height - nextHeight) < 0.5) {
          return prev;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateContentSize();

    const resizeObserver = new ResizeObserver(() => {
      updateContentSize();
    });
    resizeObserver.observe(tableElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [width, height, data, colWidths, cellMinHeight]);

  const fitScale = useMemo(() => {
    if (!contentSize.width || !contentSize.height) return 1;
    return Math.min(1, width / contentSize.width, height / contentSize.height);
  }, [contentSize.height, contentSize.width, height, width]);

  const offsetX = useMemo(
    () => Math.max(0, (width - contentSize.width * fitScale) / 2),
    [contentSize.width, fitScale, width],
  );
  const offsetY = useMemo(
    () => Math.max(0, (height - contentSize.height * fitScale) / 2),
    [contentSize.height, fitScale, height],
  );

  /**
   * Get background color for a cell based on theme and position
   */
  const getCellBg = (
    rowIdx: number,
    colIdx: number,
    cellBackcolor?: string,
  ): string | undefined => {
    if (cellBackcolor && !isLightPaperColor(cellBackcolor)) return cellBackcolor;
    if (!theme) return rowIdx % 2 === 0 ? 'rgba(255,253,248,0.62)' : 'rgba(255,255,255,0.36)';

    const rowCount = data.length;
    const colCount = data[0]?.length ?? 0;

    // Row header (first row) gets theme color
    if (theme.rowHeader && rowIdx === 0) return mixHexColor(tableAccent, '#ffffff', 0.76);
    // Row footer (last row) gets theme color
    if (theme.rowFooter && rowIdx === rowCount - 1)
      return mixHexColor(tableAccent, '#ffffff', 0.82);
    // Col header (first col) gets dark sub-theme
    if (theme.colHeader && colIdx === 0) return mixHexColor(tableAccent, '#ffffff', 0.84);
    // Col footer (last col) gets dark sub-theme
    if (theme.colFooter && colIdx === colCount - 1)
      return mixHexColor(tableAccent, '#ffffff', 0.84);

    // Alternating row colors (skip header row for counting)
    const effectiveRow = theme.rowHeader ? rowIdx - 1 : rowIdx;
    if (effectiveRow >= 0 && effectiveRow % 2 === 0) {
      return isLightPaperColor(subThemeLight)
        ? 'rgba(255,253,248,0.66)'
        : mixHexColor(subThemeLight, '#ffffff', 0.64);
    }

    return 'rgba(255,255,255,0.38)';
  };

  /**
   * Get text color for header/footer rows (white text on dark bg)
   */
  const getHeaderTextColor = (rowIdx: number): string | undefined => {
    if (!theme) return undefined;
    const rowCount = data.length;
    if (theme.rowHeader && rowIdx === 0) return academyPaperTheme.ink;
    if (theme.rowFooter && rowIdx === rowCount - 1) return academyPaperTheme.ink;
    return undefined;
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${fitScale})`,
          transformOrigin: 'top left',
        }}
      >
        <table
          ref={tableRef}
          className="h-auto"
          style={{
            width: `${width}px`,
            minWidth: `${width}px`,
            borderCollapse: 'separate',
            borderSpacing: 0,
            tableLayout: 'fixed',
            color: academyPaperTheme.body,
          }}
        >
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: `${w * width}px` }} />
            ))}
          </colgroup>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr key={rowIdx} style={{ height: `${cellMinHeight}px` }}>
                {row.map((cell, colIdx) => {
                  if (hiddenCells.has(`${rowIdx}_${colIdx}`)) return null;

                  const bgColor = getCellBg(rowIdx, colIdx, cell.style?.backcolor);
                  const headerColor = getHeaderTextColor(rowIdx);
                  const textStyle = getTextStyle(cell.style);

                  if (headerColor && !cell.style?.color) {
                    textStyle.color = headerColor;
                  }

                  return (
                    <td
                      key={cell.id}
                      colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                      rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                      style={{
                        border: borderStyle,
                        backgroundColor: bgColor,
                        padding: '7px 8px',
                        verticalAlign: 'middle',
                        wordBreak: 'break-word',
                        ...textStyle,
                      }}
                    >
                      <TableCellHtml text={cell.text} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableCellHtml({ text }: { text: string }) {
  const [renderedHtml, setRenderedHtml] = useState(() => formatPlainText(text));

  useEffect(() => {
    setRenderedHtml(formatText(text));
  }, [text]);

  return <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
}
