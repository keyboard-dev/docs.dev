'use client';

/**
 * Pretext flow engine.
 *
 * This is the heart of the docs.dev reading experience. It takes a block of
 * prose plus a set of "obstacles" (images, code blocks, callouts, decorative
 * shapes) and lays the text out so it flows *around* them — like a magazine
 * spread rather than a vertical stack of blocks.
 *
 * How it stays honest about SEO / accessibility:
 *   - The server renders the real prose as a normal <p> (the `data-flow-source`
 *     node). Crawlers, screen readers, and no-JS visitors get clean, readable
 *     text in correct reading order.
 *   - After hydration, the client measures the text with pretext (pure canvas
 *     arithmetic, zero DOM reflow) and re-lays it out into absolutely
 *     positioned line spans. Same text, just repositioned. We then hide the
 *     source node. This is progressive enhancement, not a hidden duplicate.
 *
 * pretext only ever *measures and positions*. It never paints text — the lines
 * you see are real, selectable DOM text nodes.
 */

import {
  prepareWithSegments,
  layoutNextLine,
  type LayoutCursor,
} from '@chenglou/pretext';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type Obstacle = {
  id: string;
  /** Which side of the column the obstacle is pinned to. */
  side: 'left' | 'right';
  /** Obstacle box size, in CSS pixels. */
  width: number;
  height: number;
  /** Distance from the top of the flow, in CSS pixels. */
  top: number;
  /** Gutter between the obstacle and the text. Defaults to 24px. */
  gap?: number;
  /** What to render inside the obstacle box. */
  node: ReactNode;
};

export type FlowProps = {
  /** The prose to lay out. Plain text for now (the real framework feeds it
   *  from MDX, preserving inline marks via the rich-inline API). */
  text: string;
  obstacles?: Obstacle[];
  /** Font knobs. These must match between the canvas measurement and the
   *  rendered spans or the layout drifts, so they live in one place. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  className?: string;
};

type PositionedLine = { text: string; x: number; y: number };

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function Flow({
  text,
  obstacles = [],
  fontFamily = "'Geist', ui-sans-serif, system-ui, sans-serif",
  fontSize = 19,
  fontWeight = 400,
  lineHeight = 32,
  letterSpacing = 0,
  className,
}: FlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<PositionedLine[]>([]);
  const [height, setHeight] = useState<number>(0);
  const [ready, setReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Don't measure until web fonts have settled, or the canvas measures one
  // font and the DOM renders another.
  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    (fonts?.ready ?? Promise.resolve()).then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!fontsReady) return;
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const containerWidth = el.clientWidth;
      if (containerWidth <= 0) return;

      // Canvas font shorthand. Line-height is irrelevant to measureText, so we
      // omit it and drive vertical rhythm ourselves.
      const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      const prepared = prepareWithSegments(text, font, { letterSpacing });

      const next: PositionedLine[] = [];
      let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
      let y = 0;
      const minTextWidth = 48; // never try to set a sliver-thin line
      let guard = 0;

      while (guard++ < 5000) {
        // Find the horizontal slot left open by any obstacle crossing this
        // line's vertical band.
        let leftBound = 0;
        let rightBound = containerWidth;
        const lineTop = y;
        const lineBottom = y + lineHeight;
        for (const o of obstacles) {
          const gap = o.gap ?? 24;
          const oTop = o.top;
          const oBottom = o.top + o.height;
          const overlaps = lineBottom > oTop && lineTop < oBottom;
          if (!overlaps) continue;
          if (o.side === 'left') {
            leftBound = Math.max(leftBound, o.width + gap);
          } else {
            rightBound = Math.min(rightBound, containerWidth - o.width - gap);
          }
        }

        const availWidth = rightBound - leftBound;
        if (availWidth < minTextWidth) {
          // Slot is too narrow here (the obstacle eats the whole column on this
          // line) — skip the band and try the next one down.
          y += lineHeight;
          continue;
        }

        const line = layoutNextLine(prepared, cursor, availWidth);
        if (!line) break;

        next.push({ text: line.text, x: leftBound, y });
        cursor = line.end;
        y += lineHeight;
      }

      // The flow is as tall as the text or the lowest obstacle, whichever wins.
      let bottom = y;
      for (const o of obstacles) bottom = Math.max(bottom, o.top + o.height);

      setLines(next);
      setHeight(bottom);
      setReady(true);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    text,
    obstacles,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    fontsReady,
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', minHeight: ready ? height : undefined }}
    >
      {/* SSR / no-JS / pre-hydration fallback: real, readable prose. */}
      <p
        data-flow-source
        style={{
          margin: 0,
          fontFamily,
          fontSize,
          fontWeight,
          lineHeight: `${lineHeight}px`,
          letterSpacing,
          // Hidden once the upgraded layout is ready, but kept in the DOM so
          // assistive tech and crawlers still see one clean copy of the text.
          display: ready ? 'none' : 'block',
        }}
      >
        {text}
      </p>

      {/* Obstacles: images, code, callouts, decorative shapes. */}
      {ready &&
        obstacles.map((o) => (
          <div
            key={o.id}
            aria-hidden={false}
            style={{
              position: 'absolute',
              top: o.top,
              [o.side]: 0,
              width: o.width,
              height: o.height,
            }}
          >
            {o.node}
          </div>
        ))}

      {/* The laid-out prose: real, selectable text nodes positioned by pretext. */}
      {ready &&
        lines.map((line, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: line.x,
              top: line.y,
              fontFamily,
              fontSize,
              fontWeight,
              lineHeight: `${lineHeight}px`,
              letterSpacing,
              whiteSpace: 'pre',
            }}
          >
            {line.text}
          </span>
        ))}
    </div>
  );
}
