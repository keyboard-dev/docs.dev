/**
 * Tiny inline-markdown ⇄ HTML converter for in-place rich-text editing.
 *
 * Block structure is handled by the block model (mdx-blocks); this only deals
 * with the inline marks inside a paragraph/heading/callout: bold, italic,
 * inline code, and links. We render markdown → HTML for a contentEditable, and
 * convert the edited HTML back → markdown on blur.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mdInlineToHtml(md: string): string {
  // Markdown soft breaks: a single newline inside a paragraph renders as a
  // space (exactly what the published pipeline does), so hard-wrapped source
  // lines don't become visual line breaks in the editor.
  let s = escapeHtml(md.replace(/\n+/g, ' '));
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

const BLOCKISH = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

export function htmlToMdInline(root: Node): string {
  let out = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
    } else if (n.nodeName === 'BR') {
      out += '\n';
    } else if (n.nodeName === 'STRONG' || n.nodeName === 'B') {
      out += `**${htmlToMdInline(n)}**`;
    } else if (n.nodeName === 'EM' || n.nodeName === 'I') {
      out += `*${htmlToMdInline(n)}*`;
    } else if (n.nodeName === 'CODE') {
      out += '`' + (n.textContent ?? '') + '`';
    } else if (n.nodeName === 'A') {
      const href = (n as HTMLAnchorElement).getAttribute('href') ?? '';
      out += `[${htmlToMdInline(n)}](${href})`;
    } else if (BLOCKISH.has(n.nodeName)) {
      // Browsers wrap Enter-created lines in block elements (Chrome: <div>).
      // Each block child is its own line — without this the user's line
      // breaks silently vanish on blur.
      if (out && !out.endsWith('\n')) out += '\n';
      const inner = htmlToMdInline(n);
      // An empty block (Chrome renders it as <div><br></div>) is an
      // intentionally blank line.
      out += inner === '' ? '\n' : inner;
      if (!out.endsWith('\n')) out += '\n';
    } else {
      out += htmlToMdInline(n);
    }
  });
  // A single trailing newline is an artifact of block-wrapping, not content.
  return out.replace(/\n$/, '');
}
