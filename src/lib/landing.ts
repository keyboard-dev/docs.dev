/**
 * The landing ("layout") page's copy lives in content/landing.json so admins
 * can edit it from the site itself — the on-page layout editor previews
 * changes live and publishes them as a commit to that file (see
 * /api/admin/layout), exactly like docs pages and the theme.
 */

import copy from '../../content/landing.json';

export type LandingCta = {
  label: string;
  href: string;
  /** primary = filled accent button, outline = bordered, text = quiet link. */
  style: 'primary' | 'outline' | 'text';
};

export type LandingFeature = { title: string; body: string; href: string };

export type LandingCopy = {
  meta: { title: string; description: string };
  hero: { eyebrow: string; titleLines: string[]; tagline: string; ctas: LandingCta[] };
  demo: { intro: string; body: string; code: string };
  features: { heading: string; items: LandingFeature[] };
  closing: { title: string; body: string; ctas: LandingCta[] };
};

export const landingCopy = copy as LandingCopy;

/** Reserved slug the landing page's shared draft lives under in the drafts
 *  store. Underscore-prefixed so it can never collide with a real docs page
 *  (page slugs are `[a-z0-9-]`), and page lists filter `_`-prefixed slugs. */
export const LANDING_DRAFT_SLUG = '_landing';

const CTA_STYLES = new Set(['primary', 'outline', 'text']);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function sanitizeCtas(v: unknown): LandingCta[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).map((c) => ({
    label: str((c as LandingCta)?.label),
    href: str((c as LandingCta)?.href) || '/',
    style: CTA_STYLES.has((c as LandingCta)?.style) ? (c as LandingCta).style : 'outline',
  }));
}

/** Coerce untrusted input into a well-formed LandingCopy (used by the publish
 *  route so a bad payload can never commit a landing.json the site can't
 *  render). Unknown keys are dropped, missing ones become empty strings. */
export function sanitizeLandingCopy(input: unknown): LandingCopy {
  const c = (input ?? {}) as Partial<LandingCopy>;
  return {
    meta: { title: str(c.meta?.title), description: str(c.meta?.description) },
    hero: {
      eyebrow: str(c.hero?.eyebrow),
      titleLines: (Array.isArray(c.hero?.titleLines) ? c.hero.titleLines : []).slice(0, 3).map(str),
      tagline: str(c.hero?.tagline),
      ctas: sanitizeCtas(c.hero?.ctas),
    },
    demo: { intro: str(c.demo?.intro), body: str(c.demo?.body), code: str(c.demo?.code) },
    features: {
      heading: str(c.features?.heading),
      items: (Array.isArray(c.features?.items) ? c.features.items : []).slice(0, 12).map((f) => ({
        title: str((f as LandingFeature)?.title),
        body: str((f as LandingFeature)?.body),
        href: str((f as LandingFeature)?.href) || '/docs',
      })),
    },
    closing: { title: str(c.closing?.title), body: str(c.closing?.body), ctas: sanitizeCtas(c.closing?.ctas) },
  };
}
