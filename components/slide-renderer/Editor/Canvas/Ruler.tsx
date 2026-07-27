import { useMemo, useEffect, useState } from 'react';
import { useCanvasStore } from '@/lib/store';
import { getElementListRange } from '@/lib/utils/element';
import type { PPTElement } from '@/lib/types/slides';
import type { ViewportStyles } from './hooks/useViewportSize';
import { useCanvasViewportMetrics } from './canvas-viewport-metrics-context';

interface RulerProps {
  viewportStyles: ViewportStyles;
  elementList: PPTElement[];
}

export function Ruler({ viewportStyles, elementList }: RulerProps) {
  const { fittedCanvasScale, contentHeight } = useCanvasViewportMetrics();
  const activeElementIdList = useCanvasStore.use.activeElementIdList();
  const viewportSize = useCanvasStore.use.viewportSize();

  const [elementListRange, setElementListRange] = useState<ReturnType<
    typeof getElementListRange
  > | null>(null);

  useEffect(() => {
    const els = elementList.filter((el) => activeElementIdList.includes(el.id));
    if (!els.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
      setElementListRange(null);
    } else {
      setElementListRange(getElementListRange(els));
    }
  }, [elementList, activeElementIdList]);

  const markerSize = useMemo(() => {
    return (viewportStyles.width * fittedCanvasScale) / (viewportSize / 100);
  }, [viewportStyles.width, fittedCanvasScale, viewportSize]);

  const markers = Array.from({ length: 20 }, (_, i) => i + 1);
  const verticalMarkerCount = Math.min(40, Math.max(1, Math.ceil(contentHeight / 100)));
  const verticalMarkers = Array.from({ length: verticalMarkerCount }, (_, i) => i + 1);

  return (
    <div className="ruler text-xs">
      {/* Ruler corner */}
      <div
        className="corner absolute bg-white border border-gray-200 w-5 h-5"
        style={{
          left: viewportStyles.left - 25 + 'px',
          top: viewportStyles.top - 25 + 'px',
        }}
      />

      {/* Horizontal ruler */}
      <div
        className="h absolute bg-white border border-gray-200 h-5 flex justify-between items-center overflow-hidden"
        style={{
          width: viewportStyles.width * fittedCanvasScale + 'px',
          left: viewportStyles.left + 'px',
          top: viewportStyles.top - 25 + 'px',
        }}
      >
        {markers.map((marker) => (
          <div
            key={`h-marker-100-${marker}`}
            className={`ruler-marker-100 h-full leading-5 text-right flex-shrink-0 pr-[5px] relative ${
              markerSize < 36 ? '[&>span]:hidden' : ''
            } ${markerSize < 72 ? 'before:hidden' : ''}`}
            style={{ width: markerSize + 'px' }}
          >
            {marker * 100 <= viewportSize && <span>{marker * 100}</span>}
            {/* Major tick mark */}
            <div className="absolute right-0 bottom-0 w-[0.1px] h-3 bg-gray-600 last:content-none" />
            {/* Minor tick mark (50) */}
            <div className="absolute right-1/2 bottom-0 w-[0.1px] h-2 bg-gray-600" />
          </div>
        ))}

        {elementListRange && (
          <div
            className="range absolute top-0 bottom-0 bg-primary/10"
            style={{
              left: elementListRange.minX * fittedCanvasScale + 'px',
              width: (elementListRange.maxX - elementListRange.minX) * fittedCanvasScale + 'px',
            }}
          />
        )}
      </div>

      {/* Vertical ruler */}
      <div
        className="v absolute bg-white border border-gray-200 w-5 overflow-hidden"
        style={{
          height: contentHeight * fittedCanvasScale + 'px',
          top: viewportStyles.top + 'px',
          left: viewportStyles.left - 25 + 'px',
        }}
      >
        {verticalMarkers.map((marker) => (
          <div
            key={`v-marker-100-${marker}`}
            className={`ruler-marker-100 w-full leading-5 text-right pb-[5px] relative [writing-mode:vertical-rl] ${
              markerSize < 36 ? '[&>span]:hidden' : ''
            } ${markerSize < 72 ? 'before:hidden' : ''}`}
            style={{ height: markerSize + 'px' }}
          >
            {marker * 100 <= contentHeight && <span>{marker * 100}</span>}
            {/* Major tick mark */}
            <div className="absolute bottom-0 right-0 h-[0.1px] w-3 bg-gray-600 last:content-none" />
            {/* Minor tick mark (50) */}
            <div className="absolute bottom-1/2 right-0 h-[0.1px] w-2 bg-gray-600" />
          </div>
        ))}

        {elementListRange && (
          <div
            className="range absolute left-0 right-0 bg-primary/10"
            style={{
              top: elementListRange.minY * fittedCanvasScale + 'px',
              height: (elementListRange.maxY - elementListRange.minY) * fittedCanvasScale + 'px',
            }}
          />
        )}
      </div>
    </div>
  );
}
