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
  /** Relative placement (design's model). `inline` centers the figure and lets
   *  pretext flow text on BOTH sides; `full` spans the column (text stacks). */
  side: 'left' | 'right' | 'inline' | 'full';
  shape?: 'rect' | 'circle';
  /** Figure width as a percentage of the column — keeps the editor and the
   *  published page identical at any width, and reflows responsively. */
  widthPct: number;
  /** Box aspect ratio (width / height). Default 4/3 for images, 1 for circles. */
  aspect?: number;
  /** Vertical offset from the top of the flow, in px. */
  anchorTop?: number;
  gap?: number;
  node: ReactNode;
};

// Below this column width the figure goes full-width and prose stacks.
const NARROW_WIDTH = 560;

type PlacedObstacle = { id: string; node: ReactNode; x: number; top: number; w: number; h: number };

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
  const [placedObstacles, setPlacedObstacles] = useState<PlacedObstacle[]>([]);
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

      // Translate the relative obstacle model into px geometry for the carver,
      // recomputed against the *current* width so it's WYSIWYG and responsive.
      const narrow = containerWidth <= NARROW_WIDTH;
      const rects: RectObstacle[] = [];
      const circles: CircleObstacle[] = [];
      const placedObs: PlacedObstacle[] = [];
      for (const o of obstacles) {
        const gap = o.gap ?? 24;
        const full = narrow || o.side === 'full';
        const w = full ? containerWidth : Math.round((o.widthPct / 100) * containerWidth);
        const aspect = o.aspect ?? (o.shape === 'circle' ? 1 : 4 / 3);
        const h = Math.round(w / aspect);
        const top = full ? (o.anchorTop != null && !narrow ? o.anchorTop : 0) : o.anchorTop ?? 6;
        const x = full ? 0 : o.side === 'left' ? 0 : o.side === 'inline' ? Math.round((containerWidth - w) / 2) : containerWidth - w;
        placedObs.push({ id: o.id, node: o.node, x, top, w, h });

        if (full) {
          // Spans the whole column → no slot in this band → text stacks below.
          rects.push({ x: 0, y: top, w: containerWidth, h });
        } else if (o.shape === 'circle') {
          circles.push({ cx: x + w / 2, cy: top + h / 2, r: w / 2, hPad: gap, vPad: gap / 2 });
        } else {
          rects.push({ x: x === 0 ? 0 : x - gap, y: top, w: w + gap, h });
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
      for (const o of placedObs) bottom = Math.max(bottom, o.top + o.h);

      setPlaced(next);
      setPlacedObstacles(placedObs);
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
      ? { color: 'var(--docsdev-accent, #c2571f)', textDecoration: 'underline' }
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
        placedObstacles.map((o) => (
          <div
            key={o.id}
            style={{ position: 'absolute', left: o.x, top: o.top, width: o.w, height: o.h }}
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
