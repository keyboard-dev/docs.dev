import { PageFlow } from '@/components/pretext/page-flow';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'docs.dev — the layout engine',
  description: 'A whole page laid out as a flowing column: prose wraps around a figure, code stays intact.',
};

export default function EnginePage() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '64px 24px 120px' }}>
      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--docsdev-accent,#e8753b)', marginBottom: 12 }}>
        PageFlow · milestone 1
      </p>
      <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 32px' }}>
        The whole page flows.
      </h1>

      <PageFlow figure={{ orb: true, side: 'right', width: 220, height: 220, top: 4, gap: 28 }}>
        <p>
          This entire page is laid out by the docs.dev engine, not the browser&apos;s stacked block
          model. Every paragraph you are reading is measured with <strong>pretext</strong> and
          positioned around the orb on the right — the prose narrows as it passes the figure and
          widens again below it, wrapping on <em>both</em> sides at once. Inline formatting survives:
          <strong>bold</strong>, <em>italic</em>, and inline <code>code</code> all keep working, and
          a link like <a href="https://github.com/chenglou/pretext">pretext</a> stays a real anchor.
          None of this touches <code>getBoundingClientRect</code> for the text or triggers a reflow.
        </p>
        <p>
          The difference from a single Spread is that the engine flows the <em>whole document</em>.
          Paragraphs flow as text, but structural blocks are kept intact as measured boxes rather
          than flattened. Watch what happens with the code block below — it is not turned into inline
          text; it stays a real, highlighted, copyable code block, placed in the column beneath the
          figure while the prose around it flows.
        </p>

        <pre style={{ margin: 0, padding: '16px 18px', borderRadius: 12, background: '#0d1117', color: '#c9d1d9', fontSize: 13, lineHeight: '20px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', border: '1px solid rgba(255,255,255,0.08)' }}>
          <code>{`import { prepareRichInline, layoutNextRichInlineLineRange } from '@chenglou/pretext/rich-inline';

const prepared = prepareRichInline(runs);
// walk lines, carving slots around obstacles — pure arithmetic`}</code>
        </pre>

        <p>
          After the code block, the column continues. An atomic block like that one is measured once
          and never collides with a figure — if it would overlap, the engine pushes it below. This is
          the foundation: a measured, flowing canvas where text, code, and figures coexist, and where
          a future editor can let you drop an image anywhere on the page and watch everything reflow
          in real time.
        </p>
      </PageFlow>
    </main>
  );
}
