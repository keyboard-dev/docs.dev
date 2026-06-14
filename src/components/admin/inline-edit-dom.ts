/**
 * Scoped click-to-edit for plain-text blocks.
 *
 * A plain paragraph/heading renders its text verbatim from the MDX source, so
 * we can make it contentEditable and, on blur, find-and-replace that exact text
 * in the source — no markdown round-trip needed. Blocks whose rendered text is
 * NOT a unique verbatim slice of the source (i.e. they contain links, bold,
 * code, or are duplicated) are left alone and keep using the drawer editor.
 */

// Code blocks (<pre>) are included: their rendered text is a verbatim slice of
// the source between the fences, so editing replaces just the code body and
// leaves the ``` fences, title, and highlight meta untouched. Generated blocks
// (e.g. package-install → "npm install …") aren't verbatim in the source, so
// the uniqueness guard below skips them automatically.
const EDITABLE = 'article p, article h1, article h2, article h3, article h4, article li, article pre';
const MIN_LEN = 3;

export type InlineEditController = {
  /** Current working source, including all inline edits so far. */
  getSource: () => string;
  destroy: () => void;
};

export function enablePlainTextEditing(
  initialSource: string,
  onChange: (working: string) => void,
): InlineEditController {
  let working = initialSource;
  const root = document.querySelector('article') ?? document.body;
  const cleanups: Array<() => void> = [];

  const style = document.createElement('style');
  style.textContent = `
    [data-inline-edit]:hover { outline: 1px dashed rgba(232,117,59,0.6); outline-offset: 3px; cursor: text; }
    [data-inline-edit][contenteditable]:focus { outline: 2px solid rgba(232,117,59,0.9); outline-offset: 3px; border-radius: 2px; }
  `;
  document.head.appendChild(style);

  function uniqueIn(haystack: string, needle: string): boolean {
    const i = haystack.indexOf(needle);
    return i !== -1 && haystack.indexOf(needle, i + 1) === -1;
  }

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(EDITABLE)).filter((el) => {
    if (el.closest('[data-flow-source]') || el.closest('aside')) return false; // skip pretext flow + drawer
    if (el.offsetParent === null) return false; // skip hidden
    const text = el.textContent ?? '';
    if (text.trim().length < MIN_LEN) return false;
    return uniqueIn(working, text); // only plain, unambiguous blocks
  });

  for (const el of candidates) {
    el.dataset.inlineEdit = '1';
    el.dataset.orig = el.textContent ?? '';
    el.setAttribute('contenteditable', 'plaintext-only');

    const onBlur = () => {
      const next = el.textContent ?? '';
      const orig = el.dataset.orig ?? '';
      if (next === orig) return;
      const idx = working.indexOf(orig);
      if (idx === -1) {
        el.textContent = orig; // source moved under us; revert rather than corrupt
        return;
      }
      working = working.slice(0, idx) + next + working.slice(idx + orig.length);
      el.dataset.orig = next;
      onChange(working);
    };

    el.addEventListener('blur', onBlur);
    cleanups.push(() => {
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      delete el.dataset.inlineEdit;
      delete el.dataset.orig;
    });
  }

  return {
    getSource: () => working,
    destroy: () => {
      cleanups.forEach((fn) => fn());
      style.remove();
    },
  };
}
