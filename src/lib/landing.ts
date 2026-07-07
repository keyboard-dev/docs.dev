/**
 * The landing ("layout") page's content model: content/landing.json is a
 * list of typed *sections* — hero, flowing prose around a figure, feature
 * grid, quote, CTA banner — rendered by a small section registry
 * (src/components/landing/landing.tsx) and edited in place by the layout
 * editor exactly like docs pages. Publishing commits the JSON (plus any
 * uploaded figure images) via /api/admin/layout.
 *
 * Adding a new kind of section = one type here, one view component in the
 * registry, one editable variant in landing-editor.tsx, one template entry.
 */

import copy from '../../content/landing.json';

export type LandingCta = {
  label: string;
  href: string;
  /** primary = filled accent button, outline = bordered, text = quiet link. */
  style: 'primary' | 'outline' | 'text';
};

export type LandingFeature = { title: string; body: string; href: string };

export type FigureKind = 'orb' | 'image' | 'code';

/** The figure a flow section's prose wraps around — the landing's Spread. */
export type FlowFigure = {
  kind: FigureKind;
  side: 'left' | 'right';
  /** Box width in px; height derives from the kind's aspect ratio. */
  width: number;
  /** Vertical anchor: px from the top of the paragraph. */
  top: number;
  /** kind: 'image' */
  src?: string;
  alt?: string;
  /** kind: 'code' */
  code?: string;
};

export type HeroSection = {
  type: 'hero';
  eyebrow: string;
  titleLines: string[];
  tagline: string;
  ctas: LandingCta[];
};
export type FlowSection = { type: 'flow'; text: string; figure: FlowFigure };
export type FeaturesSection = { type: 'features'; heading: string; items: LandingFeature[] };
export type QuoteSection = { type: 'quote'; text: string; name: string; role: string };
export type CtaSection = { type: 'cta'; title: string; body: string; ctas: LandingCta[] };

export type LandingSection = HeroSection | FlowSection | FeaturesSection | QuoteSection | CtaSection;

export type LandingCopy = {
  meta: { title: string; description: string };
  sections: LandingSection[];
};

/** Reserved slug the landing page's shared draft lives under in the drafts
 *  store. Underscore-prefixed so it can never collide with a real docs page
 *  (page slugs are `[a-z0-9-]`), and page lists filter `_`-prefixed slugs. */
export const LANDING_DRAFT_SLUG = '_landing';

/* ------------------------------------------------------------------ */
/* figure geometry                                                      */
/* ------------------------------------------------------------------ */

export const FIGURE_GAP = 28;
export const FIGURE_MIN_W = 140;
export const FIGURE_MAX_W = 520;

export function figureAspect(kind: FigureKind): number {
  switch (kind) {
    case 'orb':
      return 1;
    case 'code':
      return 0.56; // the classic 300×168 code card
    default:
      return 0.75; // 4:3 images
  }
}

export function figureHeight(f: Pick<FlowFigure, 'kind' | 'width'>): number {
  return Math.round(f.width * figureAspect(f.kind));
}

/* ------------------------------------------------------------------ */
/* section templates (the insert menu)                                  */
/* ------------------------------------------------------------------ */

export const SECTION_TEMPLATES: Array<{ type: LandingSection['type']; label: string; blurb: string; make: () => LandingSection }> = [
  {
    type: 'hero',
    label: 'Hero',
    blurb: 'Eyebrow, big title, tagline, and buttons.',
    make: () => ({
      type: 'hero',
      eyebrow: 'Eyebrow · Sets the scene',
      titleLines: ['A big statement,', 'in two lines.'],
      tagline: 'One or two sentences on what this is and why it matters to the reader.',
      ctas: [
        { label: 'Primary action', href: '/docs', style: 'primary' },
        { label: 'Secondary', href: '/docs', style: 'outline' },
      ],
    }),
  },
  {
    type: 'flow',
    label: 'Flowing prose + figure',
    blurb: 'A paragraph that wraps around a draggable figure — orb, image, or code.',
    make: () => ({
      type: 'flow',
      text:
        'Write a paragraph here and watch it flow around the figure. Drag the figure to either side or up and down, resize it from the corner, and swap it for an image or a code sample — the prose reflows live, exactly as readers will see it.',
      figure: { kind: 'orb', side: 'right', width: 220, top: 8 },
    }),
  },
  {
    type: 'features',
    label: 'Feature grid',
    blurb: 'A heading and a grid of linked cards.',
    make: () => ({
      type: 'features',
      heading: 'What you get',
      items: [
        { title: 'First feature', body: 'What it does and why it matters.', href: '/docs' },
        { title: 'Second feature', body: 'What it does and why it matters.', href: '/docs' },
        { title: 'Third feature', body: 'What it does and why it matters.', href: '/docs' },
      ],
    }),
  },
  {
    type: 'quote',
    label: 'Quote',
    blurb: 'A centered testimonial with attribution.',
    make: () => ({
      type: 'quote',
      text: 'A short quote from someone who loves the product — specific beats superlative.',
      name: 'Ada Lovelace',
      role: 'Analytical Engines Inc.',
    }),
  },
  {
    type: 'cta',
    label: 'CTA banner',
    blurb: 'A closing call-to-action card with buttons.',
    make: () => ({
      type: 'cta',
      title: 'Ready when you are.',
      body: 'One sentence that removes the last doubt and points at the button.',
      ctas: [{ label: 'Get started', href: '/docs', style: 'primary' }],
    }),
  },
];

/* ------------------------------------------------------------------ */
/* sanitizing (the publish route runs untrusted input through this)     */
/* ------------------------------------------------------------------ */

const CTA_STYLES = new Set(['primary', 'outline', 'text']);
const FIGURE_KINDS = new Set(['orb', 'image', 'code']);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;

function sanitizeCtas(v: unknown): LandingCta[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).map((c) => ({
    label: str((c as LandingCta)?.label),
    href: str((c as LandingCta)?.href) || '/',
    style: CTA_STYLES.has((c as LandingCta)?.style) ? (c as LandingCta).style : 'outline',
  }));
}

function sanitizeFeatures(v: unknown): LandingFeature[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map((f) => ({
    title: str((f as LandingFeature)?.title),
    body: str((f as LandingFeature)?.body),
    href: str((f as LandingFeature)?.href) || '/docs',
  }));
}

function sanitizeFigure(v: unknown): FlowFigure {
  const f = (v ?? {}) as Partial<FlowFigure>;
  const kind = FIGURE_KINDS.has(f.kind as FigureKind) ? (f.kind as FigureKind) : 'orb';
  return {
    kind,
    side: f.side === 'left' ? 'left' : 'right',
    width: num(f.width, 220, FIGURE_MIN_W, FIGURE_MAX_W),
    top: num(f.top, 8, 0, 600),
    ...(kind === 'image' ? { src: str(f.src), alt: str(f.alt) } : {}),
    ...(kind === 'code' ? { code: str(f.code) } : {}),
  };
}

function sanitizeSection(v: unknown): LandingSection | null {
  const s = (v ?? {}) as Partial<LandingSection> & Record<string, unknown>;
  switch (s.type) {
    case 'hero':
      return {
        type: 'hero',
        eyebrow: str(s.eyebrow),
        titleLines: (Array.isArray(s.titleLines) ? s.titleLines : []).slice(0, 3).map(str),
        tagline: str(s.tagline),
        ctas: sanitizeCtas(s.ctas),
      };
    case 'flow':
      return { type: 'flow', text: str(s.text), figure: sanitizeFigure(s.figure) };
    case 'features':
      return { type: 'features', heading: str(s.heading), items: sanitizeFeatures(s.items) };
    case 'quote':
      return { type: 'quote', text: str(s.text), name: str(s.name), role: str(s.role) };
    case 'cta':
      return { type: 'cta', title: str(s.title), body: str(s.body), ctas: sanitizeCtas(s.ctas) };
    default:
      return null;
  }
}

/** The pre-sections landing.json shape (fixed hero/demo/features/closing) —
 *  still understood so older shared drafts and files upgrade in place. */
type LegacyCopy = {
  hero?: { eyebrow?: string; titleLines?: string[]; tagline?: string; ctas?: unknown };
  demo?: { intro?: string; body?: string; code?: string };
  features?: { heading?: string; items?: unknown };
  closing?: { title?: string; body?: string; ctas?: unknown };
};

function upgradeLegacy(c: LegacyCopy): LandingSection[] {
  const sections: LandingSection[] = [];
  if (c.hero) {
    sections.push({
      type: 'hero',
      eyebrow: str(c.hero.eyebrow),
      titleLines: (Array.isArray(c.hero.titleLines) ? c.hero.titleLines : []).slice(0, 3).map(str),
      tagline: str(c.hero.tagline),
      ctas: sanitizeCtas(c.hero.ctas),
    });
  }
  if (c.demo) {
    sections.push({
      type: 'flow',
      text: str(c.demo.intro),
      figure: { kind: 'orb', side: 'right', width: 220, top: 8 },
    });
    sections.push({
      type: 'flow',
      text: str(c.demo.body),
      figure: { kind: 'code', side: 'left', width: 300, top: 12, code: str(c.demo.code) },
    });
  }
  if (c.features) {
    sections.push({ type: 'features', heading: str(c.features.heading), items: sanitizeFeatures(c.features.items) });
  }
  if (c.closing) {
    sections.push({ type: 'cta', title: str(c.closing.title), body: str(c.closing.body), ctas: sanitizeCtas(c.closing.ctas) });
  }
  return sections;
}

/** Coerce untrusted input into a well-formed LandingCopy (used by the publish
 *  route so a bad payload can never commit a landing.json the site can't
 *  render). Unknown keys and section types are dropped. */
export function sanitizeLandingCopy(input: unknown): LandingCopy {
  const c = (input ?? {}) as { meta?: { title?: unknown; description?: unknown }; sections?: unknown } & LegacyCopy;
  const sections = Array.isArray(c.sections)
    ? c.sections.slice(0, 24).map(sanitizeSection).filter((s): s is LandingSection => s !== null)
    : upgradeLegacy(c);
  return {
    meta: { title: str(c.meta?.title), description: str(c.meta?.description) },
    sections,
  };
}

// After the sanitizers above — this runs at module evaluation.
export const landingCopy = sanitizeLandingCopy(copy);
