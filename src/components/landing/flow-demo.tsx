'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Flow, type Obstacle } from '@/components/pretext/flow';

/**
 * The pretext showcase from the landing page. On a wide column the text
 * flows around fixed-size obstacles (the planet, the code sample) — but on
 * a phone those boxes would eat the whole column and leave sliver-thin
 * lines. Below COMPACT_BREAKPOINT we stack the same figures as ordinary
 * blocks and let the prose run full width instead.
 */

const COMPACT_BREAKPOINT = 560;

// Flow re-lays itself out whenever its `obstacles` prop changes identity, so
// every array we hand it must be referentially stable across renders —
// including the empty one (Flow's own `= []` default would be a fresh array
// per render and loop the layout effect against its setState).
const NO_OBSTACLES: Obstacle[] = [];

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const CODE_SAMPLE = `import { prepare,
  layout } from
  '@chenglou/pretext';

const t = prepare(
  text, font);
layout(t, 640, 32);
// → { lineCount, height }`;

function CodeSample({ style }: { style?: CSSProperties }) {
  return (
    <pre
      style={{
        margin: 0, boxSizing: 'border-box', padding: '16px 18px',
        borderRadius: 12, background: '#0d1117', color: '#c9d1d9', fontSize: 13, lineHeight: '20px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        ...style,
      }}
    >
      <code>{CODE_SAMPLE}</code>
    </pre>
  );
}

function Planet({ style }: { style?: CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/landing/docs-planet.png"
      alt="A planet made of documentation pages"
      style={{ borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 70px 14px rgba(99,102,241,0.35)', ...style }}
    />
  );
}

export function FlowDemo({ intro, body }: { intro: string; body: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      if (width > 0) setCompact(width < COMPACT_BREAKPOINT);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const introObstacles: Obstacle[] = useMemo(
    () => [
      {
        id: 'orb',
        side: 'right',
        width: 220,
        height: 220,
        top: 8,
        gap: 28,
        node: <Planet style={{ width: '100%', height: '100%' }} />,
      },
    ],
    [],
  );
  const bodyObstacles: Obstacle[] = useMemo(
    () => [
      {
        id: 'code',
        side: 'left',
        width: 300,
        height: 168,
        top: 12,
        gap: 28,
        node: <CodeSample style={{ width: '100%', height: '100%' }} />,
      },
    ],
    [],
  );

  return (
    <div ref={wrapperRef} className="mt-10">
      {compact ? (
        <>
          <Planet style={{ width: 180, height: 180, margin: '0 auto 32px' }} />
          <Flow text={intro} obstacles={NO_OBSTACLES} />
          <div className="h-10" />
          <CodeSample />
          <div className="h-7" />
          <Flow text={body} obstacles={NO_OBSTACLES} />
        </>
      ) : (
        <>
          <Flow text={intro} obstacles={introObstacles} />
          <div className="h-14" />
          <Flow text={body} obstacles={bodyObstacles} />
        </>
      )}
    </div>
  );
}
