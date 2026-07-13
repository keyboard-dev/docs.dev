import Link from 'next/link';
import { AgentPrompt } from '@/app/(home)/agent-prompt';

export { FlowDemo } from './flow-demo';

/**
 * The landing page's building blocks. The page itself is MDX
 * (content/landing.mdx) that invokes these — so the copy is editable like
 * any doc while the look and feel stays in code, where nobody can
 * accidentally restyle it from the editor.
 */

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/keyboard-dev/docs.dev';

const pill =
  'whitespace-nowrap rounded-full bg-[#1c1a2e] px-6 py-3 text-center text-[15px] font-semibold text-white no-underline shadow-[0_0_24px_rgba(99,102,241,0.35)] transition-transform hover:scale-[1.02] dark:bg-white dark:text-[#0a0a14]';
const pillGhost =
  'whitespace-nowrap rounded-full border border-fd-border px-6 py-3 text-center text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent';

export function LandingHero({
  eyebrow,
  headline1,
  headline2,
  subhead,
}: {
  eyebrow: string;
  headline1: string;
  headline2: string;
  subhead: string;
}) {
  return (
    <section className="relative pt-20 pb-14">
      <div className="docsdev-glow" aria-hidden />
      <p className="relative mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[#818cf8]">
        {eyebrow}
      </p>
      <h1 className="m-0 text-[36px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[44px] md:text-[56px]">
        {headline1}
        <br />
        {headline2}
      </h1>
      <p className="mt-6 max-w-[600px] text-[17px] leading-relaxed text-fd-muted-foreground">{subhead}</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a href="https://app.docs.dev" className={pill}>
          Get started free
        </a>
        <Link href="/docs" className={pillGhost}>
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
  );
}

export function LandingSection({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mt-24">
      <h2 className="mb-3 text-[26px] font-bold tracking-[-0.01em]">{title}</h2>
      {lede && <p className="mb-8 max-w-[620px] text-[15px] leading-relaxed text-fd-muted-foreground">{lede}</p>}
      {children}
    </section>
  );
}

export function StepGrid({ steps }: { steps: Array<{ step: string; title: string; body: string }> }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {steps.map((w) => (
        <div key={w.step} className="rounded-2xl border border-fd-border p-6">
          <p className="m-0 mb-2 font-mono text-[13px] text-[#818cf8]">{w.step}</p>
          <h3 className="mb-2 text-[16px] font-semibold">{w.title}</h3>
          <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{w.body}</p>
        </div>
      ))}
    </div>
  );
}

export function CardGrid({
  items,
  columns = 2,
}: {
  items: Array<{ title: string; body: string; href?: string; kicker?: string }>;
  columns?: 2 | 3;
}) {
  const cols = columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div className={`mt-8 grid grid-cols-1 gap-4 ${cols}`}>
      {items.map((f) => {
        const inner = (
          <>
            {f.kicker && (
              <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">{f.kicker}</p>
            )}
            <h3 className="mb-2 text-[16px] font-semibold">{f.title}</h3>
            <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{f.body}</p>
          </>
        );
        return f.href ? (
          <Link key={f.title} href={f.href} className="rounded-2xl border border-fd-border p-5 no-underline transition-colors hover:bg-fd-accent">
            {inner}
          </Link>
        ) : (
          <div key={f.title} className="rounded-2xl border border-fd-border p-6">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function Compare({ leftLabel, left, rightLabel, right }: { leftLabel: string; left: string; rightLabel: string; right: string }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-fd-border p-6 opacity-70">
        <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fd-muted-foreground">{leftLabel}</p>
        <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{left}</p>
      </div>
      <div className="rounded-2xl border border-[#6366f1]/40 p-6 shadow-[0_0_32px_rgba(99,102,241,0.12)]">
        <p className="m-0 mb-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[#818cf8]">{rightLabel}</p>
        <p className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground">{right}</p>
      </div>
    </div>
  );
}

export function EdgeBanner({ title1, title2, body }: { title1: string; title2: string; body: string }) {
  return (
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
            {title1}
            <br />
            {title2}
          </h2>
        </div>
        <div className="text-[15px] leading-relaxed text-fd-muted-foreground">
          <p className="m-0">{body}</p>
        </div>
      </div>
    </section>
  );
}

export function LandingCTA({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-24 rounded-3xl border border-fd-border px-6 py-10 text-center sm:p-10">
      <h2 className="m-0 text-[24px] font-bold">{title}</h2>
      <p className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground">{body}</p>
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <a href="https://app.docs.dev" className={pill}>
          Get started free
        </a>
        <a href={DEPLOY_URL} className={pillGhost}>
          Deploy to Cloudflare
        </a>
      </div>
    </section>
  );
}
