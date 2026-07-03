'use client';

/**
 * EditableDoc — the unified in-place editor.
 *
 * The page IS the editor. Every block renders through the same components the
 * published page uses — spreads lay out through the real pretext RichFlow (so
 * dragging a figure reflows the prose live through the production engine),
 * callouts are the real Fumadocs <Callout>, code highlights with the real
 * shiki pipeline — and editability is layered on top:
 *
 *   - zero layout shift: insert lines, hover rails and selection rings paint
 *     on hover/focus only, so entering edit mode changes nothing visually
 *   - save-as-you-type: edits autosave (debounced) to the local draft
 *   - Enter splits a paragraph, Backspace at the start merges it back
 *   - structural undo/redo (⌘Z / ⇧⌘Z) with an undo toast on delete
 *   - a floating selection toolbar for bold / italic / code / links
 *   - unknown MDX (other JSX, imports, tables) is shown as a protected
 *     read-only block and round-trips verbatim
 *
 * All chrome uses the Fumadocs theme variables, so the editor is native in
 * light and dark mode and in any rebrand.
 */

import {
  Suspense,
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Code,
  GripVertical,
  Heading2,
  Image as ImageIcon,
  Info,
  Italic,
  LayoutGrid,
  Link as LinkIcon,
  Lock,
  Plus,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { Callout } from 'fumadocs-ui/components/callout';
import { useShiki } from 'fumadocs-core/highlight/client';
import { parseDoc, serializeDoc, type Block } from './mdx-blocks';
import { mdInlineToHtml, htmlToMdInline } from './inline-md';
import { parseAttrs, serializeAttrs, type SpreadAttrs } from '@/components/pretext/spread-tag';
import { RichFlow, type FlowObstacle } from '@/components/pretext/rich-flow';
import { Orb } from '@/components/pretext/spread';
import { mdToRuns } from '@/components/pretext/md-runs';
import { DraftImage } from '@/components/draft-image';
import { putAsset } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const SIDES: Array<NonNullable<SpreadAttrs['side']>> = ['left', 'inline', 'right', 'full'];

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

type CardItem = { title: string; href: string };
function parseCards(raw: string): CardItem[] {
  const items: CardItem[] = [];
  for (const m of raw.matchAll(/<Card\b([^>]*?)\/?>/g)) {
    const a = m[1] ?? '';
    items.push({ title: (a.match(/title="([^"]*)"/) ?? [])[1] ?? '', href: (a.match(/href="([^"]*)"/) ?? [])[1] ?? '/' });
  }
  return items;
}
function serializeCards(items: CardItem[]): string {
  return '<Cards>\n' + items.map((it) => `  <Card title="${it.title}" href="${it.href}" />`).join('\n') + '\n</Cards>';
}

function metaLine(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1]!.replace(/^["']|["']$/g, '') : '';
}
function setMetaLine(fm: string, key: string, val: string): string {
  if (new RegExp(`^${key}:`, 'm').test(fm)) return fm.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${val}`);
  if (/\n---\n?$/.test(fm)) return fm.replace(/\n---\n?$/, `\n${key}: ${val}\n---\n`);
  return `---\n${key}: ${val}\n---\n`;
}

/** Place the caret inside `el` at start/end/char offset. */
function placeCaret(el: HTMLElement, pos: 'start' | 'end' | number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (pos === 'start') {
    range.selectNodeContents(el);
    range.collapse(true);
  } else if (pos === 'end') {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let remaining = pos;
    let placed = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as globalThis.Text;
      if (remaining <= node.length) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= node.length;
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const caret = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(caret.startContainer, caret.startOffset);
  return pre.toString() === '';
}

/** Split the field's HTML content at the caret; both halves as markdown. */
function splitAtCaret(el: HTMLElement): { before: string; after: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const caret = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(caret.startContainer, caret.startOffset);
  const post = document.createRange();
  post.selectNodeContents(el);
  post.setStart(caret.endContainer, caret.endOffset);
  const toMd = (frag: DocumentFragment) => {
    const d = document.createElement('div');
    d.appendChild(frag);
    return htmlToMdInline(d).trim();
  };
  return { before: toMd(pre.cloneContents()), after: toMd(post.cloneContents()) };
}

/** Visible-text length of a markdown string once rendered (for caret math). */
function mdVisibleLength(md: string): number {
  const d = document.createElement('div');
  d.innerHTML = mdInlineToHtml(md);
  return (d.textContent ?? '').length;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const uploadPathFor = (file: File) => `/uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

/* ------------------------------------------------------------------ */
/* editable field                                                      */
/* ------------------------------------------------------------------ */

type FieldOpts = {
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
};

function editableField(
  tag: string,
  id: string,
  html: string,
  onLiveMd: (md: string) => void,
  onCommitMd: (md: string) => void,
  opts?: FieldOpts,
) {
  return createElement(tag, {
    key: id,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    className: `dd-field ${opts?.className ?? ''}`,
    style: opts?.style,
    'data-block-id': id,
    'data-rich-field': '1',
    'data-placeholder': opts?.placeholder ?? '',
    onInput: (e: React.FormEvent<HTMLElement>) => onLiveMd(htmlToMdInline(e.currentTarget)),
    onKeyDown: opts?.onKeyDown,
    onBlur: (e: React.FocusEvent<HTMLElement>) => onCommitMd(htmlToMdInline(e.currentTarget)),
    dangerouslySetInnerHTML: { __html: html },
  });
}

/* ------------------------------------------------------------------ */
/* syntax-highlighted code block                                       */
/* ------------------------------------------------------------------ */

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const node = useShiki(code, {
    lang: lang || 'txt',
    fallbackLanguage: 'txt',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  return <>{node}</>;
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre style={{ margin: 0, padding: '12px 16px', overflowX: 'auto', background: 'transparent' }}>
      <code>{code}</code>
    </pre>
  );
}

type CodeBlock = Extract<Block, { type: 'code' }>;

function EditorCode({
  b,
  onLang,
  onLive,
  onCommit,
}: {
  b: CodeBlock;
  onLang: (lang: string) => void;
  onLive: (code: string) => void;
  onCommit: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      style={{
        margin: '16px 0',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--color-fd-border)',
        background: 'var(--color-fd-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
        <input
          value={b.lang}
          onChange={(e) => onLang(e.target.value)}
          spellCheck={false}
          aria-label="Language"
          placeholder="lang"
          style={{
            width: 100, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)',
          }}
        />
      </div>
      {editing ? (
        <pre
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.focus();
              placeCaret(el, 'end');
            }
          }}
          onInput={(e) => onLive(e.currentTarget.textContent ?? '')}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              document.execCommand('insertText', false, '  ');
            }
          }}
          onBlur={(e) => {
            onCommit(e.currentTarget.textContent ?? '');
            setEditing(false);
          }}
          style={{
            margin: 0, padding: '12px 16px', outline: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.65,
            whiteSpace: 'pre', overflowX: 'auto', color: 'var(--color-fd-foreground)',
          }}
        >
          {b.code}
        </pre>
      ) : (
        <div
          onClick={() => setEditing(true)}
          title="Click to edit code"
          className="dd-codeview"
          style={{ cursor: 'text', fontSize: 13, lineHeight: 1.65 }}
        >
          <Suspense fallback={<PlainCode code={b.code} />}>
            <HighlightedCode code={b.code} lang={b.lang} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* spread block — the pretext moment                                   */
/* ------------------------------------------------------------------ */

type SpreadBlock = Extract<Block, { type: 'spread' }>;

function EditorSpread({
  b,
  selected,
  onSelect,
  onCommitAttrs,
  onLiveInner,
  onCommitInner,
  onUpload,
}: {
  b: SpreadBlock;
  selected: boolean;
  onSelect: () => void;
  onCommitAttrs: (attrs: SpreadAttrs) => void;
  onLiveInner: (md: string) => void;
  onCommitInner: (md: string) => void;
  onUpload: () => void;
}) {
  const committed = useMemo(() => parseAttrs(b.attrs), [b.attrs]);
  // During a drag we lay out from local attrs so pretext reflows the prose
  // live under the pointer; pointer-up commits the geometry to the doc.
  const [live, setLive] = useState<SpreadAttrs | null>(null);
  const [textEditing, setTextEditing] = useState(false);
  const a = live ?? committed;
  const side = a.side ?? 'right';
  const widthPct = a.width ?? 42;
  const top = a.top ?? 6;

  const finishDrag = (cur: SpreadAttrs | null) => {
    setLive(null);
    if (cur) onCommitAttrs(cur);
  };

  function startFigureDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-fig-ui]')) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    if (side === 'full') return;
    const startY = e.clientY;
    let cur: SpreadAttrs | null = null;
    const move = (ev: PointerEvent) => {
      const article = (document.querySelector('article') ?? document.body) as HTMLElement;
      const rect = article.getBoundingClientRect();
      const rel = (ev.clientX - rect.left) / rect.width;
      const nextSide: SpreadAttrs['side'] = rel < 0.34 ? 'left' : rel > 0.66 ? 'right' : 'inline';
      const nextTop = Math.max(0, Math.min(500, (committed.top ?? 6) + (ev.clientY - startY)));
      cur = { ...committed, side: nextSide, top: Math.round(nextTop) };
      setLive(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      finishDrag(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const article = (document.querySelector('article') ?? document.body) as HTMLElement;
    const colW = article.getBoundingClientRect().width || 720;
    const startX = e.clientX;
    const startW = widthPct;
    let cur: SpreadAttrs | null = null;
    const move = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / colW) * 100;
      const grow = side === 'left' ? dxPct : side === 'inline' ? dxPct * 2 : -dxPct;
      cur = { ...committed, width: Math.round(Math.max(24, Math.min(72, startW + grow))) };
      setLive(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      finishDrag(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const visual = a.orb ? (
    <Orb />
  ) : a.image ? (
    <DraftImage src={a.image} alt={a.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12, display: 'block' }} />
  ) : (
    <div
      style={{
        width: '100%', height: '100%', borderRadius: 12,
        background: 'var(--color-fd-card)', border: '1px dashed var(--color-fd-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-fd-muted-foreground)', fontSize: 13, gap: 6,
      }}
    >
      <ImageIcon size={15} /> Add an image
    </div>
  );

  const chip = selected && (
    <div
      data-fig-ui
      className="dd-pop"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: -44, left: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', whiteSpace: 'nowrap', zIndex: 45 }}
    >
      <div style={{ display: 'flex', gap: 1, background: 'var(--color-fd-muted)', borderRadius: 7, padding: 2 }}>
        {SIDES.map((s) => (
          <button key={s} className="dd-chip-btn" data-on={side === s} onClick={() => onCommitAttrs({ ...committed, side: s })} style={{ height: 22 }}>
            {s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {side !== 'full' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, borderLeft: '1px solid var(--color-fd-border)', paddingLeft: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
          {widthPct}%
        </span>
      )}
      <button
        className="dd-chip-btn"
        style={{ display: 'flex', alignItems: 'center', gap: 5, borderLeft: '1px solid var(--color-fd-border)', borderRadius: 0, paddingLeft: 9 }}
        onClick={onUpload}
      >
        <Upload size={12} /> {a.image ? 'Replace image' : 'Upload image'}
      </button>
    </div>
  );

  const figureNode = (
    <div
      onPointerDown={startFigureDrag}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      style={{
        position: 'relative', width: '100%', height: '100%', cursor: side === 'full' ? 'default' : 'grab', touchAction: 'none',
        ...(selected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 3, borderRadius: a.orb ? '50%' : 14 } : null),
      }}
    >
      {visual}
      {chip}
      {selected && side !== 'full' && (
        <div
          data-fig-ui
          onPointerDown={startResize}
          title="Drag to resize"
          style={{
            position: 'absolute', bottom: -7, right: -7, width: 14, height: 14,
            background: 'var(--color-fd-popover)', border: `2px solid ${ACCENT}`, borderRadius: 4,
            cursor: 'nwse-resize', zIndex: 40, touchAction: 'none',
          }}
        />
      )}
    </div>
  );

  if (textEditing) {
    // Focused: a float approximation so the caret behaves like normal text;
    // blur returns to the true pretext flow.
    const figStyle: CSSProperties =
      side === 'full'
        ? { width: '100%', aspectRatio: a.orb ? '1' : '4 / 3', margin: '6px 0 16px' }
        : side === 'inline'
          ? { width: `${widthPct}%`, aspectRatio: a.orb ? '1' : '4 / 3', margin: '6px auto 14px', float: 'none' }
          : { width: `${widthPct}%`, aspectRatio: a.orb ? '1' : '4 / 3', float: side, margin: side === 'left' ? '6px 24px 12px 0' : '6px 0 12px 24px' };
    return (
      <div style={{ display: 'flow-root' }}>
        <div style={figStyle}>{visual}</div>
        <p
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className="dd-field"
          data-block-id={b.id}
          data-rich-field="1"
          data-placeholder="Write the prose that flows around the figure…"
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.focus();
              placeCaret(el, 'end');
            }
          }}
          onInput={(e) => onLiveInner(htmlToMdInline(e.currentTarget))}
          onBlur={(e) => {
            onCommitInner(htmlToMdInline(e.currentTarget));
            setTextEditing(false);
          }}
          style={{ marginTop: 0 }}
          dangerouslySetInnerHTML={{ __html: mdInlineToHtml(b.inner) }}
        />
      </div>
    );
  }

  const obstacles: FlowObstacle[] = [
    {
      id: `fig-${b.id}`,
      side,
      shape: a.orb ? 'circle' : 'rect',
      widthPct,
      aspect: a.orb ? 1 : 4 / 3,
      anchorTop: top,
      gap: a.gap ?? 28,
      node: figureNode,
    },
  ];

  return (
    <div
      onClick={(e) => {
        // Clicking the prose (not the figure / a link) opens text editing.
        if ((e.target as HTMLElement).closest('[data-fig-ui]')) return;
        if ((e.target as HTMLElement).closest('a')) return;
        e.stopPropagation();
        setTextEditing(true);
      }}
      style={{ cursor: 'text' }}
    >
      <RichFlow
        runs={mdToRuns(b.inner)}
        obstacles={obstacles}
        fallback={<p style={{ margin: 0 }}>{b.inner}</p>}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* selection toolbar                                                   */
/* ------------------------------------------------------------------ */

function useSelectionToolbar(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [rect, setRect] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setRect(null);
      const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const field = anchor?.closest('[data-rich-field]');
      if (!field || !rootRef.current?.contains(field)) return setRect(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return setRect(null);
      setRect({ x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [rootRef]);

  const exec = useCallback((action: 'bold' | 'italic' | 'code' | 'link') => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const field = anchor?.closest('[data-rich-field]') as HTMLElement | null;
    if (!field) return;
    if (action === 'bold') document.execCommand('bold');
    else if (action === 'italic') document.execCommand('italic');
    else if (action === 'code') {
      const text = sel.toString();
      const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      document.execCommand('insertHTML', false, `<code>${esc}</code>`);
    } else {
      const url = window.prompt('Link URL');
      if (!url) return;
      document.execCommand('createLink', false, url);
    }
    // Let the field's normal input pipeline pick up the change (autosave).
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  return { rect, exec };
}

/* ------------------------------------------------------------------ */
/* the editor                                                          */
/* ------------------------------------------------------------------ */

type Snapshot = { frontmatter: string; blocks: Block[] };

const PALETTE: Array<{ type: string; label: string; icon: ReactNode }> = [
  { type: 'prose', label: 'Paragraph', icon: <Type size={15} /> },
  { type: 'heading', label: 'Heading', icon: <Heading2 size={15} /> },
  { type: 'callout', label: 'Callout', icon: <Info size={15} /> },
  { type: 'code', label: 'Code block', icon: <Code size={15} /> },
  { type: 'cards', label: 'Cards', icon: <LayoutGrid size={15} /> },
  { type: 'spread', label: 'Spread (figure)', icon: <ImageIcon size={15} /> },
];

export function EditableDoc({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const initial = useMemo(() => parseDoc(source), [source]);
  const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const [selFig, setSelFig] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest committed state, for callbacks and the autosave debounce.
  // (Assigned in a layout effect — before any user event can read it.)
  const stateRef = useRef<Snapshot>({ frontmatter, blocks });
  useLayoutEffect(() => {
    stateRef.current = { frontmatter, blocks };
  }, [frontmatter, blocks]);

  // Live (mid-typing) text per field, so drafts save as you type without
  // re-rendering the contentEditable out from under the caret.
  const liveTexts = useRef<Record<string, string>>({});
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo/redo of structural operations.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);

  // Field to focus after the next render (block split/merge/insert).
  const focusReq = useRef<{ id: string; at: 'start' | 'end' | number } | null>(null);

  const selection = useSelectionToolbar(rootRef);

  const emit = useCallback(
    (snap?: Snapshot) => {
      const s = snap ?? stateRef.current;
      const withLive = s.blocks.map((b) => {
        const t = liveTexts.current[b.id];
        if (t == null) return b;
        if (b.type === 'prose' || b.type === 'heading' || b.type === 'callout') return { ...b, text: t };
        if (b.type === 'spread') return { ...b, inner: t };
        if (b.type === 'code') return { ...b, code: t };
        return b;
      });
      let fm = s.frontmatter;
      if (liveTexts.current['fm:title'] != null) fm = setMetaLine(fm, 'title', liveTexts.current['fm:title']);
      if (liveTexts.current['fm:description'] != null) fm = setMetaLine(fm, 'description', liveTexts.current['fm:description']);
      onChange(serializeDoc({ frontmatter: fm, blocks: withLive }));
    },
    [onChange],
  );

  const scheduleEmit = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => emit(), 400);
  }, [emit]);
  useEffect(() => () => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const record = () => {
    past.current.push({ frontmatter: stateRef.current.frontmatter, blocks: stateRef.current.blocks });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  };
  const applySnapshot = useCallback((s: Snapshot) => {
    liveTexts.current = {};
    setFrontmatter(s.frontmatter);
    setBlocks(s.blocks);
    emit(s);
  }, [emit]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ ...stateRef.current });
    applySnapshot(prev);
    setToast(null);
  }, [applySnapshot]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ ...stateRef.current });
    applySnapshot(next);
  }, [applySnapshot]);

  // ⌘Z / ⇧⌘Z for structural ops when the caret isn't in a text field
  // (inside a field, the browser's native text undo applies).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable || active instanceof HTMLInputElement) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const commitBlocks = (next: Block[], opts?: { structural?: boolean }) => {
    if (opts?.structural) record();
    setBlocks(next);
    emit({ frontmatter: stateRef.current.frontmatter, blocks: next });
  };
  const update = (id: string, patch: Partial<Block>, opts?: { structural?: boolean }) => {
    delete liveTexts.current[id];
    commitBlocks(
      stateRef.current.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
      opts,
    );
  };
  const setLiveText = (id: string, text: string) => {
    liveTexts.current[id] = text;
    scheduleEmit();
  };
  const setMeta = (key: string, val: string) => {
    delete liveTexts.current[`fm:${key}`];
    const fm = setMetaLine(stateRef.current.frontmatter, key, val);
    setFrontmatter(fm);
    emit({ frontmatter: fm, blocks: stateRef.current.blocks });
  };

  function newBlock(type: string): Block {
    const id = newId();
    switch (type) {
      case 'heading': return { id, type: 'heading', depth: 2, text: 'New section' };
      case 'callout': return { id, type: 'callout', props: 'type="info"', text: 'Something worth pulling out of the flow.' };
      case 'code': return { id, type: 'code', lang: 'ts', meta: '', code: 'const x = 1;' };
      case 'cards': return { id, type: 'cards', raw: '<Cards>\n  <Card title="Title" href="/" />\n</Cards>' };
      case 'spread': return { id, type: 'spread', attrs: 'orb side="right" width="42%"', inner: 'Describe this figure — the prose here flows around it, laid out live by pretext.' };
      default: return { id, type: 'prose', text: '' };
    }
  }
  function insertBlock(type: string, index: number) {
    const b = newBlock(type);
    const next = stateRef.current.blocks.slice();
    next.splice(index, 0, b);
    setInsertAt(null);
    commitBlocks(next, { structural: true });
    if (b.type === 'prose' || b.type === 'heading') focusReq.current = { id: b.id, at: 'end' };
  }
  function deleteBlock(id: string) {
    commitBlocks(stateRef.current.blocks.filter((b) => b.id !== id), { structural: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg: 'Block deleted' });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }
  function moveBlock(index: number, dir: -1 | 1) {
    const j = index + dir;
    const cur = stateRef.current.blocks;
    if (j < 0 || j >= cur.length) return;
    const next = cur.slice();
    [next[index], next[j]] = [next[j]!, next[index]!];
    commitBlocks(next, { structural: true });
  }
  function reorderTo(from: number, to: number) {
    if (from === to || from + 1 === to) return; // dropped in place
    const next = stateRef.current.blocks.slice();
    const [m] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, m!);
    commitBlocks(next, { structural: true });
  }

  /* ---------------- block splitting / merging ---------------- */

  function splitBlock(b: Extract<Block, { type: 'prose' | 'heading' }>, el: HTMLElement) {
    const parts = splitAtCaret(el);
    if (!parts) return;
    delete liveTexts.current[b.id];
    const rest: Block = { id: newId(), type: 'prose', text: parts.after };
    const next = stateRef.current.blocks.flatMap((x): Block[] =>
      x.id === b.id ? [{ ...b, text: parts.before } as Block, rest] : [x],
    );
    focusReq.current = { id: rest.id, at: 'start' };
    commitBlocks(next, { structural: true });
  }

  function mergeWithPrevious(id: string, currentText: string): boolean {
    const cur = stateRef.current.blocks;
    const i = cur.findIndex((x) => x.id === id);
    const prev = cur[i - 1];
    if (!prev || (prev.type !== 'prose' && prev.type !== 'heading')) return false;
    const junction = mdVisibleLength(prev.text);
    const joiner = prev.text && currentText ? ' ' : '';
    const merged = prev.text + joiner + currentText;
    delete liveTexts.current[id];
    delete liveTexts.current[prev.id];
    const next = cur.flatMap((x): Block[] =>
      x.id === prev.id ? [{ ...prev, text: merged } as Block] : x.id === id ? [] : [x],
    );
    focusReq.current = { id: prev.id, at: junction + joiner.length };
    commitBlocks(next, { structural: true });
    return true;
  }

  // Focus the requested field after render.
  useLayoutEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${req.id}"]`);
    if (!el) return;
    el.focus();
    placeCaret(el, req.at);
  });

  const proseKeys = (b: Extract<Block, { type: 'prose' | 'heading' }>) => (e: React.KeyboardEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      splitBlock(b, el);
    } else if (e.key === 'Backspace' && b.type === 'prose' && caretAtStart(el)) {
      const current = liveTexts.current[b.id] ?? b.text;
      if (mergeWithPrevious(b.id, current)) e.preventDefault();
    }
  };

  /* ---------------- images ---------------- */

  async function onFile(file: File) {
    const id = fileFor.current;
    if (!id || !file.type.startsWith('image/')) return;
    const dataUrl = await readDataUrl(file);
    const path = uploadPathFor(file);
    await putAsset({ path, contentType: file.type, dataUrl });
    const b = stateRef.current.blocks.find((x) => x.id === id);
    if (b && b.type === 'spread') {
      const a = parseAttrs(b.attrs);
      update(id, { attrs: serializeAttrs({ ...a, orb: undefined, image: path, alt: file.name }) }, { structural: true });
    }
  }

  /* ---------------- pointer-based reorder ---------------- */

  function startReorder(e: React.PointerEvent, index: number) {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const indexAt = (clientY: number) => {
      const els = Array.from(root.querySelectorAll<HTMLElement>('[data-block-index]'));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return Number(el.dataset.blockIndex);
      }
      return els.length;
    };
    setDrag({ from: index, to: index });
    const move = (ev: PointerEvent) => setDrag({ from: index, to: indexAt(ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      reorderTo(index, indexAt(ev.clientY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------------- block renderer ---------------- */

  const field = (
    tag: string,
    id: string,
    html: string,
    onCommitMd: (md: string) => void,
    opts?: FieldOpts,
  ) => editableField(tag, id, html, (md) => setLiveText(id, md), onCommitMd, opts);

  function renderBlock(b: Block) {
    switch (b.type) {
      case 'heading':
        return field(`h${Math.min(6, Math.max(1, b.depth))}`, b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), {
          placeholder: 'Heading',
          onKeyDown: proseKeys(b),
        });
      case 'prose':
        return field('p', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), {
          placeholder: 'Type something, or press + to insert a block…',
          onKeyDown: proseKeys(b),
        });
      case 'code':
        return (
          <EditorCode
            key={b.id}
            b={b}
            onLang={(lang) => update(b.id, { lang })}
            onLive={(code) => setLiveText(b.id, code)}
            onCommit={(code) => update(b.id, { code })}
          />
        );
      case 'callout': {
        const type = (b.props.match(/type="(\w+)"/) ?? [])[1] ?? 'info';
        return (
          <Callout key={b.id} type={type as 'info'}>
            {field('div', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), { placeholder: 'Callout text' })}
          </Callout>
        );
      }
      case 'cards': {
        const items = parseCards(b.raw);
        const setItems = (next: CardItem[]) => update(b.id, { raw: serializeCards(next) });
        return (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, margin: '16px 0' }}>
            {items.map((it, i) => (
              <div key={i} style={{ position: 'relative', border: '1px solid var(--color-fd-border)', borderRadius: 12, padding: '14px 16px', background: 'var(--color-fd-card)' }}>
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  title="Remove card"
                  className="dd-icon-btn"
                  data-danger="1"
                  style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, border: 'none', background: 'transparent' }}
                >
                  <X size={12} />
                </button>
                {editableField(
                  'div',
                  `${b.id}t${i}`,
                  mdInlineToHtml(it.title),
                  () => {},
                  (md) => setItems(items.map((x, j) => (j === i ? { ...x, title: md } : x))),
                  { placeholder: 'Card title', style: { fontWeight: 600, fontSize: 15, color: 'var(--color-fd-foreground)' } },
                )}
                {editableField(
                  'div',
                  `${b.id}h${i}`,
                  mdInlineToHtml(it.href),
                  () => {},
                  (md) => setItems(items.map((x, j) => (j === i ? { ...x, href: md } : x))),
                  { placeholder: '/path', style: { fontSize: 12.5, color: 'var(--color-fd-muted-foreground)', marginTop: 2 } },
                )}
              </div>
            ))}
            <button
              onClick={() => setItems([...items, { title: 'New card', href: '/' }])}
              style={{
                border: '1px dashed var(--color-fd-border)', borderRadius: 12, padding: '14px 16px',
                background: 'transparent', color: ACCENT, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 64,
              }}
            >
              <Plus size={14} /> Card
            </button>
          </div>
        );
      }
      case 'spread':
        return (
          <EditorSpread
            key={b.id}
            b={b}
            selected={selFig === b.id}
            onSelect={() => setSelFig(b.id)}
            onCommitAttrs={(attrs) => update(b.id, { attrs: serializeAttrs(attrs) }, { structural: true })}
            onLiveInner={(md) => setLiveText(b.id, md)}
            onCommitInner={(md) => update(b.id, { inner: md })}
            onUpload={() => { fileFor.current = b.id; fileInput.current?.click(); }}
          />
        );
      case 'raw':
        return (
          <div
            key={b.id}
            title="This block contains custom MDX the visual editor keeps as-is. Move or delete it here; edit it in the source file."
            style={{
              margin: '16px 0', border: '1px dashed var(--color-fd-border)', borderRadius: 12,
              background: 'var(--color-fd-card)', padding: '10px 14px', opacity: 0.85,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)', marginBottom: 6 }}>
              <Lock size={11} /> Custom MDX — preserved as written
            </div>
            <pre style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--color-fd-muted-foreground)', maxHeight: 180, overflow: 'auto' }}>
              {b.raw}
            </pre>
          </div>
        );
    }
  }

  /* ---------------- insert row ---------------- */

  function insertRow(index: number) {
    const open = insertAt === index;
    return (
      <div className="dd-insert" onClick={(e) => e.stopPropagation()}>
        <div
          className="dd-insert-hit"
          data-open={open}
          onClick={() => setInsertAt(open ? null : index)}
          title="Insert a block"
        >
          <div className="dd-insert-line" />
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, margin: '0 8px', borderRadius: 7, flex: 'none',
              border: '1px solid var(--color-fd-border)', background: 'var(--color-fd-popover)', color: ACCENT,
              transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s ease',
            }}
          >
            <Plus size={14} />
          </div>
          <div className="dd-insert-line" />
        </div>
        {open && (
          <div
            className="dd-pop"
            style={{
              position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
              padding: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, width: 300,
            }}
          >
            {PALETTE.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => insertBlock(type, index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', border: 'none',
                  background: 'transparent', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  fontSize: 13.5, fontWeight: 500, color: 'var(--color-fd-foreground)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- render ---------------- */

  return (
    <div
      ref={rootRef}
      onClick={() => {
        setSelFig(null);
        setInsertAt(null);
      }}
    >
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />

      {/* Title + description use the exact Fumadocs page classes. */}
      <h1
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className="dd-field text-[1.75em] font-semibold"
        data-placeholder="Page title"
        onInput={(e) => { liveTexts.current['fm:title'] = e.currentTarget.textContent ?? ''; scheduleEmit(); }}
        onBlur={(e) => setMeta('title', e.currentTarget.textContent ?? '')}
      >
        {metaLine(frontmatter, 'title')}
      </h1>
      <p
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className="dd-field mb-0 text-lg text-fd-muted-foreground"
        data-placeholder="One-line description"
        onInput={(e) => { liveTexts.current['fm:description'] = e.currentTarget.textContent ?? ''; scheduleEmit(); }}
        onBlur={(e) => setMeta('description', e.currentTarget.textContent ?? '')}
      >
        {metaLine(frontmatter, 'description')}
      </p>
      <div style={{ height: 1, background: 'var(--color-fd-border)', margin: '24px 0' }} />

      <div className="prose" style={{ maxWidth: 'none' }}>
        {insertRow(0)}
        {/* The block factories close over latest-value refs (autosave buffer,
            snapshot) that are only ever read inside event handlers; the rule's
            interprocedural trace can't see that. React Compiler is not enabled. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {blocks.map((b, i) => (
          <div key={b.id} style={{ position: 'relative' }}>
            {drag && drag.to === i && <div className="dd-drop-line" style={{ top: -2 }} />}
            <div
              className="dd-block"
              data-block-index={i}
              style={{ position: 'relative', opacity: drag?.from === i ? 0.45 : 1 }}
            >
              <div className="dd-rail" style={{ left: -34 }} data-active={drag?.from === i}>
                <button className="dd-icon-btn" title="Drag to reorder" style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={(e) => startReorder(e, i)}>
                  <GripVertical size={13} />
                </button>
                <button className="dd-icon-btn" title="Move up" onClick={() => moveBlock(i, -1)}>
                  <ArrowUp size={13} />
                </button>
                <button className="dd-icon-btn" title="Move down" onClick={() => moveBlock(i, 1)}>
                  <ArrowDown size={13} />
                </button>
                <button className="dd-icon-btn" data-danger="1" title="Delete block" onClick={() => deleteBlock(b.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {renderBlock(b)}
            </div>
            {insertRow(i + 1)}
          </div>
        ))}
        {drag && drag.to === blocks.length && (
          <div style={{ position: 'relative' }}>
            <div className="dd-drop-line" style={{ top: -2 }} />
          </div>
        )}
      </div>

      {/* Selection toolbar */}
      {selection.rect && (
        <div
          className="dd-pop"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed', left: selection.rect.x, top: selection.rect.y - 42,
            transform: 'translateX(-50%)', zIndex: 95, display: 'flex', gap: 2, padding: 3,
          }}
        >
          <button className="dd-icon-btn" style={{ border: 'none', background: 'transparent' }} title="Bold (⌘B)" onClick={() => selection.exec('bold')}>
            <Bold size={13} />
          </button>
          <button className="dd-icon-btn" style={{ border: 'none', background: 'transparent' }} title="Italic (⌘I)" onClick={() => selection.exec('italic')}>
            <Italic size={13} />
          </button>
          <button className="dd-icon-btn" style={{ border: 'none', background: 'transparent' }} title="Inline code" onClick={() => selection.exec('code')}>
            <Code size={13} />
          </button>
          <button className="dd-icon-btn" style={{ border: 'none', background: 'transparent' }} title="Link" onClick={() => selection.exec('link')}>
            <LinkIcon size={13} />
          </button>
        </div>
      )}

      {/* Undo toast */}
      {toast && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 95,
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px 9px 16px', fontSize: 13.5,
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          {toast.msg}
          <button
            onClick={undo}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
              borderRadius: 8, border: 'none', background: ACCENT, color: '#fff',
              fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
            }}
          >
            <Undo2 size={12} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
