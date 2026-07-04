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
 * Progressive enhancement, honestly:
 *   - The server renders the ordinary prose (`fallback`), with the figure
 *     floated, so pre-hydration readers see nearly the final geometry.
 *   - Once measured, the flowed layout fades in and the fallback moves to a
 *     screen-reader-only style (NOT display:none — assistive tech keeps one
 *     clean, correctly-ordered copy) while the fragmented flow layer is
 *     aria-hidden.
 *   - Typography is resolved from the container's computed style unless
 *     overridden, so flowed prose always matches the surrounding page — same
 *     family, size, and rhythm in any theme.
 *   - Lines are grouped into block-level rows so selecting and copying flowed
 *     text produces normal line-broken text, not jammed-together words.
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
  /** Caption under the figure. `text` is measured (canvas arithmetic, like
   *  everything else) so the flow reserves the right space; `node` optionally
   *  overrides the rendered element (the editor passes an editable one). */
  caption?: { text: string; node?: ReactNode };
};

const CAPTION_SIZE = 12.5;
const CAPTION_LINE = 17;
const CAPTION_GAP = 8;

let measureCtx: CanvasRenderingContext2D | null = null;
function captionHeight(text: string, family: string, width: number): number {
  if (!text) return CAPTION_LINE + CAPTION_GAP; // empty editable placeholder row
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return CAPTION_LINE + CAPTION_GAP;
  measureCtx.font = `${CAPTION_SIZE}px ${family}`;
  const lines = Math.max(1, Math.ceil(measureCtx.measureText(text).width / Math.max(60, width)));
  return lines * CAPTION_LINE + CAPTION_GAP;
}

// Below this column width the figure goes full-width and prose stacks.
const NARROW_WIDTH = 560;

type PlacedObstacle = {
  id: string;
  node: ReactNode;
  x: number;
  top: number;
  w: number;
  /** Figure height (excluding caption). */
  h: number;
  capH: number;
  caption?: { text: string; node?: ReactNode };
};

export type RichFlowProps = {
  runs: Run[];
  obstacles?: FlowObstacle[];
  /** Server-rendered, pre-hydration content. Kept in the DOM (visually hidden,
   *  AT-visible) once the flow is ready, so crawlers and assistive tech always
   *  get clean prose in reading order. */
  fallback: ReactNode;
  /** Typography. When omitted, resolved from the container's computed style so
   *  flowed text matches the surrounding page exactly (any theme, any font). */
  fontFamily?: string;
  monoFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  className?: string;
};

type Frag = {
  key: string;
  text: string;
  /** x relative to the line's left edge. */
  dx: number;
  kind: Run['kind'];
  href?: string;
};

type Line = { key: string; x: number; y: number; frags: Frag[] };

type ResolvedFont = { family: string; mono: string; size: number; lineHeight: number; strongWeight: number };

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const MIN_SLOT_WIDTH = 56;
// Inline code renders slightly smaller than prose (matching typical docs
// styling); the same factor is used for measurement so layout never drifts.
const CODE_SCALE = 0.94;

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function RichFlow({
  runs,
  obstacles = [],
  fallback,
  fontFamily,
  monoFamily,
  fontSize,
  lineHeight,
  className,
}: RichFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [placedObstacles, setPlacedObstacles] = useState<PlacedObstacle[]>([]);
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [font, setFont] = useState<ResolvedFont | null>(null);

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
    if (!fontsReady || runs.length === 0) return;
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const containerWidth = el.clientWidth;
      if (containerWidth <= 0) return;

      // Resolve typography from the surrounding page unless overridden. This
      // is what keeps flowed prose indistinguishable from ordinary prose.
      const cs = getComputedStyle(el);
      const size = fontSize ?? (parseFloat(cs.fontSize) || 16);
      const csLine = parseFloat(cs.lineHeight);
      const resolved: ResolvedFont = {
        family: fontFamily ?? (cs.fontFamily || 'ui-sans-serif, system-ui, sans-serif'),
        mono: monoFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace',
        size,
        lineHeight: lineHeight ?? (Number.isNaN(csLine) ? Math.round(size * 1.75) : csLine),
        strongWeight: 600,
      };

      const fontForKind = (kind: Run['kind']): string => {
        switch (kind) {
          case 'code':
            return `${resolved.size * CODE_SCALE}px ${resolved.mono}`;
          case 'strong':
            return `${resolved.strongWeight} ${resolved.size}px ${resolved.family}`;
          case 'em':
            return `italic ${resolved.size}px ${resolved.family}`;
          default:
            return `${resolved.size}px ${resolved.family}`;
        }
      };

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
        const capH = o.caption ? captionHeight(o.caption.text, resolved.family, w) : 0;
        const top = full ? (o.anchorTop != null && !narrow ? o.anchorTop : 0) : o.anchorTop ?? 6;
        const x = full ? 0 : o.side === 'left' ? 0 : o.side === 'inline' ? Math.round((containerWidth - w) / 2) : containerWidth - w;
        placedObs.push({ id: o.id, node: o.node, x, top, w, h, capH, caption: o.caption });

        if (full) {
          // Spans the whole column → no slot in this band → text stacks below.
          rects.push({ x: 0, y: top, w: containerWidth, h: h + capH });
        } else if (o.shape === 'circle') {
          circles.push({ cx: x + w / 2, cy: top + h / 2, r: w / 2, hPad: gap, vPad: gap / 2 });
          // The caption band below the circle is rectangular.
          if (capH > 0) rects.push({ x: x - gap, y: top + h, w: w + gap * 2, h: capH + gap / 2 });
        } else if (o.side === 'inline') {
          rects.push({ x: x - gap, y: top, w: w + gap * 2, h: h + capH });
        } else {
          rects.push({ x: x === 0 ? 0 : x - gap, y: top, w: w + gap, h: h + capH });
        }
      }

      const lh = resolved.lineHeight;
      const nextLines: Line[] = [];
      let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
      let y = 0;
      let guard = 0;
      let exhausted = false;
      let keyN = 0;

      while (!exhausted && guard++ < 4000) {
        const blocked = blockedIntervalsForBand(y, y + lh, rects, circles);
        const slots = carveTextLineSlots(
          { left: 0, right: containerWidth },
          blocked,
          MIN_SLOT_WIDTH,
        );
        if (slots.length === 0) {
          y += lh;
          continue;
        }

        for (const slot of slots) {
          const range = layoutNextRichInlineLineRange(prepared, slot.right - slot.left, cursor);
          if (!range) {
            exhausted = true;
            break;
          }
          const line = materializeRichInlineLineRange(prepared, range);
          const frags: Frag[] = [];
          let x = 0;
          for (const frag of line.fragments) {
            x += frag.gapBefore;
            const run = runs[frag.itemIndex];
            frags.push({
              key: `${keyN++}`,
              text: frag.text,
              dx: x,
              kind: run?.kind ?? 'text',
              href: run?.href,
            });
            x += frag.occupiedWidth;
          }
          if (frags.length > 0) nextLines.push({ key: `L${keyN++}`, x: slot.left, y, frags });
          cursor = range.end;
        }

        y += lh;
      }

      let bottom = y;
      for (const o of placedObs) bottom = Math.max(bottom, o.top + o.h + o.capH);

      setLines(nextLines);
      setPlacedObstacles(placedObs);
      setHeight(bottom);
      setFont(resolved);
      setReady(true);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [runs, obstacles, fontFamily, monoFamily, fontSize, lineHeight, fontsReady]);

  const fragStyle = (kind: Run['kind']): CSSProperties => {
    const f = font!;
    return {
      position: 'absolute',
      top: 0,
      fontFamily: kind === 'code' ? f.mono : f.family,
      fontSize: kind === 'code' ? f.size * CODE_SCALE : f.size,
      fontWeight: kind === 'strong' ? f.strongWeight : 400,
      fontStyle: kind === 'em' ? 'italic' : 'normal',
      lineHeight: `${f.lineHeight}px`,
      whiteSpace: 'pre',
      ...(kind === 'code'
        ? {
            background: 'var(--pretext-code-bg, var(--color-fd-secondary, rgba(127,127,127,0.14)))',
            borderRadius: 4,
            // Visual chip without occupying layout width, so the painted code
            // matches pretext's measured geometry exactly.
            padding: '1px 3px',
            margin: '-1px -3px',
          }
        : null),
      ...(kind === 'link'
        ? { color: 'var(--docsdev-accent, #c2571f)', textDecoration: 'underline', textUnderlineOffset: 3 }
        : null),
    };
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', minHeight: ready ? height : undefined }}
    >
      {/* SSR / no-JS / pre-hydration content; after upgrade it stays in the
          accessibility tree (visually hidden) as the one clean copy. */}
      <div data-flow-source style={ready ? SR_ONLY : undefined}>
        {fallback}
      </div>

      {ready && (
        <div aria-hidden className="pretext-flow-layer">
          {placedObstacles.map((o) => (
            <div
              key={o.id}
              style={{ position: 'absolute', left: o.x, top: o.top, width: o.w, height: o.h + o.capH }}
            >
              <div style={{ height: o.h }}>{o.node}</div>
              {o.caption &&
                (o.caption.node ?? (
                  <figcaption
                    style={{
                      marginTop: CAPTION_GAP,
                      fontSize: CAPTION_SIZE,
                      lineHeight: `${CAPTION_LINE}px`,
                      textAlign: 'center',
                      color: 'var(--color-fd-muted-foreground, #888)',
                    }}
                  >
                    {o.caption.text}
                  </figcaption>
                ))}
            </div>
          ))}

          {/* Block-level line rows (so copy/paste inserts line breaks), each
              holding its measured fragments. */}
          {lines.map((line) => (
            <div
              key={line.key}
              style={{
                position: 'absolute',
                left: line.x,
                top: line.y,
                height: font!.lineHeight,
                width: '100%',
                pointerEvents: 'none',
              }}
            >
              {line.frags.map((p) =>
                p.kind === 'link' ? (
                  <a
                    key={p.key}
                    href={p.href}
                    className="pretext-link"
                    style={{ ...fragStyle('link'), left: p.dx, pointerEvents: 'auto' }}
                  >
                    {p.text}
                  </a>
                ) : (
                  <span key={p.key} style={{ ...fragStyle(p.kind), left: p.dx, pointerEvents: 'auto' }}>
                    {p.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
