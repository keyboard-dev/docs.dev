'use client';

/**
 * The landing ("layout") page, rendered entirely from content/landing.json.
 *
 * For visitors this is just the page. For admins it's the same unified
 * editing experience as docs pages: "Edit layout" turns the real page into
 * the editor — every heading, paragraph, button, and card is edited in
 * place with the exact classes readers see, drafts autosave locally and
 * sync to the shared drafts store (multiplayer, with conflict handling),
 * and Publish commits content/landing.json via /api/admin/layout. The
 * editing chrome itself lives in landing-editor.tsx.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flow, type Obstacle } from '@/components/pretext/flow';
import type { LandingCopy, LandingCta } from '@/lib/landing';
import { LandingEditOverlay, useLandingDraft } from './landing-editor';
import { PencilRuler } from 'lucide-react';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

export function ctaClass(style: LandingCta['style']): string {
  switch (style) {
    case 'primary':
      return 'rounded-xl bg-[var(--docsdev-accent,#e8753b)] px-5 py-3 text-[15px] font-semibold text-white no-underline transition-[filter] hover:brightness-90';
    case 'outline':
      return 'rounded-xl border border-fd-border px-5 py-3 text-[15px] font-semibold no-underline transition-colors hover:bg-fd-accent';
    default:
      return 'px-2 py-3 text-[14px] text-fd-muted-foreground no-underline hover:text-fd-foreground';
  }
}

function Cta({ cta }: { cta: LandingCta }) {
  const cls = ctaClass(cta.style);
  return cta.href.startsWith('/') ? (
    <Link href={cta.href} className={cls}>
      {cta.label}
    </Link>
  ) : (
    <a href={cta.href} className={cls}>
      {cta.label}
    </a>
  );
}

export const ORB_BOX = { width: 220, height: 220, gap: 28 };
export const CODE_BOX = { width: 300, height: 168, gap: 28 };

export function OrbNode() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)',
        boxShadow: '0 0 60px 12px rgba(232,117,59,0.45), inset -16px -20px 50px rgba(0,0,0,0.45)',
      }}
    />
  );
}

export const codePreStyle: React.CSSProperties = {
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
};

export function orbObstacle(node?: React.ReactNode): Obstacle {
  return { id: 'orb', side: 'right', top: 8, ...ORB_BOX, node: node ?? <OrbNode /> };
}

export function codeObstacle(code: string, node?: React.ReactNode): Obstacle {
  return {
    id: 'code',
    side: 'left',
    top: 12,
    ...CODE_BOX,
    node: node ?? (
      <pre style={codePreStyle}>
        <code>{code}</code>
      </pre>
    ),
  };
}

/** The published look, straight from copy — also used as the editor's
 *  Preview mode, so preview can never drift from what readers get. */
export function LandingView({ copy }: { copy: LandingCopy }) {
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28">
      {/* Hero */}
      <section className="pt-20 pb-14">
        <p className="mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--docsdev-accent,#e8753b)]">
          {copy.hero.eyebrow}
        </p>
        <h1 className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]">
          {copy.hero.titleLines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </h1>
        <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-fd-muted-foreground">{copy.hero.tagline}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {copy.hero.ctas.map((cta, i) => (
            <Cta key={i} cta={cta} />
          ))}
        </div>
      </section>

      {/* Live pretext demo */}
      <section aria-label="Live layout demo">
        <Flow text={copy.demo.intro} obstacles={[orbObstacle()]} />
        <div className="h-14" />
        <Flow text={copy.demo.body} obstacles={[codeObstacle(copy.demo.code)]} />
      </section>

      {/* Features */}
      <section className="mt-24">
        <h2 className="mb-8 text-[26px] font-bold tracking-[-0.01em]">{copy.features.heading}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((f, i) => (
            <Link
              key={i}
              href={f.href || '/docs'}
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
        <h2 className="m-0 text-[24px] font-bold">{copy.closing.title}</h2>
        <p className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground">{copy.closing.body}</p>
        <div className="mt-6 flex justify-center gap-3">
          {copy.closing.ctas.map((cta, i) => (
            <Cta key={i} cta={cta} />
          ))}
        </div>
      </section>
    </main>
  );
}

export function Landing({ published }: { published: LandingCopy }) {
  const [admin, setAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const draft = useLandingDraft(published, admin);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAdmin(!!d.admin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (editing) {
    return <LandingEditOverlay draft={draft} onDone={() => setEditing(false)} />;
  }

  return (
    <>
      <LandingView copy={draft.copy} />
      {admin && (
        <button
          onClick={() => setEditing(true)}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 18px', borderRadius: 999, border: 'none', background: ACCENT, color: '#fff',
            fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer',
          }}
        >
          <PencilRuler size={14} /> Edit layout
          {draft.dirty && (
            <span
              title={draft.author ? `Showing an unpublished draft by ${draft.author} — the live site is unchanged` : 'Showing an unpublished draft — the live site is unchanged'}
              style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '2px 8px' }}
            >
              DRAFT
            </span>
          )}
        </button>
      )}
    </>
  );
}
