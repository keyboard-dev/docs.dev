import { Flow, type Obstacle } from '@/components/pretext/flow';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'docs.dev — the reading experience',
  description:
    'Documentation that reads like a designed page. Prose flows around images, code, and shapes — measured by pretext, never the DOM.',
};

const intro = `Most documentation looks the same because it is built the same way: a vertical stack of blocks, one after another, stopping dead whenever an image or a code sample appears. docs.dev takes a different path. Every paragraph on this page is laid out by pretext, a text-measurement engine that computes line breaks with pure arithmetic instead of asking the browser to reflow. Because the engine knows exactly how wide each line can be, it can narrow a line to slip past an obstacle and widen it again once the obstacle ends. The orb to the right is a layout obstacle, not a floated image hack — the text genuinely flows around its bounding box, line by line, the same way a magazine sets type around a photograph. None of this touches getBoundingClientRect, triggers a reflow, or paints text to a canvas. The words you are reading are ordinary, selectable, screen-reader-friendly DOM text. Pretext only decided where each line should sit.`;

const body = `Here is why that matters for documentation specifically. A reference page is not just prose — it is prose interleaved with examples, diagrams, warnings, and asides. In a conventional renderer each of those interrupts the reading flow: you read a sentence, scroll past a full-width code block, then pick the thread back up. With a measurement-driven layout the code sample can sit in the margin while the explanation keeps flowing beside it, so your eye never has to leave the paragraph to see the example it describes. The block on the left is exactly that: a real, syntax-highlighted code sample pinned to the column edge, with the explanatory text wrapping cleanly around it. This is the docs.dev thesis in one screen — the same Markdown you already write, rendered as a page someone actually wants to read, hosted at your-name.docs.dev.`;

const orb: Obstacle = {
  id: 'orb',
  side: 'right',
  width: 220,
  height: 220,
  top: 8,
  gap: 28,
  node: (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)',
        boxShadow:
          '0 0 60px 12px rgba(232,117,59,0.45), inset -16px -20px 50px rgba(0,0,0,0.45)',
      }}
    />
  ),
};

const codeBox: Obstacle = {
  id: 'code',
  side: 'left',
  width: 300,
  height: 168,
  top: 12,
  gap: 28,
  node: (
    <pre
      style={{
        margin: 0,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: '16px 18px',
        borderRadius: 12,
        background: '#0d1117',
        color: '#c9d1d9',
        fontSize: 13,
        lineHeight: '20px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <code>{`import { prepare,
  layout } from
  '@chenglou/pretext';

const t = prepare(
  text, font);
layout(t, 640, 32);
// → { lineCount, height }`}</code>
    </pre>
  ),
};

export default function ShowcasePage() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '72px 24px 120px',
      }}
    >
      <p
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#e8753b',
          marginBottom: 12,
        }}
      >
        Pure JS · Zero DOM reads · Flows around anything
      </p>
      <h1
        style={{
          fontSize: 52,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          margin: '0 0 32px',
          fontWeight: 800,
        }}
      >
        Docs that read like a page,
        <br />
        not a stack of blocks.
      </h1>

      <Flow text={intro} obstacles={[orb]} />

      <div style={{ height: 56 }} />

      <Flow text={body} obstacles={[codeBox]} />
    </main>
  );
}
