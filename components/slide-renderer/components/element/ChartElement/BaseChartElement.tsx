'use client';

import type { PPTChartElement } from '@/lib/types/slides';
import {
  academyPaperBackground,
  academyPaperTheme,
  isLightPaperColor,
  normalizeAccentForAcademyPaper,
} from '../academyPaperTheme';
import { ElementOutline } from '../ElementOutline';
import { Chart } from './Chart';

export interface BaseChartElementProps {
  elementInfo: PPTChartElement;
  target?: string;
}

/**
 * Base chart element for read-only/playback mode
 */
export function BaseChartElement({ elementInfo, target }: BaseChartElementProps) {
  const chartAccent = normalizeAccentForAcademyPaper(
    elementInfo.themeColors?.[0] || elementInfo.lineColor || academyPaperTheme.primary,
  );
  const usePaperSurface = isLightPaperColor(elementInfo.fill);

  return (
    <div
      className={`base-element-chart absolute ${target === 'thumbnail' ? 'pointer-events-none' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className="element-content w-full h-full overflow-hidden"
          style={{
            background: usePaperSurface ? academyPaperBackground(chartAccent) : undefined,
            backgroundColor: usePaperSurface ? undefined : elementInfo.fill,
            border: usePaperSurface ? `1px solid ${academyPaperTheme.cardBorder}` : undefined,
            borderRadius: usePaperSurface ? 18 : undefined,
            boxShadow: usePaperSurface ? academyPaperTheme.quietShadow : undefined,
          }}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />
          <Chart
            width={elementInfo.width}
            height={elementInfo.height}
            type={elementInfo.chartType}
            data={elementInfo.data}
            themeColors={elementInfo.themeColors.map(normalizeAccentForAcademyPaper)}
            textColor={elementInfo.textColor || academyPaperTheme.body}
            lineColor={elementInfo.lineColor || 'rgba(151,130,91,0.22)'}
            options={elementInfo.options}
          />
        </div>
      </div>
    </div>
  );
}
