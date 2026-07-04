import { Children, isValidElement, type ReactNode } from 'react';

/**
 * A run of text that shares one style. The flow engine measures and positions
 * each run with its own font, so inline formatting survives the magazine
 * layout instead of being flattened to plain text.
 */
export type RunKind = 'text' | 'code' | 'strong' | 'em' | 'link';
export type Run = { text: string; kind: RunKind; href?: string };

type Inherited = { kind: RunKind; href?: string };

function tagName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || '';
  }
  if (type && typeof type === 'object') {
    const obj = type as { displayName?: string };
    return obj.displayName || '';
  }
  return '';
}

/**
 * Flatten MDX-rendered children into styled runs. Anything we don't recognize
 * still has its text preserved (recursed as plain text), so prose is never
 * dropped — at worst a rare mark renders unstyled.
 */
const BLOCK_TAGS = new Set(['p', 'div', 'blockquote', 'li', 'ul', 'ol']);

export function extractRuns(node: ReactNode, inherited: Inherited = { kind: 'text' }): Run[] {
  const out: Run[] = [];
  Children.forEach(node, (child) => {
    if (child == null || typeof child === 'boolean') return;

    if (typeof child === 'string' || typeof child === 'number') {
      out.push({ text: String(child), kind: inherited.kind, href: inherited.href });
      return;
    }

    if (isValidElement(child)) {
      const props = (child.props ?? {}) as { href?: string; children?: ReactNode };
      const tag = tagName(child.type).toLowerCase();

      if (tag === 'br') {
        out.push({ text: ' ', kind: inherited.kind });
        return;
      }

      let kind = inherited.kind;
      let href = inherited.href;

      if (props.href) {
        kind = 'link';
        href = props.href;
      } else if (tag === 'code' || tag.includes('code')) {
        kind = 'code';
      } else if (tag === 'strong' || tag === 'b') {
        kind = 'strong';
      } else if (tag === 'em' || tag === 'i') {
        kind = 'em';
      }

      out.push(...extractRuns(props.children, { kind, href }));
      // Block boundaries (multiple paragraphs inside one Spread) must not
      // fuse the last word of one and the first of the next.
      if (BLOCK_TAGS.has(tag) && out.length > 0 && !/\s$/.test(out[out.length - 1]!.text)) {
        out.push({ text: ' ', kind: 'text' });
      }
    }
  });
  return out;
}
