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
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

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
    } else {
      out += htmlToMdInline(n);
    }
  });
  return out;
}
