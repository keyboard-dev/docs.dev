'use client';

/**
 * Rich flow engine.
 *
 * Lays out styled prose (links, inline code, bold, italic) so it flows around
 * obstacles on both sides at once. Built on pretext's `rich-inline` API:
 * pretext measures every run with its own font via canvas arithmetic and tells
 * us where each fragment sits; we render real, selectable DOM text at those
 * positions. It never paints text or reads the DOM.
 *
 * Like the plain Flow engine, this is progressive enhancement: the server
 * renders the ordinary prose (the `fallback`), and the client upgrades it once
 * measurement is ready — same text, repositioned.
 */

import {
  prepareRichInline,
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  type RichInlineCursor,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  blockedIntervalsForBand,
  carveTextLineSlots,
  type CircleObstacle,
  type RectObstacle,
} from './geometry';
import type { Run } from './extract-runs';

export type FlowObstacle = {
  id: string;
  side: 'left' | 'right';
  shape?: 'rect' | 'circle';
  width: number;
  height: number;
  top: number;
  /** Absolute left offset within the column. Overrides `side` when set —
   *  this is what the visual layout editor sets when you drag the figure. */
  x?: number;
  gap?: number;
  node: ReactNode;
};

export type RichFlowProps = {
  runs: Run[];
  obstacles?: FlowObstacle[];
  /** Server-rendered, pre-hydration content. Kept in the DOM (hidden) once the
   *  flow is ready, so crawlers and assistive tech always see clean prose. */
  fallback: ReactNode;
  fontFamily?: string;
  monoFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  className?: string;
};

type Placed = {
  key: string;
  text: string;
  x: number;
  y: number;
  kind: Run['kind'];
  href?: string;
};

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const MIN_SLOT_WIDTH = 56;

export function RichFlow({
  runs,
  obstacles = [],
  fallback,
  fontFamily = 'Georgia, "Times New Roman", serif',
  monoFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize = 19,
  lineHeight = 32,
  className,
}: RichFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Canvas font shorthand per run kind. Sizes stay equal across kinds so the
  // baselines line up; only family/weight/style change.
  const fontForKind = useMemo(() => {
    return (kind: Run['kind']): string => {
      switch (kind) {
        case 'code':
          return `${fontSize}px ${monoFamily}`;
        case 'strong':
          return `700 ${fontSize}px ${fontFamily}`;
        case 'em':
          return `italic ${fontSize}px ${fontFamily}`;
        default:
          return `${fontSize}px ${fontFamily}`;
      }
    };
  }, [fontFamily, monoFamily, fontSize]);

  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => {
        if (!cancelled) setFontsReady(true);
      });
    } else {
      setFontsReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!fontsReady || runs.length === 0) return;
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const containerWidth = el.clientWidth;
      if (containerWidth <= 0) return;

      const items: RichInlineItem[] = runs.map((run) => ({
        text: run.text,
        font: fontForKind(run.kind),
      }));
      const prepared = prepareRichInline(items);

      // Translate obstacles into geometry the carver understands.
      const rects: RectObstacle[] = [];
      const circles: CircleObstacle[] = [];
      for (const o of obstacles) {
        const gap = o.gap ?? 24;
        const x = o.x ?? (o.side === 'left' ? 0 : containerWidth - o.width);
        if (o.shape === 'circle') {
          circles.push({
            cx: x + o.width / 2,
            cy: o.top + o.height / 2,
            r: o.width / 2,
            hPad: gap,
            vPad: gap / 2,
          });
        } else {
          rects.push({
            x: o.side === 'left' ? x : x - gap,
            y: o.top,
            w: o.width + gap,
            h: o.height,
          });
        }
      }

      const next: Placed[] = [];
      let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
      let y = 0;
      let guard = 0;
      let exhausted = false;
      let keyN = 0;

      while (!exhausted && guard++ < 4000) {
        const blocked = blockedIntervalsForBand(y, y + lineHeight, rects, circles);
        const slots = carveTextLineSlots(
          { left: 0, right: containerWidth },
          blocked,
          MIN_SLOT_WIDTH,
        );
        if (slots.length === 0) {
          y += lineHeight;
          continue;
        }

        for (const slot of slots) {
          const range = layoutNextRichInlineLineRange(prepared, slot.right - slot.left, cursor);
          if (!range) {
            exhausted = true;
            break;
          }
          const line = materializeRichInlineLineRange(prepared, range);
          let x = slot.left;
          for (const frag of line.fragments) {
            x += frag.gapBefore;
            const run = runs[frag.itemIndex];
            next.push({
              key: `${keyN++}`,
              text: frag.text,
              x,
              y,
              kind: run?.kind ?? 'text',
              href: run?.href,
            });
            x += frag.occupiedWidth;
          }
          cursor = range.end;
        }

        y += lineHeight;
      }

      let bottom = y;
      for (const o of obstacles) bottom = Math.max(bottom, o.top + o.height);

      setPlaced(next);
      setHeight(bottom);
      setReady(true);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [runs, obstacles, fontForKind, fontSize, lineHeight, fontsReady]);

  const baseStyle = (kind: Run['kind']): CSSProperties => ({
    position: 'absolute',
    fontFamily: kind === 'code' ? monoFamily : fontFamily,
    fontSize: kind === 'code' ? fontSize * 0.94 : fontSize,
    fontWeight: kind === 'strong' ? 700 : 400,
    fontStyle: kind === 'em' ? 'italic' : 'normal',
    lineHeight: `${lineHeight}px`,
    whiteSpace: 'pre',
    ...(kind === 'code'
      ? {
          background: 'var(--pretext-code-bg, rgba(127,127,127,0.14))',
          borderRadius: 4,
          padding: '0 4px',
        }
      : null),
    ...(kind === 'link'
      ? { color: 'var(--pretext-link, #e8753b)', textDecoration: 'underline' }
      : null),
  });

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', minHeight: ready ? height : undefined }}
    >
      <div data-flow-source style={{ display: ready ? 'none' : 'block' }}>
        {fallback}
      </div>

      {ready &&
        obstacles.map((o) => (
          <div
            key={o.id}
            style={{
              position: 'absolute',
              top: o.top,
              ...(o.x != null ? { left: o.x } : { [o.side]: 0 }),
              width: o.width,
              height: o.height,
            }}
          >
            {o.node}
          </div>
        ))}

      {ready &&
        placed.map((p) =>
          p.kind === 'link' ? (
            <a key={p.key} href={p.href} style={{ ...baseStyle('link'), left: p.x, top: p.y }}>
              {p.text}
            </a>
          ) : (
            <span key={p.key} style={{ ...baseStyle(p.kind), left: p.x, top: p.y }}>
              {p.text}
            </span>
          ),
        )}
    </div>
  );
}
