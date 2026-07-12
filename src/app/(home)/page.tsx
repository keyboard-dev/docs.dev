import Link from 'next/link';
import type { Metadata } from 'next';
import { Flow, type Obstacle } from '@/components/pretext/flow';
import { AgentPrompt } from './agent-prompt';

export const metadata: Metadata = {
  title: 'docs.dev — AI drafts your docs. Your team makes them true.',
  description:
    'Point your coding agent at your repo and your docs; it opens a docs branch, your team reviews on the rendered page, publishing is a commit. Runs on your Cloudflare — no platform fee, no metered AI.',
};

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/keyboard-dev/docs.dev';

const intro = `This paragraph is live — select it. Every line here is laid out by pretext, a text-measurement engine that computes line breaks with pure arithmetic instead of asking the browser to reflow. Because the engine knows exactly how wide each line can be, it can narrow a line to slip past an obstacle and widen it again once the obstacle ends. The planet to the right is a layout obstacle, not a floated image hack — the text genuinely flows around its bounding box, line by line, the way a magazine sets type around a photograph. None of this touches getBoundingClientRect or paints text to a canvas. The words you are reading are ordinary, selectable, screen-reader-friendly DOM text; pretext only decided where each line should sit.`;

const body = `Documentation is not just prose — it is prose interleaved with examples, diagrams, and asides, and in a conventional renderer each of those interrupts the reading flow. With a measurement-driven layout, the code sample sits in the margin while the explanation keeps flowing beside it, so your eye never leaves the paragraph to find the example it describes. The block on the left is exactly that: a real, syntax-highlighted sample pinned to the column edge with the text wrapping cleanly around it. Same Markdown you already write — rendered as a page someone actually wants to read.`;

const orb: Obstacle = {
  id: 'orb',
  side: 'right',
  width: 220,
  height: 220,
  top: 8,
  gap: 28,
  node: (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/landing/docs-planet.png"
      alt="A planet made of documentation pages"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        objectFit: 'cover',
        boxShadow: '0 0 70px 14px rgba(99,102,241,0.35)',
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

const WORKFLOW: Array<{ step: string; title: string; body: string }> = [
  {
    step: '01',
    title: 'Ship the feature',
    body: 'Your code lands like it always does. The docs debt starts here — and so does the fix.',
  },
  {
    step: '02',
    title: 'Your agent drafts the docs',
    body: 'Add your docs repo next to your code repo in Claude Code. One request — "document what changed" — and it opens a docs branch with drafted pages.',
  },
  {
    step: '03',
    title: 'Your team reviews on the page',
    body: 'Teammates sign in and see the draft exactly as readers will — same layout, same type. Eyeball it, prune it, fix it in place.',
  },
  {
    step: '04',
    title: 'Publishing is a commit',
    body: 'One button commits to your repo and the edge redeploys. Reviews, branches, and rollbacks come free, because it is just git.',
  },
];

const AI_NATIVE: Array<{ title: string; body: string }> = [
  {
    title: 'Every page is also markdown',
    body: 'Append .md to any URL and get the raw page — the convention agents and LLM tooling already expect. Your docs are legible to machines by default.',
  },
  {
    title: 'CLAUDE.md and skills in the box',
    body: 'The template ships agent instructions and skills, so "add a page", "fix the nav", or "draft this for review" are one-line requests from day one.',
  },
  {
    title: 'Agents can set up the whole site',
    body: 'An agent can create the site, deploy it, and hand you one claim code. You sign in once, confirm, and own everything it built.',
  },
  {
    title: 'Ask AI for your readers',
    body: 'An assistant answers questions from your pages, on your Workers AI. Readers stop guessing; you stop answering the same question twice.',
  },
];

const FEATURES: Array<{ title: string; body: string; href?: string }> = [
  {
    title: 'Your repo is the source of truth',
    body: 'Every page is MDX in your GitHub repository. Nothing to export, nothing to escape — leaving docs.dev costs you nothing, which is exactly why you can trust it.',
    href: '/docs/editing',
  },
  {
    title: 'Review-before-publish drafts',
    body: 'Shared drafts live on a branch, render exactly like the real page, and publish or discard with one click.',
    href: '/docs/editing',
  },
  {
    title: 'Commits attributed to the editor',
    body: 'Teammates publish as themselves — git blame on your docs means something. No shared bot token required.',
    href: '/docs/team',
  },
  {
    title: 'Team sign-in',
    body: 'Invite teammates with docs.dev accounts — central membership, roles, and revocation. No shared credentials.',
    href: '/docs/team',
  },
  {
    title: 'Custom domains, one approval',
    body: 'Add a domain in Cloudflare, open /admin on it, click Approve in your dashboard. No tokens to re-paste, ever.',
    href: '/docs/getting-started',
  },
  {
    title: 'Know what readers ask',
    body: 'Anonymous Ask-AI insights show what people searched for and what the docs could not answer — a bug tracker for your documentation.',
    href: '/docs/ai',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28">
      {/* Hero — the workflow story */}
      <section className="relative pt-20 pb-14">
        <div className="docsdev-glow" aria-hidden />
        <p className="relative mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[#818cf8]">
          Your repo · Your Cloudflare · Your agent
        </p>
        <h1 className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]">
          AI drafts your docs.
          <br />
          Your team makes them true.
        </h1>
        <p className="mt-6 max-w-[600px] text-[17px] leading-relaxed text-fd-muted-foreground">
          Point the coding agent you already pay for at your code and your
          docs. It opens a docs branch; your team reviews it on the rendered
          page and publishes with a commit. All of it runs in <em>your</em>{' '}
          GitHub and <em>your</em> Cloudflare.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="https://app.docs.dev"
            className="rounded-full bg-[#1c1a2e] px-6 py-3 text-[15px] font-semibold text-white no-underline shadow-[0_0_24px_rgba(99,102,241,0.35)] transition-transform hover:scale-[1.02] dark:bg-white dark:text-[#0a0a14]"
          >
            Get started free
          </a>
          <Link
            href="/docs"
            className="rounded-full border border-fd-border px-6 py-3 text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent"
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
        <AgentPrompt />
      </section>

      {/* The workflow */}
      <section className="mt-10">
        <h2 className="mb-8 text-[26px] font-bold tracking-[-0.01em]">
          Docs that ship the way code ships.
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {WORKFLOW.map((w) => (
            <div key={w.step} className="rounded-2xl border border-fd-border p-6">
              <p className="m-0 mb-2 font-mono text-[13px] text-[#818cf8]">{w.step}</p>
              <h3 className="mb-2 text-[16px] font-semibold">{w.title}</h3>
              <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The AI tax */}
      <section className="mt-24">
        <h2 className="mb-3 text-[26px] font-bold tracking-[-0.01em]">
          Stop paying the AI tax twice.
        </h2>
        <p className="mb-8 max-w-[620px] text-[15px] leading-relaxed text-fd-muted-foreground">
          Documentation platforms charge a subscription, then meter their AI
          on top — while your team already pays for Claude Code or Codex.
          docs.dev is a template, not a tenancy.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-fd-border p-6 opacity-70">
            <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fd-muted-foreground">
              Docs platforms
            </p>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">
              Monthly seat pricing. Their hosting. Their AI credits, metered.
              Your content in their database, and an export button you hope
              works when you leave.
            </p>
          </div>
          <div className="rounded-2xl border border-[#6366f1]/40 p-6 shadow-[0_0_32px_rgba(99,102,241,0.12)]">
            <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">
              docs.dev
            </p>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">
              A repo you own on a Cloudflare account you control — the free
              tier goes a long way. Writing AI is the agent you already have;
              reader-facing AI runs on your Workers AI. No platform fee, no
              metered middleman.
            </p>
          </div>
        </div>
      </section>

      {/* AI-native */}
      <section className="mt-24">
        <h2 className="mb-8 text-[26px] font-bold tracking-[-0.01em]">
          AI-native, not AI-appended.
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {AI_NATIVE.map((f) => (
            <div key={f.title} className="rounded-2xl border border-fd-border p-6">
              <h3 className="mb-2 text-[16px] font-semibold">{f.title}</h3>
              <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live pretext demo */}
      <section className="mt-24" aria-label="Live layout demo">
        <h2 className="mb-3 text-[26px] font-bold tracking-[-0.01em]">
          And they read like pages, not blocks.
        </h2>
        <p className="mb-10 max-w-[620px] text-[15px] leading-relaxed text-fd-muted-foreground">
          The reading experience is powered by pretext, a text-measurement
          layout engine. This section is the demo — it is running right now.
        </p>
        <Flow text={intro} obstacles={[orb]} />
        <div className="h-14" />
        <Flow text={body} obstacles={[codeBox]} />
      </section>

      {/* Cloudflare / edge */}
      <section className="mt-24">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing/edge-network.png"
          alt="Documentation served from a global edge network"
          className="w-full rounded-3xl border border-fd-border"
        />
        <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <h2 className="m-0 text-[26px] font-bold tracking-[-0.01em]">
              Centered on Cloudflare,
              <br />
              running as you.
            </h2>
          </div>
          <div className="text-[15px] leading-relaxed text-fd-muted-foreground">
            <p className="m-0">
              Every docs.dev site is a Worker in <em>your</em> Cloudflare
              account — served from the edge next to your readers, rebuilt on
              every push to your repo, billed on your plan. Add a custom
              domain in the dashboard and the site asks to bind it; one
              approval and it&apos;s live. There is no docs.dev server
              between your readers and your pages.
            </p>
          </div>
        </div>
      </section>

      {/* Built on */}
      <section className="mt-24">
        <h2 className="mb-3 text-[26px] font-bold tracking-[-0.01em]">
          Built on parts you&apos;d pick yourself.
        </h2>
        <p className="mb-8 max-w-[620px] text-[15px] leading-relaxed text-fd-muted-foreground">
          No proprietary renderer, no mystery hosting. docs.dev assembles
          three things you can read the source of — and you keep all of them
          if you ever leave.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link
            href="/engine"
            className="rounded-2xl border border-fd-border p-6 no-underline transition-colors hover:bg-fd-accent"
          >
            <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">
              The reading engine
            </p>
            <h3 className="mb-2 text-[17px] font-semibold">pretext</h3>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">
              A text-measurement engine that lays out every line with pure
              arithmetic, so prose flows around figures like a magazine page.
            </p>
          </Link>
          <a
            href="https://fumadocs.dev"
            className="rounded-2xl border border-fd-border p-6 no-underline transition-colors hover:bg-fd-accent"
          >
            <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">
              The docs framework
            </p>
            <h3 className="mb-2 text-[17px] font-semibold">Fumadocs</h3>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">
              MDX pages, sidebar and search, API reference generation from
              OpenAPI specs — the boring parts of a docs site, done properly
              in the open.
            </p>
          </a>
          <a
            href="https://workers.cloudflare.com"
            className="rounded-2xl border border-fd-border p-6 no-underline transition-colors hover:bg-fd-accent"
          >
            <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">
              The platform
            </p>
            <h3 className="mb-2 text-[17px] font-semibold">Cloudflare</h3>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">
              Your site is a Worker on your account: push-to-deploy builds,
              Workers AI for drafting and images, custom domains one approval
              away.
            </p>
          </a>
        </div>
      </section>

      {/* Everything else */}
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
          Create a site and deploy it in one click — or hand the prompt to
          your agent and just claim the result. This entire site is the
          template.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="https://app.docs.dev"
            className="rounded-full bg-[#1c1a2e] px-6 py-3 text-[15px] font-semibold text-white no-underline shadow-[0_0_24px_rgba(99,102,241,0.35)] transition-transform hover:scale-[1.02] dark:bg-white dark:text-[#0a0a14]"
          >
            Get started free
          </a>
          <a
            href={DEPLOY_URL}
            className="rounded-full border border-fd-border px-6 py-3 text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent"
          >
            Deploy to Cloudflare
          </a>
        </div>
      </section>
    </main>
  );
}
