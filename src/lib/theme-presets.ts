/**
 * Site theme presets, shared by the admin "Theme…" picker (live preview) and
 * the /api/admin/theme publish route (theme.css generation).
 *
 * A heading style is nothing but a set of CSS variables: global.css styles
 * headings against these variables with no-op defaults, so "classic" is
 * simply their absence and every other style derives its color from
 * --docsdev-accent — change the accent and the headings follow.
 */

export type HeadingStyle = 'classic' | 'tinted' | 'underline' | 'marker';

export const HEADING_STYLES: Array<{ id: HeadingStyle; label: string; blurb: string }> = [
  { id: 'classic', label: 'Classic', blurb: 'Headings in the text color — quiet and bookish.' },
  { id: 'tinted', label: 'Tinted', blurb: 'Headers and subheaders take the accent color.' },
  { id: 'underline', label: 'Underline', blurb: 'Section headers carry a hairline accent underline.' },
  { id: 'marker', label: 'Marker', blurb: 'A short accent bar sits under each section header.' },
];

export function isHeadingStyle(v: unknown): v is HeadingStyle {
  return HEADING_STYLES.some((s) => s.id === v);
}

/** Every variable any heading style can set — cleared before applying one. */
export const HEADING_VARS = [
  '--docsdev-h2-color',
  '--docsdev-h3-color',
  '--docsdev-h2-rule-w',
  '--docsdev-h2-rule-color',
  '--docsdev-h2-pad',
  '--docsdev-h2-marker-w',
  '--docsdev-h2-marker-h',
] as const;

export function headingVars(style: HeadingStyle): Record<string, string> {
  switch (style) {
    case 'tinted':
      return {
        '--docsdev-h2-color': 'var(--docsdev-accent)',
        '--docsdev-h3-color': 'color-mix(in srgb, var(--docsdev-accent) 72%, var(--color-fd-foreground))',
      };
    case 'underline':
      return {
        '--docsdev-h2-rule-w': '1px',
        '--docsdev-h2-rule-color': 'color-mix(in srgb, var(--docsdev-accent) 45%, transparent)',
        '--docsdev-h2-pad': '0.3em',
      };
    case 'marker':
      return {
        '--docsdev-h2-marker-w': '2.25rem',
        '--docsdev-h2-marker-h': '4px',
      };
    default:
      return {};
  }
}

/** The full src/app/theme.css for a given accent + heading style. */
export function themeCss(accent: string, heading: HeadingStyle): string {
  const vars = Object.entries(headingVars(heading))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `/*
 * Site theme — the single place your brand color and heading style live.
 *
 * Edit by hand, or use the admin sidebar's "Theme…" picker: it previews
 * changes live and commits this file via /api/admin/theme when you publish.
 *
 * heading-style: ${heading}
 */
:root {
  --docsdev-accent: ${accent};
${vars ? `${vars}\n` : ''}}
`;
}
