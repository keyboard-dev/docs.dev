'use client';

/**
 * <Spread> — the author-facing magazine-flow component.
 *
 * Doc authors write ordinary Markdown prose inside it and drop in a figure; the
 * text flows around the figure (via pretext, on both sides for `inline`) with
 * links, `code`, and **bold** intact. Everything outside <Spread> stays a
 * normal Fumadocs docs page.
 *
 * Position is relative — a side, a width as a percentage of the column, and a
 * vertical anchor — so what you arrange in the editor is what ships at any
 * width, and it reflows to full-width on small screens.
 *
 *   <Spread orb side="right" width="42%">
 *   Markdown with **bold**, `code`, [links](/foo) that flows around the figure…
 *   </Spread>
 *
 *   <Spread image="/diagram.png" alt="Architecture" side="inline" width="50%">…</Spread>
 *
 * The server renders the fallback with the figure floated to its side, so
 * pre-hydration readers already see close-to-final geometry; pretext then
 * upgrades the same text into the true both-sides flow.
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { RichFlow, type FlowObstacle } from './rich-flow';
import { extractRuns } from './extract-runs';
import { DraftImage } from '@/components/draft-image';

export type SpreadProps = {
  children: ReactNode;
  /** A custom figure node (image, diagram, anything). */
  figure?: ReactNode;
  /** Convenience: render an <img> as the figure. */
  image?: string;
  alt?: string;
  /** Convenience: render a built-in glowing orb as the figure. */
  orb?: boolean;
  /** Caption rendered under the figure; the flow reserves space for it. */
  caption?: string;
  /** Left / Right float, Inline (centered, text both sides), or Full width. */
  side?: 'left' | 'right' | 'inline' | 'full';
  /** Figure width as a percentage of the column (e.g. "42%" or 42). */
  width?: number | string;
  /** Vertical anchor: px offset from the top of the block. */
  top?: number;
  gap?: number;
};

function parsePct(w: number | string | undefined): number {
  if (w == null) return 42;
  if (typeof w === 'number') return w;
  const n = parseFloat(w);
  return Number.isNaN(n) ? 42 : n;
}

export function Orb() {
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background:
          'radial-gradient(125% 125% at 30% 24%, #f6b079 0%, #e07a2c 38%, #c2571f 64%, #8f3d12 100%)',
        boxShadow: '0 12px 34px rgba(170,75,22,0.30), inset 0 1px 0 rgba(255,255,255,0.45)',
      }}
    />
  );
}

/** Approximate the flow with CSS floats for SSR / no-JS readers. */
function fallbackFigureStyle(side: NonNullable<SpreadProps['side']>, widthPct: number, aspect: number): CSSProperties {
  const base: CSSProperties = { width: `${widthPct}%`, aspectRatio: `${aspect}`, margin: '6px 0 12px' };
  if (side === 'full') return { ...base, width: '100%', margin: '6px 0 16px' };
  if (side === 'inline') return { ...base, marginLeft: 'auto', marginRight: 'auto' };
  if (side === 'left') return { ...base, float: 'left', marginRight: 24 };
  return { ...base, float: 'right', marginLeft: 24 };
}

export function Spread({
  children,
  figure,
  image,
  alt = '',
  orb = false,
  caption,
  side = 'right',
  width,
  top = 6,
  gap = 28,
}: SpreadProps) {
  const runs = useMemo(() => extractRuns(children), [children]);

  let node: ReactNode = figure;
  let shape: FlowObstacle['shape'] = 'rect';
  if (!node && orb) {
    node = <Orb />;
    shape = 'circle';
  } else if (!node && image) {
    node = (
      <DraftImage
        src={image}
        alt={alt}
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
      />
    );
  }

  const widthPct = parsePct(width);
  const aspect = shape === 'circle' ? 1 : 4 / 3;

  const obstacles: FlowObstacle[] = node
    ? [
        {
          id: 'spread-figure',
          side,
          shape,
          widthPct,
          aspect,
          anchorTop: top,
          gap,
          node,
          caption: caption ? { text: caption } : undefined,
        },
      ]
    : [];

  const fallback = (
    <div style={{ display: 'flow-root' }}>
      {node && (
        <figure style={{ ...fallbackFigureStyle(side, widthPct, aspect), aspectRatio: undefined }}>
          <div style={{ aspectRatio: `${aspect}` }}>{node}</div>
          {caption && (
            <figcaption style={{ marginTop: 8, fontSize: 12.5, lineHeight: '17px', textAlign: 'center', color: 'var(--color-fd-muted-foreground, #888)' }}>
              {caption}
            </figcaption>
          )}
        </figure>
      )}
      {children}
    </div>
  );

  return <RichFlow runs={runs} obstacles={obstacles} fallback={fallback} />;
}
