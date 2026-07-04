/**
 * Minimal parse/serialize for the opening `<Spread ...>` tag inside an MDX
 * document. The visual layout editor uses this to read a figure's geometry,
 * let you drag it, then write the new geometry back into the tag — so a visual
 * edit becomes a real source change the editor can commit.
 *
 * Intentionally small: it handles the first <Spread> in a document and the
 * attribute forms the editor produces (key="str", key={num}, boolean key).
 */

export type SpreadAttrs = {
  side?: 'left' | 'right' | 'inline' | 'full';
  /** Width as a percentage of the column (relative model). */
  width?: number;
  /** Vertical anchor, px from the top of the block. */
  top?: number;
  gap?: number;
  orb?: boolean;
  image?: string;
  alt?: string;
  /** Caption rendered under the figure. */
  caption?: string;
};

export type SpreadMatch = {
  attrs: SpreadAttrs;
  inner: string;
  /** Index range of the opening tag in the source, for rewriting. */
  tagStart: number;
  tagEnd: number;
};

// Block-level usage only: the opening tag must start a line (optionally
// indented). This deliberately skips an inline `<Spread>` written inside
// backticks in prose, which is not a real component instance.
const OPEN_TAG = /^([ \t]*)<Spread\b([^>]*?)>/m;

export function findSpread(source: string): SpreadMatch | null {
  const open = OPEN_TAG.exec(source);
  if (!open) return null;
  const indent = open[1] ?? '';
  const tagStart = open.index + indent.length;
  const tagEnd = open.index + open[0].length;
  const close = source.indexOf('</Spread>', tagEnd);
  const inner = close === -1 ? '' : source.slice(tagEnd, close);
  return { attrs: parseAttrs(open[2] ?? ''), inner, tagStart, tagEnd };
}

export function parseAttrs(raw: string): SpreadAttrs {
  const attrs: SpreadAttrs = {};
  // key={number}
  for (const m of raw.matchAll(/(\w+)=\{\s*(-?\d+(?:\.\d+)?)\s*\}/g)) {
    (attrs as Record<string, number>)[m[1]!] = Number(m[2]);
  }
  // key="string"  (width="42%" is captured here, then normalized to a number)
  for (const m of raw.matchAll(/(\w+)="([^"]*)"/g)) {
    (attrs as Record<string, string>)[m[1]!] = m[2]!;
  }
  // boolean key (e.g. `orb`) — present without a value. Scan with quoted
  // values blanked out so words inside alt="…"/caption="…" aren't mistaken
  // for boolean keys.
  const noStrings = raw.replace(/"[^"]*"/g, '""').replace(/\{[^}]*\}/g, '{}');
  for (const m of noStrings.matchAll(/(?:^|\s)(\w+)(?=\s|$)(?![=])/g)) {
    if (!(m[1]! in attrs)) (attrs as Record<string, boolean>)[m[1]!] = true;
  }
  // Normalize width: accept "42%" or 42 → a number percentage.
  if (typeof attrs.width === 'string') {
    const n = parseFloat(attrs.width as unknown as string);
    if (!Number.isNaN(n)) attrs.width = n;
    else delete attrs.width;
  }
  return attrs;
}

export function serializeAttrs(attrs: SpreadAttrs): string {
  const parts: string[] = [];
  if (attrs.orb) parts.push('orb');
  if (attrs.image) parts.push(`image="${attrs.image}"`);
  if (attrs.alt) parts.push(`alt="${attrs.alt.replace(/"/g, '”')}"`);
  if (attrs.caption) parts.push(`caption="${attrs.caption.replace(/"/g, '”')}"`);
  if (attrs.side) parts.push(`side="${attrs.side}"`);
  if (attrs.width != null) parts.push(`width="${Math.round(attrs.width)}%"`);
  for (const key of ['top', 'gap'] as const) {
    const v = attrs[key];
    if (v != null) parts.push(`${key}={${Math.round(v)}}`);
  }
  return parts.join(' ');
}

/** Rewrite the first <Spread> opening tag in `source` with new attributes. */
export function writeSpreadAttrs(source: string, attrs: SpreadAttrs): string {
  const match = findSpread(source);
  if (!match) return source;
  const open = `<Spread ${serializeAttrs(attrs)}>`;
  return source.slice(0, match.tagStart) + open + source.slice(match.tagEnd);
}
