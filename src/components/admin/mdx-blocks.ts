/**
 * MDX ⇄ block model for the unified in-place editor.
 *
 * The editor needs to render a page as a list of editable blocks (prose,
 * heading, code, callout, cards, spread, list, quote, image, table, divider)
 * and serialize them back to MDX without losing content. This is a pragmatic
 * line scanner — not a full mdast parser — covering the block types docs.dev
 * produces. Anything it doesn't understand becomes a protected `raw` block
 * that round-trips verbatim, so the editor never destroys what it can't
 * represent. Round-trip is verified to be semantically stable
 * (parse → serialize → parse is a fixed point).
 */

export type Block =
  | { id: string; type: 'heading'; depth: number; text: string }
  | { id: string; type: 'prose'; text: string }
  | { id: string; type: 'code'; lang: string; meta: string; code: string }
  | { id: string; type: 'callout'; props: string; text: string }
  | { id: string; type: 'cards'; raw: string }
  | { id: string; type: 'spread'; attrs: string; inner: string }
  | { id: string; type: 'list'; ordered: boolean; items: string[] }
  | { id: string; type: 'quote'; text: string }
  | { id: string; type: 'image'; src: string; alt: string }
  | { id: string; type: 'table'; header: string[]; align: string[]; rows: string[][] }
  | { id: string; type: 'hr' }
  /** <Tabs items={[…]}> containing only tab-labelled code fences (the shape
   *  docs.dev produces). Anything richer stays a protected raw block. */
  | { id: string; type: 'tabs'; tabs: Array<{ label: string; lang: string; meta: string; code: string }> }
  /** Anything the editor doesn't understand (other JSX, imports, nested
   *  lists). Rendered read-only and round-tripped verbatim. */
  | { id: string; type: 'raw'; raw: string };

export type ParsedDoc = { frontmatter: string; blocks: Block[] };

let counter = 0;
const nid = () => `b${(counter++).toString(36)}_${Date.now().toString(36)}`;

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)(.*)$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
const LIST_ITEM = /^([-*+]|\d+[.)])\s+(.*)$/;
const NESTED_LIST_ITEM = /^\s+([-*+]|\d+[.)])\s+/;

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

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const TABLE_SEP_CELL = /^:?-{3,}:?$/;

/** Structured parse of a <Tabs> body: only blank lines and code fences with
 *  a tab="Label" meta are allowed. Returns null when the content is richer
 *  than code tabs (falls back to a protected raw block). */
function parseCodeTabs(lines: string[]): Array<{ label: string; lang: string; meta: string; code: string }> | null {
  const tabs: Array<{ label: string; lang: string; meta: string; code: string }> = [];
  // Body excludes the opening <Tabs …> line and the closing </Tabs> line.
  let i = 1;
  const last = lines.length - 1;
  if (!lines[last]!.trim().startsWith('</Tabs>')) return null;
  while (i < last) {
    const t = lines[i]!.trim();
    if (t === '') {
      i++;
      continue;
    }
    const fence = t.match(FENCE);
    if (!fence) return null;
    const info = fence[2]!.trim();
    const label = (info.match(/tab="([^"]*)"/) ?? [])[1];
    if (label == null) return null;
    const lang = info.split(/\s+/)[0] ?? '';
    const meta = info.slice(lang.length).replace(/\s*tab="[^"]*"/, '').trim();
    const code: string[] = [];
    i++;
    while (i < last && !lines[i]!.trim().match(FENCE)) {
      code.push(lines[i]!);
      i++;
    }
    if (i >= last) return null; // unterminated fence
    i++; // closing fence
    tabs.push({ label, lang, meta, code: code.join('\n') });
  }
  return tabs.length > 0 ? tabs : null;
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

    if (HR.test(trimmed)) {
      flushProse();
      blocks.push({ id: nid(), type: 'hr' });
      i++;
      continue;
    }

    const image = trimmed.match(IMAGE);
    if (image) {
      flushProse();
      blocks.push({ id: nid(), type: 'image', alt: image[1] ?? '', src: image[2]! });
      i++;
      continue;
    }

    // Flat bullet / numbered lists. Nested lists are protected as raw so the
    // structure survives untouched.
    const listItem = trimmed.match(LIST_ITEM);
    if (listItem && line === trimmed) {
      flushProse();
      const start = i;
      const items: string[] = [];
      let nested = false;
      let j = i;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() === '') break;
        if (NESTED_LIST_ITEM.test(l)) {
          nested = true;
          continue;
        }
        const m = l.trim().match(LIST_ITEM);
        if (m && l === l.trimStart()) items.push(m[2]!);
        else if (/^\s{2,}\S/.test(l) && items.length > 0) items[items.length - 1] += ' ' + l.trim();
        else break;
      }
      if (nested) {
        const rawLines: string[] = [];
        let k = start;
        for (; k < lines.length && lines[k]!.trim() !== ''; k++) rawLines.push(lines[k]!);
        blocks.push({ id: nid(), type: 'raw', raw: rawLines.join('\n') });
        i = k;
      } else {
        blocks.push({ id: nid(), type: 'list', ordered: /^\d/.test(listItem[1]!), items });
        i = j;
      }
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushProse();
      const quote: string[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (!/^>\s?/.test(t)) break;
        quote.push(t.replace(/^>\s?/, ''));
      }
      blocks.push({ id: nid(), type: 'quote', text: quote.join('\n') });
      i = j;
      continue;
    }

    // Markdown table: header row + separator row (+ body rows).
    if (trimmed.startsWith('|')) {
      const sep = lines[i + 1]?.trim() ?? '';
      const sepCells = sep.startsWith('|') ? parseTableRow(sep) : [];
      if (sepCells.length > 0 && sepCells.every((c) => TABLE_SEP_CELL.test(c))) {
        flushProse();
        const header = parseTableRow(trimmed);
        const align = sepCells.map((c) =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '',
        );
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < lines.length; j++) {
          const t = lines[j]!.trim();
          if (!t.startsWith('|')) break;
          rows.push(parseTableRow(t));
        }
        blocks.push({ id: nid(), type: 'table', header, align, rows });
        i = j;
        continue;
      }
      // A lone pipe line without a separator: protect it.
      flushProse();
      const rawLines: string[] = [];
      let j = i;
      for (; j < lines.length && lines[j]!.trim().startsWith('|'); j++) rawLines.push(lines[j]!);
      blocks.push({ id: nid(), type: 'raw', raw: rawLines.join('\n') });
      i = j;
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

    // <Tabs> of code fences → structured, editable tabs block.
    if (/^<Tabs\b/.test(trimmed)) {
      flushProse();
      const rawLines: string[] = [lines[i]!];
      let j = i;
      if (!trimmed.includes('</Tabs>')) {
        let depth = 1;
        for (j = i + 1; j < lines.length && depth > 0; j++) {
          const l = lines[j]!;
          rawLines.push(l);
          for (const m of l.matchAll(/<Tabs\b[^>]*(?<!\/)>|<\/Tabs>/g)) {
            depth += m[0].startsWith('</') ? -1 : 1;
          }
        }
        j -= 1;
      }
      const tabs = parseCodeTabs(rawLines);
      if (tabs) blocks.push({ id: nid(), type: 'tabs', tabs });
      else blocks.push({ id: nid(), type: 'raw', raw: rawLines.join('\n') });
      i = j + 1;
      continue;
    }

    // Unknown JSX component → protected raw block, kept verbatim.
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

    // import/export statements are also protected.
    if (/^(import|export)\s/.test(trimmed)) {
      flushProse();
      const rawLines: string[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (t === '' || !/^(import|export)\s/.test(t)) break;
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

function serializeTable(b: Extract<Block, { type: 'table' }>): string {
  const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length), b.align.length);
  const pad = (row: string[]) => Array.from({ length: cols }, (_, i) => row[i] ?? '');
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const sep = Array.from({ length: cols }, (_, i) => {
    const a = b.align[i] ?? '';
    if (a === 'center') return ':---:';
    if (a === 'right') return '---:';
    if (a === 'left') return ':---';
    return '---';
  });
  return [line(pad(b.header)), line(sep), ...b.rows.map((r) => line(pad(r)))].join('\n');
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
    case 'list':
      return b.items.map((it, i) => (b.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join('\n');
    case 'quote':
      return b.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'image':
      return `![${b.alt}](${b.src})`;
    case 'table':
      return serializeTable(b);
    case 'hr':
      return '---';
    case 'tabs': {
      const items = b.tabs.map((t) => `'${t.label.replace(/'/g, '’')}'`).join(', ');
      const fences = b.tabs.map(
        (t) => '```' + [t.lang, t.meta, `tab="${t.label}"`].filter(Boolean).join(' ') + '\n' + t.code + '\n```',
      );
      return `<Tabs items={[${items}]}>\n\n${fences.join('\n\n')}\n\n</Tabs>`;
    }
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
