/**
 * Scoped click-to-edit for plain-text blocks.
 *
 * A plain paragraph/heading/code block renders its text verbatim from the MDX
 * source, so we can make it contentEditable and edit it without a markdown
 * round-trip. Edits are keyed by the block's *original (published) text* in an
 * EditsMap, so they re-apply when you revisit the page (the rendered DOM always
 * starts from the published baseline). The merged source is derived by applying
 * the map to the baseline.
 *
 * Blocks whose rendered text is NOT a unique verbatim slice of the source
 * (links/bold/code spans, duplicates, the pretext <Spread> flow) are skipped
 * and keep using the drawer editor.
 */

import type { EditsMap } from '@/lib/drafts';

const EDITABLE =
  'article p, article h1, article h2, article h3, article h4, article li, article pre';
const MIN_LEN = 3;

export type InlineEditController = {
  setShowDraft: (show: boolean) => void;
  destroy: () => void;
};

function uniqueIn(haystack: string, needle: string): boolean {
  const i = haystack.indexOf(needle);
  return i !== -1 && haystack.indexOf(needle, i + 1) === -1;
}

/** Apply an edits map to the baseline source to get the merged draft. */
export function applyEdits(baseline: string, map: EditsMap): string {
  let out = baseline;
  for (const [base, next] of Object.entries(map)) {
    const idx = out.indexOf(base);
    if (idx !== -1) out = out.slice(0, idx) + next + out.slice(idx + base.length);
  }
  return out;
}

export function enablePlainTextEditing(
  baseline: string,
  initialMap: EditsMap,
  initialMerged: string,
  onChange: (map: EditsMap, merged: string) => void,
): InlineEditController {
  const map: EditsMap = { ...initialMap };
  // Working merged source; edits are applied as deltas so drawer edits (which
  // live in `merged` but not in `map`) are preserved.
  let merged = initialMerged;
  let showDraft = true;
  const root = document.querySelector('article') ?? document.body;
  const blocks: Array<{ el: HTMLElement; base: string; cleanup: () => void }> = [];

  const style = document.createElement('style');
  style.textContent = `
    [data-inline-edit]:hover { outline: 1px dashed rgba(232,117,59,0.6); outline-offset: 3px; cursor: text; }
    [data-inline-edit][contenteditable]:focus { outline: 2px solid rgba(232,117,59,0.9); outline-offset: 3px; border-radius: 2px; }
  `;
  document.head.appendChild(style);

  const display = (el: HTMLElement, base: string) => {
    const text = showDraft ? (map[base] ?? base) : base;
    if (el.textContent !== text) el.textContent = text;
    el.dataset.orig = text;
  };

  for (const el of Array.from(root.querySelectorAll<HTMLElement>(EDITABLE))) {
    if (el.closest('[data-flow-source]') || el.closest('aside')) continue; // pretext flow + drawer
    if (el.offsetParent === null) continue; // hidden
    const base = el.textContent ?? '';
    if (base.trim().length < MIN_LEN) continue;
    if (!uniqueIn(baseline, base)) continue; // only plain, unambiguous blocks

    el.dataset.inlineEdit = '1';
    el.dataset.base = base;
    el.setAttribute('contenteditable', 'plaintext-only');
    display(el, base);

    const onBlur = () => {
      const next = el.textContent ?? '';
      const prev = el.dataset.orig ?? '';
      if (next === prev) return;
      // Apply the delta (prev -> next) to the working merged source.
      const idx = merged.indexOf(prev);
      if (idx !== -1) merged = merged.slice(0, idx) + next + merged.slice(idx + prev.length);
      if (next === base) delete map[base];
      else map[base] = next;
      el.dataset.orig = next;
      onChange({ ...map }, merged);
    };
    el.addEventListener('blur', onBlur);
    blocks.push({
      el,
      base,
      cleanup: () => {
        el.removeEventListener('blur', onBlur);
        el.removeAttribute('contenteditable');
        delete el.dataset.inlineEdit;
        delete el.dataset.base;
        delete el.dataset.orig;
      },
    });
  }

  return {
    setShowDraft: (show: boolean) => {
      showDraft = show;
      for (const { el, base } of blocks) display(el, base);
    },
    destroy: () => {
      blocks.forEach((b) => b.cleanup());
      style.remove();
    },
  };
}
