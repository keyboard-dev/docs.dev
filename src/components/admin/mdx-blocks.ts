/**
 * MDX ⇄ block model for the unified in-place editor.
 *
 * The editor needs to render a page as a list of editable blocks (prose,
 * heading, code, callout, cards, spread) and serialize them back to MDX without
 * losing content. This is a pragmatic line scanner — not a full mdast parser —
 * covering the block types docs.dev produces. Round-trip is verified to be
 * semantically stable (parse → serialize → parse is a fixed point).
 */

export type Block =
  | { id: string; type: 'heading'; depth: number; text: string }
  | { id: string; type: 'prose'; text: string }
  | { id: string; type: 'code'; lang: string; meta: string; code: string }
  | { id: string; type: 'callout'; props: string; text: string }
  | { id: string; type: 'cards'; raw: string }
  | { id: string; type: 'spread'; attrs: string; inner: string }
  /** Anything the editor doesn't understand (other JSX, imports, tables).
   *  Rendered read-only and round-tripped verbatim — the editor never
   *  destroys what it can't represent. */
  | { id: string; type: 'raw'; raw: string };

export type ParsedDoc = { frontmatter: string; blocks: Block[] };

let counter = 0;
const nid = () => `b${(counter++).toString(36)}_${Date.now().toString(36)}`;

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)(.*)$/;

function attrsOf(line: string, tag: string): string {
  const m = line.match(new RegExp(`<${tag}\\b([^>]*?)/?>`));
  return (m?.[1] ?? '').trim();
}

/** Collect lines until a line that closes `</tag>` (inclusive of content between). */
function collectUntilClose(lines: string[], start: number, closeTag: string): { inner: string; end: number } {
  const open = lines[start]!;
  // Single-line case: <Tag ...>inner</Tag>
  const sameLine = open.indexOf(`</${closeTag}>`);
  if (sameLine !== -1) {
    const afterOpen = open.indexOf('>') + 1;
    return { inner: open.slice(afterOpen, sameLine), end: start };
  }
  const innerLines: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i++) {
    if (lines[i]!.includes(`</${closeTag}>`)) break;
    innerLines.push(lines[i]!);
  }
  return { inner: innerLines.join('\n').trim(), end: i };
}

export function parseDoc(source: string): ParsedDoc {
  let body = source;
  let frontmatter = '';
  const fm = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    frontmatter = fm[0];
    body = source.slice(fm[0].length);
  }

  const lines = body.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let prose: string[] = [];
  const flushProse = () => {
    const text = prose.join('\n').trim();
    if (text) blocks.push({ id: nid(), type: 'prose', text });
    prose = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      flushProse();
      i++;
      continue;
    }

    const fence = trimmed.match(FENCE);
    if (fence) {
      flushProse();
      const info = fence[2]!.trim();
      const lang = info.split(/\s+/)[0] ?? '';
      const meta = info.slice(lang.length).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().match(FENCE)) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push({ id: nid(), type: 'code', lang, meta, code: code.join('\n') });
      continue;
    }

    const heading = trimmed.match(HEADING);
    if (heading) {
      flushProse();
      blocks.push({ id: nid(), type: 'heading', depth: heading[1]!.length, text: heading[2]!.trim() });
      i++;
      continue;
    }

    if (/^<Spread\b/.test(trimmed)) {
      flushProse();
      const attrs = attrsOf(trimmed, 'Spread');
      const { inner, end } = collectUntilClose(lines, i, 'Spread');
      blocks.push({ id: nid(), type: 'spread', attrs, inner });
      i = end + 1;
      continue;
    }
    if (/^<Callout\b/.test(trimmed)) {
      flushProse();
      const props = attrsOf(trimmed, 'Callout');
      const { inner, end } = collectUntilClose(lines, i, 'Callout');
      blocks.push({ id: nid(), type: 'callout', props, text: inner });
      i = end + 1;
      continue;
    }
    if (/^<Cards>/.test(trimmed)) {
      flushProse();
      const rawLines: string[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        rawLines.push(lines[j]!);
        if (lines[j]!.includes('</Cards>')) break;
      }
      blocks.push({ id: nid(), type: 'cards', raw: rawLines.join('\n') });
      i = j + 1;
      continue;
    }

    // Unknown JSX component (e.g. <Tabs>) → protected raw block, kept verbatim.
    const jsx = trimmed.match(/^<([A-Z][A-Za-z0-9]*)\b/);
    if (jsx) {
      flushProse();
      const tag = jsx[1]!;
      const selfClosed = /\/>\s*$/.test(trimmed);
      const rawLines: string[] = [lines[i]!];
      let j = i;
      if (!selfClosed && !trimmed.includes(`</${tag}>`)) {
        let depth = 1;
        for (j = i + 1; j < lines.length && depth > 0; j++) {
          const l = lines[j]!;
          rawLines.push(l);
          for (const m of l.matchAll(new RegExp(`<${tag}\\b[^>]*(?<!/)>|</${tag}>`, 'g'))) {
            depth += m[0].startsWith('</') ? -1 : 1;
          }
        }
        j -= 1;
      }
      blocks.push({ id: nid(), type: 'raw', raw: rawLines.join('\n') });
      i = j + 1;
      continue;
    }

    // import/export statements and Markdown tables are also protected.
    if (/^(import|export)\s/.test(trimmed) || trimmed.startsWith('|')) {
      flushProse();
      const rawLines: string[] = [];
      const isTable = trimmed.startsWith('|');
      let j = i;
      for (; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (t === '' || (isTable ? !t.startsWith('|') : !/^(import|export)\s/.test(t))) break;
        rawLines.push(lines[j]!);
      }
      blocks.push({ id: nid(), type: 'raw', raw: rawLines.join('\n') });
      i = j;
      continue;
    }

    prose.push(line);
    i++;
  }
  flushProse();

  return { frontmatter, blocks };
}

export function serializeBlock(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(b.depth)} ${b.text}`;
    case 'prose':
      return b.text;
    case 'code':
      return '```' + [b.lang, b.meta].filter(Boolean).join(' ') + '\n' + b.code + '\n```';
    case 'callout':
      return `<Callout${b.props ? ' ' + b.props : ''}>\n${b.text}\n</Callout>`;
    case 'cards':
      return b.raw;
    case 'raw':
      return b.raw;
    case 'spread':
      return `<Spread${b.attrs ? ' ' + b.attrs : ''}>\n\n${b.inner}\n\n</Spread>`;
  }
}

export function serializeDoc(doc: ParsedDoc): string {
  const body = doc.blocks.map(serializeBlock).join('\n\n');
  return (doc.frontmatter ? doc.frontmatter.replace(/\n*$/, '\n\n') : '') + body + '\n';
}
