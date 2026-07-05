import Link from 'next/link';
import type { Metadata } from 'next';
import { Flow, type Obstacle } from '@/components/pretext/flow';

export const metadata: Metadata = {
  title: 'docs.dev — documentation that reads like a designed page',
  description:
    'Docs in a repo you own, on Cloudflare you control, with prose that flows around figures like a magazine — plus an editor your whole team can use.',
};

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/keyboard-dev/docs.dev';

const intro = `This paragraph is live — select it. Every line here is laid out by pretext, a text-measurement engine that computes line breaks with pure arithmetic instead of asking the browser to reflow. Because the engine knows exactly how wide each line can be, it can narrow a line to slip past an obstacle and widen it again once the obstacle ends. The orb to the right is a layout obstacle, not a floated image hack — the text genuinely flows around its bounding box, line by line, the way a magazine sets type around a photograph. None of this touches getBoundingClientRect or paints text to a canvas. The words you are reading are ordinary, selectable, screen-reader-friendly DOM text; pretext only decided where each line should sit.`;

const body = `Documentation is not just prose — it is prose interleaved with examples, diagrams, and asides, and in a conventional renderer each of those interrupts the reading flow. With a measurement-driven layout, the code sample sits in the margin while the explanation keeps flowing beside it, so your eye never leaves the paragraph to find the example it describes. The block on the left is exactly that: a real, syntax-highlighted sample pinned to the column edge with the text wrapping cleanly around it. Same Markdown you already write — rendered as a page someone actually wants to read.`;

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
        background: 'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)',
        boxShadow: '0 0 60px 12px rgba(232,117,59,0.45), inset -16px -20px 50px rgba(0,0,0,0.45)',
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

const FEATURES: Array<{ title: string; body: string; href?: string }> = [
  {
    title: 'Your repo is the source of truth',
    body: 'Every page is MDX in your GitHub repository. Publishing is a commit; reviews, branches, and rollbacks come for free.',
    href: '/docs/editing',
  },
  {
    title: 'One click, your Cloudflare',
    body: 'Deploy to your own Cloudflare account with push-to-deploy CI wired up. No hosting bill from us, no lock-in to escape.',
    href: '/docs/getting-started',
  },
  {
    title: 'The editor is the page',
    body: 'Edit in place with the exact layout readers see — shared drafts, live reflow around figures, publish with one button.',
    href: '/docs/editing',
  },
  {
    title: 'AI on your account',
    body: 'Draft docs and generate images with Workers AI, running and billed on your own Cloudflare account. No API keys.',
    href: '/docs/ai',
  },
  {
    title: 'Team sign-in',
    body: 'Invite teammates with docs.dev accounts — central membership, roles, and revocation. No shared credentials.',
    href: '/docs/team',
  },
  {
    title: 'Built for agents',
    body: 'Ships with CLAUDE.md and skills, so Claude Code can add pages, fix nav, and publish from a one-line request.',
    href: '/docs/getting-started#or-let-an-agent-do-it',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28">
      {/* Hero */}
      <section className="pt-20 pb-14">
        <p className="mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[#e8753b]">
          Your repo · Your Cloudflare · Our reading experience
        </p>
        <h1 className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]">
          Docs that read like a page,
          <br />
          not a stack of blocks.
        </h1>
        <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-fd-muted-foreground">
          docs.dev deploys a documentation site into <em>your</em> GitHub and{' '}
          <em>your</em> Cloudflare in one click — then gives your whole team an
          editor that works right on the page.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={DEPLOY_URL}
            className="rounded-xl bg-[#e8753b] px-5 py-3 text-[15px] font-semibold text-white no-underline transition-colors hover:bg-[#d3652e]"
          >
            Deploy to Cloudflare
          </a>
          <Link
            href="/docs"
            className="rounded-xl border border-fd-border px-5 py-3 text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent"
          >
            Read the docs
          </Link>
          <a
            href="https://github.com/keyboard-dev/docs.dev"
            className="px-2 py-3 text-[14px] text-fd-muted-foreground no-underline hover:text-fd-foreground"
          >
            GitHub ↗
          </a>
        </div>
      </section>

      {/* Live pretext demo */}
      <section aria-label="Live layout demo">
        <Flow text={intro} obstacles={[orb]} />
        <div className="h-14" />
        <Flow text={body} obstacles={[codeBox]} />
      </section>

      {/* Features */}
      <section className="mt-24">
        <h2 className="mb-8 text-[26px] font-bold tracking-[-0.01em]">
          Everything yours. Nothing to migrate off of.
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={f.href ?? '/docs'}
              className="rounded-2xl border border-fd-border p-5 no-underline transition-colors hover:bg-fd-accent"
            >
              <h3 className="mb-2 text-[15px] font-semibold">{f.title}</h3>
              <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{f.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mt-24 rounded-3xl border border-fd-border p-10 text-center">
        <h2 className="m-0 text-[24px] font-bold">Your docs, live in two minutes.</h2>
        <p className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground">
          One click clones the template into your GitHub, deploys to your
          Cloudflare, and wires up CI. This entire site is the template.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href={DEPLOY_URL}
            className="rounded-xl bg-[#e8753b] px-5 py-3 text-[15px] font-semibold text-white no-underline transition-colors hover:bg-[#d3652e]"
          >
            Deploy to Cloudflare
          </a>
          <Link
            href="/docs/getting-started"
            className="rounded-xl border border-fd-border px-5 py-3 text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent"
          >
            Getting started
          </Link>
        </div>
      </section>
    </main>
  );
}
