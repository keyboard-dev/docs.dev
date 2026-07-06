'use client';

/**
 * EditableDoc — the unified in-place editor.
 *
 * The page IS the editor. Blocks render through the same components and the
 * same CSS the published page uses — spreads lay out through the real pretext
 * RichFlow (dragging a figure reflows the prose live through the production
 * engine), callouts are the real Fumadocs <Callout>, code carries the real
 * CodeBlock classes and shiki highlighting — and blocks are DIRECT children
 * of the same `.prose` container, so margins collapse exactly like the
 * published page. All editing chrome (hover rail, insert line, drop
 * indicator, palette) lives in a floating overlay that never adds a pixel to
 * the layout.
 *
 * Editing affordances:
 *   - save-as-you-type: edits autosave (debounced) to the local draft
 *   - Enter splits a paragraph, Backspace at the start merges it back
 *   - structural undo/redo (⌘Z / ⇧⌘Z) with an undo toast on delete
 *   - a floating selection toolbar for bold / italic / code / links
 *   - base doc blocks: paragraphs, headings, lists, quotes, code, callouts,
 *     cards, images, tables, dividers, spreads
 *   - unknown MDX (other JSX, imports, nested lists) is a protected
 *     read-only block that round-trips verbatim
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
  Bold,
  Code,
  GripVertical,
  Heading2,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Italic,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListOrdered,
  Lock,
  Minus,
  Plus,
  Quote as QuoteIcon,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { Callout } from 'fumadocs-ui/components/callout';
import { CodeBlockTab, CodeBlockTabs, CodeBlockTabsList, CodeBlockTabsTrigger, Pre } from 'fumadocs-ui/components/codeblock';
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

type CardItem = { title: string; href: string; description?: string };
function parseCards(raw: string): CardItem[] {
  const items: CardItem[] = [];
  for (const m of raw.matchAll(/<Card\b([^>]*?)\/?>/g)) {
    const a = m[1] ?? '';
    items.push({
      title: (a.match(/title="([^"]*)"/) ?? [])[1] ?? '',
      href: (a.match(/href="([^"]*)"/) ?? [])[1] ?? '/',
      description: (a.match(/description="([^"]*)"/) ?? [])[1],
    });
  }
  return items;
}
function serializeCards(items: CardItem[]): string {
  return (
    '<Cards>\n' +
    items
      .map((it) => `  <Card title="${it.title}" href="${it.href}"${it.description ? ` description="${it.description}"` : ''} />`)
      .join('\n') +
    '\n</Cards>'
  );
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

/** GitHub-style anchor slug, matching what the published headings get. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[*_`~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Plain text of an inline-markdown string (marks stripped). */
function mdPlainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* editable field                                                      */
/* ------------------------------------------------------------------ */

type FieldOpts = {
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
  index?: number;
  /** DOM id (heading anchors, so TOC links scroll to the right place). */
  htmlId?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
};

/**
 * React 19 re-applies dangerouslySetInnerHTML when the `{__html}` OBJECT
 * identity changes, even if the string is identical — which would reset a
 * contentEditable's DOM (wiping un-committed typing) on every unrelated
 * re-render. Cache the object per field so unchanged content keeps the same
 * identity and React leaves the DOM alone.
 */
const htmlObjCache = new Map<string, { __html: string }>();
function stableHtml(id: string, html: string): { __html: string } {
  const cur = htmlObjCache.get(id);
  if (cur && cur.__html === html) return cur;
  const next = { __html: html };
  htmlObjCache.set(id, next);
  return next;
}

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
    ...(opts?.htmlId ? { id: opts.htmlId } : null),
    ...(opts?.index != null ? { 'data-block-index': opts.index } : null),
    onInput: (e: React.FormEvent<HTMLElement>) => onLiveMd(htmlToMdInline(e.currentTarget)),
    onKeyDown: opts?.onKeyDown,
    onBlur: (e: React.FocusEvent<HTMLElement>) => onCommitMd(htmlToMdInline(e.currentTarget)),
    dangerouslySetInnerHTML: stableHtml(id, html),
  });
}

/* ------------------------------------------------------------------ */
/* code block — same classes as the published Fumadocs CodeBlock       */
/* ------------------------------------------------------------------ */

const LANGS = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'bash', 'sh', 'python', 'go', 'rust',
  'html', 'css', 'yaml', 'toml', 'md', 'mdx', 'sql', 'graphql', 'java', 'c',
  'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin', 'diff', 'txt', 'package-install',
];

/** Hover-revealed language dropdown for code blocks and code tabs. */
function LangSelect({ value, onChange }: { value: string; onChange: (lang: string) => void }) {
  const opts = !value || LANGS.includes(value) ? LANGS : [value, ...LANGS];
  return (
    <select
      value={value || 'txt'}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Language"
      className="dd-langchip"
      style={{
        position: 'absolute', top: 6, right: 8, zIndex: 5, height: 22,
        border: '1px solid var(--color-fd-border)', borderRadius: 6, outline: 'none',
        background: 'var(--color-fd-popover)', padding: '0 6px',
        fontFamily: 'ui-monospace, monospace', fontSize: 10.5, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)', cursor: 'pointer',
      }}
    >
      {opts.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const node = useShiki(code, {
    lang: lang || 'txt',
    fallbackLanguage: 'txt',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    // The published page renders shiki output through the same Pre component.
    components: { pre: Pre },
  });
  return <>{node}</>;
}

function PlainCode({ code }: { code: string }) {
  return (
    <Pre style={{ margin: 0, background: 'transparent' }}>
      <code>{code}</code>
    </Pre>
  );
}

/** The idle-highlighted / click-to-edit code surface, shared by standalone
 *  code blocks and code tabs. Carries the published viewport classes. */
function CodeEditArea({
  code,
  lang,
  onLive,
  onCommit,
}: {
  code: string;
  lang: string;
  onLive: (code: string) => void;
  onCommit: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
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
        // innerText (not textContent) so Enter-inserted <br>/<div> line
        // breaks survive the round trip.
        onInput={(e) => onLive(e.currentTarget.innerText ?? '')}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertText', false, '  ');
          }
        }}
        onBlur={(e) => {
          onCommit((e.currentTarget.innerText ?? '').replace(/\n$/, ''));
          setEditing(false);
        }}
        className="text-[0.8125rem] py-3.5 px-4"
        style={{
          margin: 0, outline: 'none',
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: 1.4286,
          whiteSpace: 'pre', overflowX: 'auto', color: 'var(--color-fd-foreground)',
        }}
      >
        {code}
      </pre>
    );
  }
  return (
    <div
      onClick={() => setEditing(true)}
      title="Click to edit code"
      className="dd-codeview text-[0.8125rem] py-3.5 overflow-auto max-h-[600px]"
      style={{ cursor: 'text' }}
    >
      <Suspense fallback={<PlainCode code={code} />}>
        <HighlightedCode code={code} lang={lang} />
      </Suspense>
    </div>
  );
}

type CodeBlockT = Extract<Block, { type: 'code' }>;

function EditorCode({
  b,
  index,
  onLang,
  onLive,
  onCommit,
}: {
  b: CodeBlockT;
  index: number;
  onLang: (lang: string) => void;
  onLive: (code: string) => void;
  onCommit: (code: string) => void;
}) {
  // Match the published CodeBlock: a header row exists only when the fence
  // has a title; the language is an on-hover chip so the geometry is
  // identical to the real page.
  const title = (b.meta.match(/title="([^"]*)"/) ?? [])[1];
  return (
    <figure
      data-block-index={index}
      className="my-4 bg-fd-card rounded-xl shiki relative border shadow-sm not-prose overflow-hidden text-sm"
    >
      <LangSelect value={b.lang} onChange={onLang} />
      {title != null && (
        <div className="flex text-fd-muted-foreground items-center gap-2 h-9.5 border-b px-4">
          <figcaption className="flex-1 truncate">{title}</figcaption>
        </div>
      )}
      <CodeEditArea code={b.code} lang={b.lang} onLive={onLive} onCommit={onCommit} />
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* code tabs — the real CodeBlockTabs, editable                        */
/* ------------------------------------------------------------------ */

type TabsBlockT = Extract<Block, { type: 'tabs' }>;

function EditorTabs({
  b,
  index,
  onCommit,
}: {
  b: TabsBlockT;
  index: number;
  onCommit: (tabs: TabsBlockT['tabs'], opts?: { structural?: boolean }) => void;
}) {
  const [sel, setSel] = useState(b.tabs[0]?.label ?? '');
  const active = b.tabs.some((t) => t.label === sel) ? sel : b.tabs[0]?.label ?? '';

  const uniqueLabel = (base: string) => {
    let label = base;
    let n = 2;
    while (b.tabs.some((t) => t.label === label)) label = `${base} ${n++}`;
    return label;
  };
  const tools: Array<[string, () => void]> = [
    ['+ Tab', () => {
      const label = uniqueLabel('New tab');
      onCommit([...b.tabs, { label, lang: 'ts', meta: '', code: '' }], { structural: true });
      setSel(label);
    }],
    ['Rename', () => {
      const next = window.prompt('Tab label', active)?.trim();
      if (!next || next === active) return;
      const label = uniqueLabel(next);
      onCommit(b.tabs.map((t) => (t.label === active ? { ...t, label } : t)), { structural: true });
      setSel(label);
    }],
    ['− Tab', () => {
      if (b.tabs.length <= 1) return;
      const rest = b.tabs.filter((t) => t.label !== active);
      onCommit(rest, { structural: true });
      setSel(rest[0]!.label);
    }],
  ];

  return (
    <CodeBlockTabs
      data-block-index={index}
      className="dd-tablewrap"
      value={active}
      onValueChange={setSel}
      style={{ position: 'relative', overflow: 'visible' }}
    >
      <div className="dd-tabletools dd-pop" style={{ position: 'absolute', top: -34, right: 0, display: 'flex', gap: 2, padding: 3, zIndex: 40 }}>
        {tools.map(([label, fn]) => (
          <button key={label} className="dd-chip-btn" style={{ height: 22 }} onClick={(e) => { e.stopPropagation(); fn(); }}>
            {label}
          </button>
        ))}
      </div>
      <CodeBlockTabsList>
        {b.tabs.map((t) => (
          <CodeBlockTabsTrigger key={t.label} value={t.label}>
            {t.label}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {b.tabs.map((t, ti) => (
        <CodeBlockTab key={t.label} value={t.label}>
          {/* Same classes as the published nested CodeBlock (inTab variant). */}
          <figure className="bg-fd-secondary -mx-px -mb-px rounded-b-xl shiki relative border shadow-sm not-prose overflow-hidden text-sm" style={{ position: 'relative' }}>
            <LangSelect value={t.lang} onChange={(lang) => onCommit(b.tabs.map((x, j) => (j === ti ? { ...x, lang } : x)))} />
            <CodeEditArea
              code={t.code}
              lang={t.lang}
              onLive={() => {}}
              onCommit={(code) => onCommit(b.tabs.map((x, j) => (j === ti ? { ...x, code } : x)))}
            />
          </figure>
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  );
}

/* ------------------------------------------------------------------ */
/* spread block — the pretext moment                                   */
/* ------------------------------------------------------------------ */

type SpreadBlockT = Extract<Block, { type: 'spread' }>;

function EditorSpread({
  b,
  index,
  selected,
  onSelect,
  onCommitAttrs,
  onLiveInner,
  onCommitInner,
  onUpload,
  onGenerateImage,
}: {
  b: SpreadBlockT;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onCommitAttrs: (attrs: SpreadAttrs) => void;
  onLiveInner: (md: string) => void;
  onCommitInner: (md: string) => void;
  onUpload: () => void;
  onGenerateImage?: () => void;
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
      {onGenerateImage && (
        <button
          className="dd-chip-btn"
          style={{ display: 'flex', alignItems: 'center', gap: 5, borderLeft: '1px solid var(--color-fd-border)', borderRadius: 0, paddingLeft: 9 }}
          onClick={onGenerateImage}
        >
          <Sparkles size={12} /> Generate
        </button>
      )}
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

  const captionText = a.caption ?? '';
  const captionStyle: CSSProperties = {
    marginTop: 8,
    fontSize: 12.5,
    lineHeight: '17px',
    textAlign: 'center',
    color: 'var(--color-fd-muted-foreground)',
  };
  const editableCaption = (
    <figcaption
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-fig-ui
      className="dd-field"
      data-placeholder="Add a caption…"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onCommitAttrs({ ...committed, caption: (e.currentTarget.textContent ?? '').trim() || undefined })}
      style={captionStyle}
    >
      {captionText}
    </figcaption>
  );

  if (textEditing) {
    // Focused: a float approximation so the caret behaves like normal text;
    // blur returns to the true pretext flow.
    const figStyle: CSSProperties =
      side === 'full'
        ? { width: '100%', margin: '6px 0 16px' }
        : side === 'inline'
          ? { width: `${widthPct}%`, margin: '6px auto 14px', float: 'none' }
          : { width: `${widthPct}%`, float: side, margin: side === 'left' ? '6px 24px 12px 0' : '6px 0 12px 24px' };
    return (
      <div data-block-index={index} style={{ display: 'flow-root' }}>
        <div style={figStyle}>
          <div style={{ aspectRatio: a.orb ? '1' : '4 / 3' }}>{visual}</div>
          {(captionText || selected) && editableCaption}
        </div>
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
          dangerouslySetInnerHTML={stableHtml(`${b.id}:inner`, mdInlineToHtml(b.inner))}
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
      caption: captionText || selected ? { text: captionText, node: editableCaption } : undefined,
    },
  ];

  return (
    <div
      data-block-index={index}
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
/* image block                                                         */
/* ------------------------------------------------------------------ */

type ImageBlockT = Extract<Block, { type: 'image' }>;

function EditorImage({
  b,
  index,
  selected,
  onSelect,
  onAlt,
  onUpload,
  onGenerate,
}: {
  b: ImageBlockT;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onAlt: (alt: string) => void;
  onUpload: () => void;
  onGenerate?: () => void;
}) {
  return (
    <p
      data-block-index={index}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      style={{ position: 'relative', cursor: 'pointer', ...(selected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 3, borderRadius: 12 } : null) }}
    >
      {b.src ? (
        <DraftImage src={b.src} alt={b.alt} className="rounded-lg" style={{ maxWidth: '100%', display: 'block' }} />
      ) : (
        <span
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 160,
            borderRadius: 12, border: '1px dashed var(--color-fd-border)', background: 'var(--color-fd-card)',
            color: 'var(--color-fd-muted-foreground)', fontSize: 13.5,
          }}
        >
          <ImagePlus size={16} /> Click Upload to add an image
        </span>
      )}
      {selected && (
        <span
          data-fig-ui
          className="dd-pop"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: -44, left: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', whiteSpace: 'nowrap', zIndex: 45 }}
        >
          <button className="dd-chip-btn" style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={onUpload}>
            <Upload size={12} /> {b.src ? 'Replace' : 'Upload'}
          </button>
          {onGenerate && (
            <button className="dd-chip-btn" style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={onGenerate}>
              <Sparkles size={12} /> Generate
            </button>
          )}
          <input
            defaultValue={b.alt}
            placeholder="Alt text"
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onAlt(e.target.value)}
            style={{
              width: 180, height: 24, border: '1px solid var(--color-fd-border)', borderRadius: 7,
              background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 12, padding: '0 8px', outline: 'none',
            }}
          />
        </span>
      )}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* table block                                                         */
/* ------------------------------------------------------------------ */

type TableBlockT = Extract<Block, { type: 'table' }>;

function EditorTable({
  b,
  index,
  onCommit,
}: {
  b: TableBlockT;
  index: number;
  onCommit: (patch: { header: string[]; rows: string[][]; align?: string[] }) => void;
}) {
  const commitFromDom = (cell: HTMLElement) => {
    const table = cell.closest('table');
    if (!table) return;
    const all = Array.from(table.rows).map((r) => Array.from(r.cells).map((c) => htmlToMdInline(c).trim()));
    onCommit({ header: all[0] ?? [], rows: all.slice(1) });
  };
  const cell = (tag: 'th' | 'td', key: string, text: string) =>
    createElement(tag, {
      key,
      contentEditable: true,
      suppressContentEditableWarning: true,
      spellCheck: false,
      'data-rich-field': '1',
      style: { outline: 'none', minWidth: 60 },
      onBlur: (e: React.FocusEvent<HTMLElement>) => commitFromDom(e.currentTarget),
      dangerouslySetInnerHTML: stableHtml(key, mdInlineToHtml(text)),
    });
  const cols = Math.max(b.header.length, 1);
  const tools: Array<[string, () => void]> = [
    ['+ Row', () => onCommit({ header: b.header, rows: [...b.rows, Array.from({ length: cols }, () => '')] })],
    ['+ Col', () => onCommit({ header: [...b.header, ''], align: [...b.align, ''], rows: b.rows.map((r) => [...r, '']) })],
    ['− Row', () => b.rows.length > 0 && onCommit({ header: b.header, rows: b.rows.slice(0, -1) })],
    ['− Col', () => cols > 1 && onCommit({ header: b.header.slice(0, -1), align: b.align.slice(0, -1), rows: b.rows.map((r) => r.slice(0, -1)) })],
  ];
  return (
    <div data-block-index={index} className="dd-tablewrap relative overflow-visible prose-no-margin my-6">
      <div className="dd-tabletools dd-pop" style={{ position: 'absolute', top: -34, right: 0, display: 'flex', gap: 2, padding: 3, zIndex: 40 }}>
        {tools.map(([label, fn]) => (
          <button key={label} className="dd-chip-btn" style={{ height: 22 }} onClick={(e) => { e.stopPropagation(); fn(); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="relative overflow-auto prose-no-margin">
        <table>
          <thead>
            <tr>{b.header.map((h, i) => cell('th', `${b.id}h${i}`, h))}</tr>
          </thead>
          <tbody>
            {b.rows.map((row, ri) => (
              <tr key={`${b.id}r${ri}`}>{Array.from({ length: cols }, (_, ci) => cell('td', `${b.id}r${ri}c${ci}`, row[ci] ?? ''))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* list block                                                          */
/* ------------------------------------------------------------------ */

type ListBlockT = Extract<Block, { type: 'list' }>;

function itemsFromDom(root: HTMLElement): string[] {
  return htmlToMdInline(root)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function EditorList({
  b,
  index,
  onLive,
  onCommit,
}: {
  b: ListBlockT;
  index: number;
  onLive: (items: string[]) => void;
  onCommit: (items: string[]) => void;
}) {
  return createElement(b.ordered ? 'ol' : 'ul', {
    key: b.id,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    className: 'dd-field',
    'data-block-id': b.id,
    'data-rich-field': '1',
    'data-block-index': index,
    onInput: (e: React.FormEvent<HTMLElement>) => onLive(itemsFromDom(e.currentTarget)),
    onBlur: (e: React.FocusEvent<HTMLElement>) => onCommit(itemsFromDom(e.currentTarget)),
    dangerouslySetInnerHTML: stableHtml(b.id, b.items.map((it) => `<li>${mdInlineToHtml(it)}</li>`).join('')),
  });
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
  { type: 'list', label: 'Bullet list', icon: <List size={15} /> },
  { type: 'olist', label: 'Numbered list', icon: <ListOrdered size={15} /> },
  { type: 'quote', label: 'Quote', icon: <QuoteIcon size={15} /> },
  { type: 'code', label: 'Code block', icon: <Code size={15} /> },
  { type: 'tabs', label: 'Code tabs', icon: <Code size={15} /> },
  { type: 'callout', label: 'Callout', icon: <Info size={15} /> },
  { type: 'cards', label: 'Cards', icon: <LayoutGrid size={15} /> },
  { type: 'image', label: 'Image', icon: <ImagePlus size={15} /> },
  { type: 'table', label: 'Table', icon: <TableIcon size={15} /> },
  { type: 'spread', label: 'Spread (figure)', icon: <ImageIcon size={15} /> },
  { type: 'hr', label: 'Divider', icon: <Minus size={15} /> },
];

type BlockRect = { index: number; top: number; bottom: number };

export function EditableDoc({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const initial = useMemo(() => parseDoc(source), [source]);
  const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const [selFig, setSelFig] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<{ index: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ index: number; top: number } | null>(null);
  const [gapHover, setGapHover] = useState<{ index: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: boolean } | null>(null);
  // "Generate with AI" popover (opened from the insert palette).
  const [aiAt, setAiAt] = useState<{ index: number; y: number } | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSearch, setAiSearch] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/ai/generate')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => !cancelled && setAiAvailable(!!d.available))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRaf = useRef(0);

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
        if (b.type === 'prose' || b.type === 'heading' || b.type === 'callout' || b.type === 'quote') return { ...b, text: t };
        if (b.type === 'spread') return { ...b, inner: t };
        if (b.type === 'code') return { ...b, code: t };
        if (b.type === 'list') return { ...b, items: t.split('\n').filter(Boolean) };
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
    cancelAnimationFrame(hoverRaf.current);
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
      if (e.key === 'Escape') {
        setInsertAt(null);
        setSelFig(null);
        return;
      }
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
      case 'tabs': return { id, type: 'tabs', tabs: [{ label: 'Tab 1', lang: 'ts', meta: '', code: 'const x = 1;' }, { label: 'Tab 2', lang: 'js', meta: '', code: 'const x = 1;' }] };
      case 'cards': return { id, type: 'cards', raw: '<Cards>\n  <Card title="Title" href="/" />\n</Cards>' };
      case 'spread': return { id, type: 'spread', attrs: 'orb side="right" width="42%"', inner: 'Describe this figure — the prose here flows around it, laid out live by pretext.' };
      case 'list': return { id, type: 'list', ordered: false, items: ['First item'] };
      case 'olist': return { id, type: 'list', ordered: true, items: ['First item'] };
      case 'quote': return { id, type: 'quote', text: 'A line worth quoting.' };
      case 'image': return { id, type: 'image', src: '', alt: '' };
      case 'table': return { id, type: 'table', header: ['Column', 'Column'], align: [], rows: [['', '']] };
      case 'hr': return { id, type: 'hr' };
      default: return { id, type: 'prose', text: '' };
    }
  }
  function insertBlock(type: string, index: number) {
    const b = newBlock(type);
    const next = stateRef.current.blocks.slice();
    next.splice(index, 0, b);
    setInsertAt(null);
    commitBlocks(next, { structural: true });
    if (b.type === 'prose' || b.type === 'heading' || b.type === 'quote' || b.type === 'list') focusReq.current = { id: b.id, at: 'end' };
    if (b.type === 'image') {
      fileFor.current = b.id;
      fileInput.current?.click();
    }
    if (b.type === 'spread' || b.type === 'image') setSelFig(b.id);
  }
  function deleteBlock(id: string) {
    commitBlocks(stateRef.current.blocks.filter((b) => b.id !== id), { structural: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg: 'Block deleted', undo: true });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  function notify(msg: string, ms = 4000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg });
    if (ms > 0) toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  /* ---------------- AI generation ---------------- */

  async function generateBlocks() {
    const prompt = aiPrompt.trim();
    if (!prompt || !aiAt || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const res = await fetch('/api/admin/ai/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'doc',
          prompt,
          useSearch: aiSearch,
          pageTitle: metaLine(stateRef.current.frontmatter, 'title'),
          pageContext: serializeDoc({ frontmatter: '', blocks: stateRef.current.blocks }).slice(0, 6000),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; markdown?: string; error?: string };
      if (!res.ok || !data.markdown) throw new Error(data.error ?? 'Generation failed.');
      // The generated markdown becomes real editable blocks in place.
      const generated = parseDoc(data.markdown).blocks;
      if (generated.length === 0) throw new Error('The model returned no usable content.');
      const next = stateRef.current.blocks.slice();
      next.splice(aiAt.index, 0, ...generated);
      commitBlocks(next, { structural: true });
      setAiAt(null);
      setAiPrompt('');
      notify(`Inserted ${generated.length} generated block${generated.length === 1 ? '' : 's'} — edit them like anything else. ⌘Z undoes.`, 6000);
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function generateImageFor(id: string) {
    const promptText = window.prompt('Describe the image to generate:')?.trim();
    if (!promptText) return;
    notify('Generating image…', 0);
    try {
      const res = await fetch('/api/admin/ai/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'image', prompt: promptText }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; dataUrl?: string; contentType?: string; error?: string };
      if (!res.ok || !data.dataUrl) throw new Error(data.error ?? 'Image generation failed.');
      const ext = data.contentType === 'image/svg+xml' ? 'svg' : 'jpg';
      const path = uploadPathFor(new File([], `ai-generated.${ext}`));
      await putAsset({ path, contentType: data.contentType ?? 'image/jpeg', dataUrl: data.dataUrl });
      const b = stateRef.current.blocks.find((x) => x.id === id);
      const alt = promptText.slice(0, 120);
      if (b?.type === 'spread') {
        const a = parseAttrs(b.attrs);
        update(id, { attrs: serializeAttrs({ ...a, orb: undefined, image: path, alt }) }, { structural: true });
      } else if (b?.type === 'image') {
        update(id, { src: path, alt }, { structural: true });
      }
      notify('Image generated ✓ — publish commits it to the repo.');
    } catch (err) {
      notify((err as Error).message, 6000);
    }
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

  /* ---------------- live table of contents ---------------- */

  // The "On this page" rail tracks the doc as you edit. The theme's own item
  // list is React-owned (with resize observers over its anchors), so we never
  // mutate it — we hide it (its zero-height guard idles the observers) and
  // render our own sibling list, template-cloned from the theme's markup so
  // the styling survives. Retitled live while you type.
  const tocRef = useRef<{ original: HTMLElement; mine: HTMLElement; template: HTMLAnchorElement } | null>(null);
  useEffect(() => {
    try {
      if (!tocRef.current) {
        const first = document.querySelector<HTMLAnchorElement>('#nd-toc a[href^="#"]');
        const original = first?.parentElement;
        if (!first || !original || !original.parentElement) return;
        const mine = document.createElement('div');
        mine.className = original.className;
        original.parentElement.insertBefore(mine, original.nextSibling);
        original.style.display = 'none';
        tocRef.current = { original, mine, template: first.cloneNode(true) as HTMLAnchorElement };
      }
      const { mine, template } = tocRef.current;
      const frag = document.createDocumentFragment();
      for (const h of blocks.filter((x): x is Extract<Block, { type: 'heading' }> => x.type === 'heading')) {
        const aEl = template.cloneNode(true) as HTMLAnchorElement;
        const plain = mdPlainText(h.text);
        aEl.setAttribute('href', '#' + slugify(plain));
        aEl.setAttribute('data-dd-heading', h.id);
        aEl.removeAttribute('data-active');
        const svg = aEl.querySelector('svg');
        aEl.textContent = '';
        if (svg) aEl.appendChild(svg);
        aEl.appendChild(document.createTextNode(plain));
        frag.appendChild(aEl);
      }
      mine.replaceChildren(frag);
    } catch {
      // TOC markup is theme-specific; live updates are best-effort.
    }
  }, [blocks]);
  // Restore the built page's TOC when the editor closes.
  useEffect(
    () => () => {
      const t = tocRef.current;
      if (t) {
        t.mine.remove();
        t.original.style.display = '';
      }
    },
    [],
  );

  const patchTocTitle = (id: string, md: string) => {
    const aEl = document.querySelector(`#nd-toc a[data-dd-heading="${id}"]`);
    const last = aEl?.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.textContent = mdPlainText(md);
  };

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
    } else if (b && b.type === 'image') {
      update(id, { src: path, alt: b.alt || file.name }, { structural: true });
    }
  }

  /* ---------------- chrome geometry (overlay) ---------------- */

  function blockRects(): BlockRect[] {
    const prose = proseRef.current;
    if (!prose) return [];
    const pr = prose.getBoundingClientRect();
    return Array.from(prose.querySelectorAll<HTMLElement>('[data-block-index]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { index: Number(el.dataset.blockIndex), top: r.top - pr.top, bottom: r.bottom - pr.top };
      })
      .sort((a, b) => a.index - b.index);
  }

  function gapAt(rects: BlockRect[], k: number): number {
    if (rects.length === 0) return 0;
    if (k <= 0) return rects[0]!.top - 6;
    if (k >= rects.length) return rects[rects.length - 1]!.bottom + 6;
    return (rects[k - 1]!.bottom + rects[k]!.top) / 2;
  }

  const onHoverMove = (e: React.MouseEvent) => {
    if (insertAt || drag) return;
    // Over the chrome itself (rail, insert line): freeze the current state so
    // the controls can't vanish out from under the pointer.
    if ((e.target as HTMLElement).closest('[data-dd-chrome]')) return;
    const prose = proseRef.current;
    if (!prose) return;
    const rect = prose.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => {
      const rects = blockRects();
      if (rects.length === 0) {
        setHover(null);
        setGapHover(null);
        return;
      }
      // The insert line only competes for the pointer inside the text column;
      // in the left gutter (on the way to the rail) the rail always wins.
      let gap: { index: number; y: number } | null = null;
      if (x >= 0 && x <= rect.width) {
        for (let k = 0; k <= rects.length; k++) {
          const gy = gapAt(rects, k);
          if (Math.abs(y - gy) <= 7) {
            gap = { index: k, y: gy };
            break;
          }
        }
      }
      const hit = rects.find((r) => y >= r.top - 4 && y <= r.bottom + 4);
      setGapHover(gap);
      setHover(gap ? null : hit ? { index: hit.index, top: hit.top } : null);
    });
  };
  const clearHover = () => {
    if (insertAt) return;
    setHover(null);
    setGapHover(null);
  };

  /* ---------------- pointer-based reorder ---------------- */

  function startReorder(e: React.PointerEvent, index: number) {
    e.preventDefault();
    const prose = proseRef.current;
    if (!prose) return;
    const target = (clientY: number) => {
      const rects = blockRects();
      const y = clientY - prose.getBoundingClientRect().top;
      let to = rects.length;
      for (const r of rects) {
        if (y < (r.top + r.bottom) / 2) {
          to = r.index;
          break;
        }
      }
      return { to, y: gapAt(rects, to) };
    };
    setHover(null);
    setGapHover(null);
    const first = target(e.clientY);
    setDrag({ from: index, ...first });
    const move = (ev: PointerEvent) => setDrag({ from: index, ...target(ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const { to } = target(ev.clientY);
      setDrag(null);
      reorderTo(index, to);
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

  function renderBlock(b: Block, i: number) {
    switch (b.type) {
      case 'heading':
        return editableField(
          `h${Math.min(6, Math.max(1, b.depth))}`,
          b.id,
          mdInlineToHtml(b.text),
          (md) => {
            setLiveText(b.id, md);
            patchTocTitle(b.id, md);
          },
          (md) => update(b.id, { text: md }),
          {
            placeholder: 'Heading',
            index: i,
            htmlId: slugify(mdPlainText(b.text)),
            onKeyDown: proseKeys(b),
          },
        );
      case 'prose':
        return field('p', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), {
          placeholder: 'Type something…',
          index: i,
          onKeyDown: proseKeys(b),
        });
      case 'quote':
        return field('blockquote', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), {
          placeholder: 'Quote',
          index: i,
        });
      case 'list':
        return (
          <EditorList
            key={b.id}
            b={b}
            index={i}
            onLive={(items) => setLiveText(b.id, items.join('\n'))}
            onCommit={(items) => update(b.id, { items })}
          />
        );
      case 'code':
        return (
          <EditorCode
            key={b.id}
            b={b}
            index={i}
            onLang={(lang) => update(b.id, { lang })}
            onLive={(code) => setLiveText(b.id, code)}
            onCommit={(code) => update(b.id, { code })}
          />
        );
      case 'callout': {
        const type = (b.props.match(/type="(\w+)"/) ?? [])[1] ?? 'info';
        // The title attr renders as the callout's bold first line — keep it
        // visible and editable so the box matches the published geometry.
        const title = (b.props.match(/title="([^"]*)"/) ?? [])[1];
        const setTitle = (md: string) =>
          update(b.id, {
            props: /title="/.test(b.props)
              ? b.props.replace(/title="[^"]*"/, `title="${md.replace(/"/g, '')}"`)
              : `${b.props} title="${md.replace(/"/g, '')}"`.trim(),
          });
        return (
          <Callout
            key={b.id}
            type={type as 'info'}
            data-block-index={i}
            title={
              title != null
                ? editableField('div', `${b.id}:ctitle`, mdInlineToHtml(title), () => {}, setTitle, { placeholder: 'Callout title' })
                : undefined
            }
          >
            {field('div', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), { placeholder: 'Callout text' })}
          </Callout>
        );
      }
      case 'cards': {
        const items = parseCards(b.raw);
        const setItems = (next: CardItem[]) => update(b.id, { raw: serializeCards(next) });
        return (
          <div key={b.id} data-block-index={i} className="dd-tablewrap grid grid-cols-2 gap-3 @container" style={{ position: 'relative' }}>
            {/* Add-card is an overlay chip (like the table tools), so the grid
                keeps the exact geometry of the published <Cards>. */}
            <div className="dd-tabletools dd-pop" style={{ position: 'absolute', top: -34, right: 0, display: 'flex', gap: 2, padding: 3, zIndex: 40 }}>
              <button
                className="dd-chip-btn"
                style={{ height: 22, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={(e) => { e.stopPropagation(); setItems([...items, { title: 'New card', href: '/', description: '' }]); }}
              >
                <Plus size={12} /> Card
              </button>
            </div>
            {items.map((it, ci) => (
              <div key={ci} className="not-prose block rounded-xl border bg-fd-card p-4 text-fd-card-foreground" style={{ position: 'relative' }}>
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== ci))}
                  title="Remove card"
                  style={{ position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent', color: 'var(--color-fd-muted-foreground)', cursor: 'pointer', display: 'flex' }}
                >
                  <X size={12} />
                </button>
                {editableField('h3', `${b.id}t${ci}`, mdInlineToHtml(it.title), () => {}, (md) => setItems(items.map((x, j) => (j === ci ? { ...x, title: md } : x))), {
                  placeholder: 'Card title',
                  className: 'not-prose mb-1 text-sm font-medium',
                })}
                {it.description != null &&
                  editableField('p', `${b.id}d${ci}`, mdInlineToHtml(it.description), () => {}, (md) => setItems(items.map((x, j) => (j === ci ? { ...x, description: md } : x))), {
                    placeholder: 'Card description',
                    className: 'not-prose my-0 text-sm text-fd-muted-foreground',
                  })}
                {/* The link target edits in a floating chip (shown on hover),
                    so the card keeps the published <Card> geometry. */}
                <input
                  defaultValue={it.href}
                  placeholder="/path"
                  spellCheck={false}
                  className="dd-langchip"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => setItems(items.map((x, j) => (j === ci ? { ...x, href: e.target.value } : x)))}
                  style={{
                    position: 'absolute', bottom: -11, left: 12, right: 12, height: 22, zIndex: 5,
                    border: '1px solid var(--color-fd-border)', borderRadius: 6, outline: 'none',
                    background: 'var(--color-fd-popover)', padding: '0 8px',
                    fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--color-fd-muted-foreground)',
                  }}
                />
              </div>
            ))}
          </div>
        );
      }
      case 'image':
        return (
          <EditorImage
            key={b.id}
            b={b}
            index={i}
            selected={selFig === b.id}
            onSelect={() => setSelFig(b.id)}
            onAlt={(alt) => update(b.id, { alt })}
            onUpload={() => { fileFor.current = b.id; fileInput.current?.click(); }}
            onGenerate={aiAvailable ? () => void generateImageFor(b.id) : undefined}
          />
        );
      case 'table':
        return <EditorTable key={b.id} b={b} index={i} onCommit={(patch) => update(b.id, patch)} />;
      case 'tabs':
        return <EditorTabs key={b.id} b={b} index={i} onCommit={(tabs, opts) => update(b.id, { tabs }, opts)} />;
      case 'hr':
        return <hr key={b.id} data-block-index={i} />;
      case 'spread':
        return (
          <EditorSpread
            key={b.id}
            b={b}
            index={i}
            selected={selFig === b.id}
            onSelect={() => setSelFig(b.id)}
            onCommitAttrs={(attrs) => update(b.id, { attrs: serializeAttrs(attrs) }, { structural: true })}
            onLiveInner={(md) => setLiveText(b.id, md)}
            onCommitInner={(md) => update(b.id, { inner: md })}
            onUpload={() => { fileFor.current = b.id; fileInput.current?.click(); }}
            onGenerateImage={aiAvailable ? () => void generateImageFor(b.id) : undefined}
          />
        );
      case 'raw':
        return (
          <div
            key={b.id}
            data-block-index={i}
            title="This block contains MDX the visual editor keeps as-is (custom components, nested lists…). Move or delete it here; edit it in the source file."
            className="not-prose my-4"
            style={{
              border: '1px dashed var(--color-fd-border)', borderRadius: 12,
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

  /* ---------------- chrome overlay ---------------- */

  function openPaletteAtGap(index: number) {
    const rects = blockRects();
    setInsertAt({ index, y: gapAt(rects, index) });
    setGapHover(null);
    setHover(null);
  }

  const chrome = (
    <>
      {/* Hover rail. The wrapper spans the whole gutter (rail → text edge) so
          travelling from the block to the buttons never leaves the chrome. */}
      {hover && !drag && blocks[hover.index] && (
        <div
          data-dd-chrome
          style={{
            position: 'absolute', left: -44, width: 44, top: hover.top - 4,
            paddingTop: 6, paddingBottom: 12, display: 'flex',
            flexDirection: 'column', alignItems: 'flex-start', gap: 2, zIndex: 30,
          }}
        >
          <button className="dd-icon-btn" title="Drag to reorder" style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={(e) => startReorder(e, hover.index)}>
            <GripVertical size={13} />
          </button>
          <button className="dd-icon-btn" title="Insert below" onClick={(e) => { e.stopPropagation(); openPaletteAtGap(hover.index + 1); }}>
            <Plus size={13} />
          </button>
          <button className="dd-icon-btn" data-danger="1" title="Delete block" onClick={(e) => { e.stopPropagation(); deleteBlock(blocks[hover.index]!.id); }}>
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* Insert line between blocks */}
      {gapHover && !drag && !insertAt && (
        <div
          data-dd-chrome
          onClick={(e) => { e.stopPropagation(); openPaletteAtGap(gapHover.index); }}
          title="Insert a block"
          style={{
            position: 'absolute', left: 0, right: 0, top: gapHover.y - 10, height: 20,
            display: 'flex', alignItems: 'center', cursor: 'pointer', zIndex: 30,
          }}
        >
          <div style={{ flex: 1, height: 2, borderRadius: 1, background: 'color-mix(in srgb, var(--docsdev-accent, #c2571f) 45%, transparent)' }} />
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20,
              margin: '0 8px', borderRadius: 6, flex: 'none', border: '1px solid var(--color-fd-border)',
              background: 'var(--color-fd-popover)', color: ACCENT,
            }}
          >
            <Plus size={13} />
          </div>
          <div style={{ flex: 1, height: 2, borderRadius: 1, background: 'color-mix(in srgb, var(--docsdev-accent, #c2571f) 45%, transparent)' }} />
        </div>
      )}

      {/* Palette */}
      {insertAt && (
        <div
          className="dd-pop"
          data-dd-chrome
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: insertAt.y + 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
            padding: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, width: 320,
          }}
        >
          {[...PALETTE, ...(aiAvailable ? [{ type: 'ai', label: 'Generate with AI', icon: <Sparkles size={15} /> }] : [])].map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => {
                if (type === 'ai') {
                  setAiAt({ index: insertAt.index, y: insertAt.y });
                  setAiError('');
                  setInsertAt(null);
                  return;
                }
                insertBlock(type, insertAt.index);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: 'none',
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

      {/* "Generate with AI" popover */}
      {aiAt && (
        <div
          className="dd-pop"
          data-dd-chrome
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: aiAt.y + 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
            width: 380, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--color-fd-foreground)' }}>
            <Sparkles size={14} style={{ color: ACCENT }} /> Generate documentation here
          </div>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generateBlocks();
              if (e.key === 'Escape') setAiAt(null);
            }}
            autoFocus
            rows={3}
            placeholder="What should this section explain? e.g. “How to install and configure the CLI, with a quickstart example”"
            style={{
              resize: 'vertical', border: '1px solid var(--color-fd-border)', borderRadius: 8,
              background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 13,
              padding: '8px 10px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)', cursor: 'pointer', flex: 1 }}>
              <input type="checkbox" checked={aiSearch} onChange={(e) => setAiSearch(e.target.checked)} />
              Ground with web search
            </label>
            <button className="dd-chip-btn" style={{ height: 28 }} onClick={() => setAiAt(null)}>
              Cancel
            </button>
            <button
              onClick={() => void generateBlocks()}
              disabled={aiBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
                borderRadius: 8, border: 'none', background: ACCENT, color: '#fff',
                fontWeight: 600, fontSize: 12.5, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.7 : 1,
              }}
            >
              <Sparkles size={12} /> {aiBusy ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {aiError && <div style={{ fontSize: 12, color: 'var(--color-fd-error, #dc2626)' }}>{aiError}</div>}
        </div>
      )}

      {/* Drop indicator during reorder */}
      {drag && <div className="dd-drop-line" style={{ top: drag.y - 1 }} />}
    </>
  );

  /* ---------------- render ---------------- */

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-4"
      onMouseMove={onHoverMove}
      onMouseLeave={clearHover}
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
      {/* Ghost of the published page's copy-markdown row, so the content
          below starts at exactly the same y as the real page. */}
      <div className="flex flex-row gap-2 items-center border-b pb-6" aria-hidden style={{ pointerEvents: 'none' }}>
        <div style={{ height: 30, width: 132, borderRadius: 8, background: 'var(--color-fd-muted)', opacity: 0.5 }} />
        <div style={{ height: 30, width: 74, borderRadius: 8, background: 'var(--color-fd-muted)', opacity: 0.5 }} />
      </div>

      {/* Blocks are DIRECT children of the same .prose container the published
          page uses — sibling margins collapse identically. The editing chrome
          lives in the absolutely-positioned overlay below. */}
      <div ref={proseRef} className="prose flex-1" style={{ position: 'relative' }}>
        {/* The block factories close over latest-value refs (autosave buffer,
            snapshot) that are only ever read inside event handlers; the rule's
            interprocedural trace can't see that. React Compiler is not enabled. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {blocks.map((b, i) => renderBlock(b, i))}
        {chrome}
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
          {toast.undo && (
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
          )}
        </div>
      )}
    </div>
  );
}
