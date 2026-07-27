'use client';

import { useMemo } from 'react';
import type { PPTShapeElement, ShapeText } from '@/lib/types/slides';
import { renderHtmlWithLatex } from '@/lib/render-html-with-latex';
import { useElementOutline } from '../hooks/useElementOutline';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useElementFill } from '../hooks/useElementFill';
import { GradientDefs } from './GradientDefs';
import { PatternDefs } from './PatternDefs';
import { ShapeTextSurface } from './ShapeTextSurface';

export interface BaseShapeElementProps {
  elementInfo: PPTShapeElement;
}

function isLightPaperFill(fill: string | undefined): boolean {
  if (!fill) return false;
  const normalized = fill.trim().toLowerCase();
  const rgbaMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgbaMatch) {
    const [red, green, blue] = rgbaMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()));
    return red >= 238 && green >= 238 && blue >= 238;
  }
  if (!normalized.startsWith('#')) return false;
  const hex = normalized.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex.slice(0, 6);
  if (full.length !== 6) return false;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return red >= 238 && green >= 238 && blue >= 238;
}

function isRectPath(path: string): boolean {
  return /^M\s*0\s+0\s+L\s*200\s+0\s+L\s*200\s+200\s+L\s*0\s+200\s+Z$/i.test(path.trim());
}

function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `Q ${width} 0 ${width} ${r}`,
    `L ${width} ${height - r}`,
    `Q ${width} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `Q 0 ${height} 0 ${height - r}`,
    `L 0 ${r}`,
    `Q 0 0 ${r} 0`,
    'Z',
  ].join(' ');
}

/**
 * Base shape element for read-only/playback mode
 */
export function BaseShapeElement({ elementInfo }: BaseShapeElementProps) {
  const { fill } = useElementFill(elementInfo, 'base');
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(elementInfo.outline);
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);

  const text: ShapeText = elementInfo.text || {
    content: '',
    align: 'middle',
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#333333',
  };
  const renderedTextContent = useMemo(() => renderHtmlWithLatex(text.content), [text.content]);
  const useAcademyPaperCard =
    isRectPath(elementInfo.path) &&
    !elementInfo.gradient &&
    !elementInfo.pattern &&
    elementInfo.width >= 180 &&
    elementInfo.height >= 56 &&
    isLightPaperFill(elementInfo.fill);
  const displayFill = useAcademyPaperCard ? 'rgba(255,253,248,0.84)' : fill;
  const displayStroke = useAcademyPaperCard ? 'rgba(188,169,133,0.3)' : outlineColor;
  const displayPath = useAcademyPaperCard
    ? roundedRectPath(elementInfo.viewBox[0], elementInfo.viewBox[1], 12)
    : elementInfo.path;
  const displayFilter = useAcademyPaperCard
    ? 'drop-shadow(0px 18px 34px rgba(106,84,45,0.11)) drop-shadow(0px 4px 10px rgba(72,54,35,0.05))'
    : shadowStyle
      ? `drop-shadow(${shadowStyle})`
      : '';

  return (
    <div
      className="base-element-shape absolute"
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
          className="element-content relative w-full h-full"
          style={{
            opacity: elementInfo.opacity,
            filter: displayFilter,
            transform: flipStyle,
            color: text.defaultColor,
            fontFamily: text.defaultFontName,
          }}
        >
          <svg
            overflow="visible"
            width={elementInfo.width}
            height={elementInfo.height}
            className="transform-origin-[0_0] overflow-visible block"
          >
            <defs>
              {elementInfo.pattern && (
                <PatternDefs id={`base-pattern-${elementInfo.id}`} src={elementInfo.pattern} />
              )}
              {elementInfo.gradient && (
                <GradientDefs
                  id={`base-gradient-${elementInfo.id}`}
                  type={elementInfo.gradient.type}
                  colors={elementInfo.gradient.colors}
                  rotate={elementInfo.gradient.rotate}
                />
              )}
            </defs>
            <g
              transform={`scale(${elementInfo.width / elementInfo.viewBox[0]}, ${
                elementInfo.height / elementInfo.viewBox[1]
              }) translate(0,0) matrix(1,0,0,1,0,0)`}
            >
              <path
                vectorEffect="non-scaling-stroke"
                strokeLinecap="butt"
                strokeMiterlimit="8"
                d={displayPath}
                fill={displayFill}
                stroke={displayStroke}
                strokeWidth={outlineWidth}
                strokeDasharray={strokeDashArray}
              />
            </g>
          </svg>

          <ShapeTextSurface
            align={text.align}
            style={{
              lineHeight: text.lineHeight,
              letterSpacing: `${text.wordSpace || 0}px`,
              // @ts-expect-error CSS custom properties
              '--paragraphSpace': `${text.paragraphSpace === undefined ? 5 : text.paragraphSpace}px`,
            }}
          >
            <div
              className="ProseMirror-static [&_ol]:my-0 [&_p]:m-0 [&_p:not(:last-child)]:mb-[var(--paragraphSpace)] [&_ul]:my-0"
              dangerouslySetInnerHTML={{ __html: renderedTextContent }}
            />
          </ShapeTextSurface>
        </div>
      </div>
    </div>
  );
}
