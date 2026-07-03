'use client';

/**
 * PageFlow — the docs.dev layout engine (milestone 1).
 *
 * Lays out a whole page as a measured, flowing column instead of a vertical
 * stack: paragraphs flow as pretext rich-inline text (marks preserved) around a
 * floating figure, while non-prose blocks (code, tables, components) are kept
 * intact as "atomic" boxes — measured once via the DOM and placed, never
 * flattened. Text wraps on both sides of the figure; atomic blocks that would
 * collide with it are pushed below it.
 *
 * Progressive enhancement: children render normally for SSR/SEO/no-JS, then the
 * client upgrades to the flowed layout. The flowed text stays real DOM.
 */

import {
  prepareRichInline,
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  type RichInlineCursor,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline';
import {
  Children,
  isValidElement,
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
import { extractRuns, type Run } from './extract-runs';

export type PageFigure = {
  src?: string;
  orb?: boolean;
  side: 'left' | 'right';
  width: number;
  height: number;
  top: number;
  gap?: number;
};

type ProseItem = { kind: 'prose'; runs: Run[] };
type AtomicItem = { kind: 'atomic'; node: ReactNode };
type Item = ProseItem | AtomicItem;

type PlacedLine = { key: string; text: string; x: number; y: number; kind: Run['kind']; href?: string };

const useIso = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const MIN_SLOT = 56;
const PARA_GAP = 18;
const BLOCK_GAP = 24;

function tagOf(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name || '';
  return '';
}

export function PageFlow({
  children,
  figure,
  fontFamily = 'Georgia, "Times New Roman", serif',
  monoFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize = 19,
  lineHeight = 32,
}: {
  children: ReactNode;
  figure?: PageFigure;
  fontFamily?: string;
  monoFamily?: string;
  fontSize?: number;
  lineHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<PlacedLine[]>([]);
  const [atomicTops, setAtomicTops] = useState<Record<number, number>>({});
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Classify top-level blocks: <p> flows, everything else is atomic.
  const items: Item[] = useMemo(() => {
    return Children.toArray(children)
      .filter(isValidElement)
      .map((el) => {
        const tag = tagOf((el as React.ReactElement).type).toLowerCase();
        const props = (el as React.ReactElement).props as { children?: ReactNode };
        if (tag === 'p') return { kind: 'prose', runs: extractRuns(props.children) } as ProseItem;
        return { kind: 'atomic', node: el } as AtomicItem;
      });
  }, [children]);

  const fontForKind = useMemo(
    () => (kind: Run['kind']) => {
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
    },
    [fontFamily, monoFamily, fontSize],
  );

  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    (fonts?.ready ?? Promise.resolve()).then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useIso(() => {
    if (!fontsReady) return;
    const el = containerRef.current;
    const measure = measureRef.current;
    if (!el || !measure) return;

    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;

      // Measure atomic block heights from the hidden layer.
      const heights: Record<number, number> = {};
      measure.querySelectorAll<HTMLElement>('[data-atomic]').forEach((node) => {
        heights[Number(node.dataset.atomic)] = node.offsetHeight;
      });

      // Build figure obstacles.
      const rects: RectObstacle[] = [];
      const circles: CircleObstacle[] = [];
      let figTop = 0;
      let figBottom = 0;
      if (figure) {
        const gap = figure.gap ?? 28;
        const fx = figure.side === 'left' ? 0 : width - figure.width;
        figTop = figure.top;
        figBottom = figure.top + figure.height;
        if (figure.orb) {
          circles.push({ cx: fx + figure.width / 2, cy: figure.top + figure.height / 2, r: figure.width / 2, hPad: gap, vPad: gap / 2 });
        } else {
          rects.push({ x: figure.side === 'left' ? fx : fx - gap, y: figure.top, w: figure.width + gap, h: figure.height });
        }
      }

      const placed: PlacedLine[] = [];
      const tops: Record<number, number> = {};
      let y = 0;
      let keyN = 0;

      items.forEach((it, i) => {
        if (it.kind === 'prose') {
          if (it.runs.length === 0) return;
          const rii: RichInlineItem[] = it.runs.map((r) => ({ text: r.text, font: fontForKind(r.kind) }));
          const prepared = prepareRichInline(rii);
          let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
          let exhausted = false;
          let guard = 0;
          while (!exhausted && guard++ < 4000) {
            const blocked = blockedIntervalsForBand(y, y + lineHeight, rects, circles);
            const slots = carveTextLineSlots({ left: 0, right: width }, blocked, MIN_SLOT);
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
                const run = it.runs[frag.itemIndex];
                placed.push({ key: `${keyN++}`, text: frag.text, x, y, kind: run?.kind ?? 'text', href: run?.href });
                x += frag.occupiedWidth;
              }
              cursor = range.end;
            }
            y += lineHeight;
          }
          y += PARA_GAP;
        } else {
          const h = heights[i] ?? 0;
          // Don't let an atomic block collide with the figure.
          if (figure && y < figBottom && y + h > figTop) y = figBottom + (figure.gap ?? 28);
          tops[i] = y;
          y += h + BLOCK_GAP;
        }
      });

      let bottom = y;
      if (figure) bottom = Math.max(bottom, figBottom);
      setLines(placed);
      setAtomicTops(tops);
      setHeight(bottom);
      setReady(true);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, figure, fontForKind, fontSize, lineHeight, fontsReady]);

  const spanStyle = (kind: Run['kind']): CSSProperties => ({
    position: 'absolute',
    fontFamily: kind === 'code' ? monoFamily : fontFamily,
    fontSize: kind === 'code' ? fontSize * 0.94 : fontSize,
    fontWeight: kind === 'strong' ? 700 : 400,
    fontStyle: kind === 'em' ? 'italic' : 'normal',
    lineHeight: `${lineHeight}px`,
    whiteSpace: 'pre',
    ...(kind === 'code' ? { background: 'var(--pretext-code-bg, rgba(127,127,127,0.14))', borderRadius: 4, padding: '0 4px' } : null),
    ...(kind === 'link' ? { color: 'var(--docsdev-accent, #e8753b)', textDecoration: 'underline' } : null),
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', minHeight: ready ? height : undefined }}>
      {/* SSR / no-JS fallback */}
      <div data-flow-source style={{ display: ready ? 'none' : 'block' }}>
        {children}
      </div>

      {/* Hidden measurement layer for atomic block heights */}
      <div ref={measureRef} aria-hidden style={{ position: 'absolute', visibility: 'hidden', left: 0, top: 0, width: '100%', pointerEvents: 'none' }}>
        {items.map((it, i) => (it.kind === 'atomic' ? <div key={i} data-atomic={i}>{it.node}</div> : null))}
      </div>

      {ready && figure && (
        <div style={{ position: 'absolute', top: figure.top, [figure.side]: 0, width: figure.width, height: figure.height }}>
          {figure.orb ? (
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)', boxShadow: '0 0 60px 12px rgba(232,117,59,0.4), inset -16px -20px 50px rgba(0,0,0,0.45)' }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={figure.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
          )}
        </div>
      )}

      {ready && items.map((it, i) =>
        it.kind === 'atomic' ? (
          <div key={`a${i}`} style={{ position: 'absolute', top: atomicTops[i] ?? 0, left: 0, width: '100%' }}>
            {it.node}
          </div>
        ) : null,
      )}

      {ready &&
        lines.map((l) =>
          l.kind === 'link' ? (
            <a key={l.key} href={l.href} style={{ ...spanStyle('link'), left: l.x, top: l.y }}>{l.text}</a>
          ) : (
            <span key={l.key} style={{ ...spanStyle(l.kind), left: l.x, top: l.y }}>{l.text}</span>
          ),
        )}
    </div>
  );
}
