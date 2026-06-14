'use client';

/**
 * <Spread> — the author-facing magazine-flow component.
 *
 * Doc authors write ordinary Markdown prose inside it and drop in a figure;
 * the text flows around the figure with links, `code`, and **bold** intact.
 * Everything outside <Spread> stays a normal Fumadocs docs page, so there's no
 * new authoring model to learn — this is just one more MDX component, like
 * Fumadocs' own <Cards> / <Callout>.
 *
 *   <Spread orb side="right">
 *   Normal markdown with **bold**, `code`, and [links](/foo) that flows
 *   around the figure...
 *   </Spread>
 *
 *   <Spread image="/diagram.png" alt="Architecture" side="left" width={320}>
 *   ...
 *   </Spread>
 */

import { useMemo, type ReactNode } from 'react';
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
  side?: 'left' | 'right';
  /** Absolute left offset (set by the visual layout editor when you drag). */
  x?: number;
  width?: number;
  height?: number;
  top?: number;
  gap?: number;
};

function Orb() {
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)',
        boxShadow:
          '0 0 60px 12px rgba(232,117,59,0.40), inset -16px -20px 50px rgba(0,0,0,0.45)',
      }}
    />
  );
}

export function Spread({
  children,
  figure,
  image,
  alt = '',
  orb = false,
  side = 'right',
  x,
  width = 240,
  height = 240,
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

  const obstacles: FlowObstacle[] = node
    ? [{ id: 'spread-figure', side, x, shape, width, height, top, gap, node }]
    : [];

  return <RichFlow runs={runs} obstacles={obstacles} fallback={children} />;
}
