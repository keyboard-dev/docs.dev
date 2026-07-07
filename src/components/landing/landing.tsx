'use client';

/**
 * The landing ("layout") page — a list of typed sections rendered from
 * content/landing.json (see src/lib/landing.ts for the model).
 *
 * For visitors this is just the page. For admins it's the same unified
 * editing experience as docs pages: "Edit layout" turns the real page into
 * the editor — sections insert from templates, reorder, and delete in
 * place; every text node is edited with the exact published classes; and
 * flow figures drag, resize, and swap between orb / image / code with the
 * prose reflowing live. The editing chrome lives in landing-editor.tsx.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flow, type Obstacle } from '@/components/pretext/flow';
import { DraftImage } from '@/components/draft-image';
import {
  FIGURE_GAP,
  figureHeight,
  type CtaSection,
  type FeaturesSection,
  type FlowFigure,
  type FlowSection,
  type HeroSection,
  type LandingCopy,
  type LandingCta,
  type LandingSection,
  type QuoteSection,
} from '@/lib/landing';
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

/* ------------------------------------------------------------------ */
/* figures                                                              */
/* ------------------------------------------------------------------ */

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

/** The figure's visual, shared by the view and the editor. */
export function FigureVisual({ figure }: { figure: FlowFigure }) {
  switch (figure.kind) {
    case 'orb':
      return <OrbNode />;
    case 'code':
      return (
        <pre style={codePreStyle}>
          <code>{figure.code ?? ''}</code>
        </pre>
      );
    default:
      return figure.src ? (
        <DraftImage
          src={figure.src}
          alt={figure.alt ?? ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12, display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%', height: '100%', borderRadius: 12,
            background: 'var(--color-fd-card)', border: '1px dashed var(--color-fd-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-fd-muted-foreground)', fontSize: 13,
          }}
        >
          Add an image
        </div>
      );
  }
}

export function figureObstacle(figure: FlowFigure, node?: React.ReactNode): Obstacle {
  return {
    id: 'fig',
    side: figure.side,
    width: figure.width,
    height: figureHeight(figure),
    top: figure.top,
    gap: FIGURE_GAP,
    node: node ?? <FigureVisual figure={figure} />,
  };
}

/* ------------------------------------------------------------------ */
/* section views — the registry                                         */
/* ------------------------------------------------------------------ */

/** Per-type vertical rhythm; the editor reuses these so edit mode has the
 *  exact geometry of the published page. */
export function sectionClass(type: LandingSection['type'], index: number): string {
  switch (type) {
    case 'hero':
      return index === 0 ? 'pt-20' : 'mt-20';
    case 'flow':
      return 'mt-14';
    case 'quote':
      return 'mt-24';
    case 'cta':
      return 'mt-24';
    default:
      return 'mt-24';
  }
}

function HeroView({ s }: { s: HeroSection }) {
  return (
    <>
      <p className="mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--docsdev-accent,#e8753b)]">{s.eyebrow}</p>
      <h1 className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]">
        {s.titleLines.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        ))}
      </h1>
      <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-fd-muted-foreground">{s.tagline}</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {s.ctas.map((cta, i) => (
          <Cta key={i} cta={cta} />
        ))}
      </div>
    </>
  );
}

function FlowView({ s }: { s: FlowSection }) {
  return <Flow text={s.text} obstacles={[figureObstacle(s.figure)]} />;
}

function FeaturesView({ s }: { s: FeaturesSection }) {
  return (
    <>
      <h2 className="mb-8 text-[26px] font-bold tracking-[-0.01em]">{s.heading}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {s.items.map((f, i) => (
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
    </>
  );
}

function QuoteView({ s }: { s: QuoteSection }) {
  return (
    <div className="mx-auto max-w-[640px] text-center">
      <div aria-hidden className="font-mono text-[44px] leading-none text-[var(--docsdev-accent,#e8753b)]">
        &ldquo;
      </div>
      <p className="m-0 mt-1 text-[21px] font-medium leading-relaxed">{s.text}</p>
      <p className="mt-5 text-[14px] text-fd-muted-foreground">
        {s.name}
        {s.role ? ` · ${s.role}` : ''}
      </p>
    </div>
  );
}

function CtaView({ s }: { s: CtaSection }) {
  return (
    <div className="rounded-3xl border border-fd-border p-10 text-center">
      <h2 className="m-0 text-[24px] font-bold">{s.title}</h2>
      <p className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground">{s.body}</p>
      <div className="mt-6 flex justify-center gap-3">
        {s.ctas.map((cta, i) => (
          <Cta key={i} cta={cta} />
        ))}
      </div>
    </div>
  );
}

export function SectionView({ s }: { s: LandingSection }) {
  switch (s.type) {
    case 'hero':
      return <HeroView s={s} />;
    case 'flow':
      return <FlowView s={s} />;
    case 'features':
      return <FeaturesView s={s} />;
    case 'quote':
      return <QuoteView s={s} />;
    case 'cta':
      return <CtaView s={s} />;
  }
}

/** The published look, straight from copy — also used as the editor's
 *  Preview mode, so preview can never drift from what readers get. */
export function LandingView({ copy }: { copy: LandingCopy }) {
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28">
      {copy.sections.map((s, i) => (
        <section key={i} className={sectionClass(s.type, i)}>
          <SectionView s={s} />
        </section>
      ))}
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
