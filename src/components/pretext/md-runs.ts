import type { Run } from './extract-runs';

/**
 * Parse an inline-markdown string into styled runs for the flow engine.
 *
 * The published page extracts runs from MDX-rendered React children
 * (extract-runs); the editor holds raw markdown strings instead, and this
 * parser lets it feed the *same* RichFlow engine — so dragging a figure in the
 * editor reflows text through the exact code path the published page uses.
 *
 * Covers the marks the inline editor round-trips: `code`, **bold**, *italic*,
 * and [links](url). Anything else stays plain text.
 */
const TOKEN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|((?:^|(?<=[^*\\]))\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;

export function mdToRuns(md: string): Run[] {
  const runs: Run[] = [];
  // The flow engine treats runs as one paragraph; collapse hard-wrapped
  // source lines into spaces the way Markdown rendering would.
  const text = md.replace(/\n+/g, ' ').trim();
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) runs.push({ text: text.slice(last, i), kind: 'text' });
    const tok = m[0];
    if (m[1]) runs.push({ text: tok.slice(1, -1), kind: 'code' });
    else if (m[2]) runs.push({ text: tok.slice(2, -2), kind: 'strong' });
    else if (m[3]) runs.push({ text: tok.slice(1, -1), kind: 'em' });
    else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) runs.push({ text: link[1]!, kind: 'link', href: link[2] });
      else runs.push({ text: tok, kind: 'text' });
    }
    last = i + tok.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), kind: 'text' });
  return runs;
}
