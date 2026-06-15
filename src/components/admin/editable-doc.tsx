'use client';

/**
 * EditableDoc — the unified in-place editor.
 *
 * Renders the page as an editable copy: every block (heading, rich-text prose,
 * code, callout, cards, spread) is edited directly where it lives, and the
 * whole thing serializes back to MDX through the verified block model. The
 * figure chip (Left/Right/Full/Inline + width% + Replace) lives on the figure
 * itself. This is the editing view; the published page renders via pretext.
 */

import { createElement, useMemo, useRef, useState, type CSSProperties } from 'react';
import { parseDoc, serializeDoc, type Block } from './mdx-blocks';
import { mdInlineToHtml, htmlToMdInline } from './inline-md';
import { parseAttrs, serializeAttrs, type SpreadAttrs } from '@/components/pretext/spread-tag';
import { DraftImage } from '@/components/draft-image';
import { putAsset } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const SIDES: Array<NonNullable<SpreadAttrs['side']>> = ['left', 'right', 'full', 'inline'];

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
  return fm.replace(/\n---\n?$/, `\n${key}: ${val}\n---\n`);
}

function figureStyle(side: string, widthPct: number, top = 6): CSSProperties {
  if (side === 'full') return { float: 'none', width: '100%', margin: '8px 0 20px', clear: 'both' };
  if (side === 'inline') return { float: 'none', width: widthPct + '%', margin: '10px auto 20px', display: 'block' };
  if (side === 'left') return { float: 'left', width: widthPct + '%', margin: `${top}px 24px 12px 0` };
  return { float: 'right', width: widthPct + '%', margin: `${top}px 0 12px 24px` };
}

export function EditableDoc({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const initial = useMemo(() => parseDoc(source), [source.length === 0]); // seed once
  const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const [selFig, setSelFig] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const PALETTE: Array<[string, string]> = [
    ['prose', 'Paragraph'],
    ['heading', 'Heading'],
    ['callout', 'Callout'],
    ['code', 'Code block'],
    ['cards', 'Cards'],
    ['spread', 'Spread (image)'],
  ];

  const [insertAt, setInsertAt] = useState<number | null>(null);

  const emit = (b: Block[] = blocks, fm: string = frontmatter) => onChange(serializeDoc({ frontmatter: fm, blocks: b }));
  const update = (id: string, patch: Partial<Block>) => {
    const next = blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b));
    setBlocks(next);
    emit(next);
  };
  const commitBlocks = (next: Block[]) => {
    setBlocks(next);
    emit(next);
  };
  const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function newBlock(type: string): Block {
    const id = newId();
    switch (type) {
      case 'heading': return { id, type: 'heading', depth: 2, text: 'New section' };
      case 'callout': return { id, type: 'callout', props: 'type="info"', text: 'Note worth pulling out of the flow.' };
      case 'code': return { id, type: 'code', lang: 'ts', meta: '', code: 'const x = 1;' };
      case 'cards': return { id, type: 'cards', raw: '<Cards>\n  <Card title="Title" href="/" />\n</Cards>' };
      case 'spread': return { id, type: 'spread', attrs: 'orb side="right" width="42%"', inner: 'Describe this image — the prose here flows around the figure beside it.' };
      default: return { id, type: 'prose', text: 'New paragraph. Click to edit.' };
    }
  }
  function insertBlock(type: string, index: number) {
    const next = blocks.slice();
    next.splice(index, 0, newBlock(type));
    setInsertAt(null);
    commitBlocks(next);
  }
  function deleteBlock(id: string) {
    commitBlocks(blocks.filter((b) => b.id !== id));
  }
  function moveBlock(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[index], next[j]] = [next[j]!, next[index]!];
    commitBlocks(next);
  }
  function reorderTo(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const next = blocks.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m!);
    commitBlocks(next);
  }
  const setMeta = (key: string, val: string) => {
    const fm = setMetaLine(frontmatter, key, val);
    setFrontmatter(fm);
    emit(blocks, fm);
  };

  function readDataUrl(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }
  async function onFile(file: File) {
    const id = fileFor.current;
    if (!id || !file.type.startsWith('image/')) return;
    const dataUrl = await readDataUrl(file);
    const path = `/uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    await putAsset({ path, contentType: file.type, dataUrl });
    const b = blocks.find((x) => x.id === id);
    if (b && b.type === 'spread') {
      const a = parseAttrs(b.attrs);
      update(id, { attrs: serializeAttrs({ ...a, orb: undefined, image: path, alt: file.name }) });
    }
  }

  // Render an editable element using a real tag (p/h2/…) so it inherits the
  // page's .prose typography. Edits round-trip through inline markdown.
  const edit = (tag: string, key: string, html: string, onBlurMd: (md: string) => void, style?: CSSProperties) =>
    createElement(tag, {
      key,
      contentEditable: true,
      suppressContentEditableWarning: true,
      spellCheck: false,
      style: { outline: 'none', ...style },
      onBlur: (e: React.FocusEvent<HTMLElement>) => onBlurMd(htmlToMdInline(e.currentTarget)),
      dangerouslySetInnerHTML: { __html: html },
    });

  function renderSpread(b: Extract<Block, { type: 'spread' }>) {
    const a = parseAttrs(b.attrs);
    const side = a.side ?? 'right';
    const widthPct = a.width ?? 42;
    const top = a.top ?? 6;
    const selected = selFig === b.id;
    const setAttr = (patch: Partial<SpreadAttrs>) => update(b.id, { attrs: serializeAttrs({ ...a, ...patch }) });
    const setAttrLocal = (patch: Partial<SpreadAttrs>) =>
      setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, attrs: serializeAttrs({ ...a, ...patch }) } : x)));

    // Drag the figure to switch side; drag the corner to resize (width %).
    function startDrag(e: React.PointerEvent) {
      if ((e.target as HTMLElement).dataset?.resize) return startResize(e);
      e.preventDefault();
      e.stopPropagation();
      setSelFig(b.id);
      let curSide = side;
      let curTop = top;
      const startY = e.clientY;
      const move = (ev: PointerEvent) => {
        const article = (document.querySelector('article') ?? document.body) as HTMLElement;
        const rect = article.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        curSide = ev.clientX < mid - 40 ? 'left' : ev.clientX > mid + 40 ? 'right' : curSide;
        curTop = Math.max(0, Math.min(500, top + (ev.clientY - startY)));
        setAttrLocal({ side: curSide, top: Math.round(curTop) });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setAttr({ side: curSide, top: Math.round(curTop) });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    function startResize(e: React.PointerEvent | PointerEvent) {
      e.preventDefault();
      (e as Event).stopPropagation();
      setSelFig(b.id);
      const article = (document.querySelector('article') ?? document.body) as HTMLElement;
      const colW = article.getBoundingClientRect().width || 720;
      const startX = (e as PointerEvent).clientX;
      let w = widthPct;
      const move = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / colW) * 100;
        w = Math.max(26, Math.min(70, side === 'left' ? widthPct + dxPct : widthPct - dxPct));
        setAttrLocal({ width: Math.round(w) });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setAttr({ width: Math.round(w) });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    const visual = a.orb ? (
      // Match the published page exactly: the orb is a circle, not a rounded box.
      <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '50%', background: 'radial-gradient(125% 125% at 30% 24%, #f6b079 0%, #e07a2c 38%, #c2571f 64%, #8f3d12 100%)', boxShadow: '0 12px 34px rgba(170,75,22,0.30), inset 0 1px 0 rgba(255,255,255,0.45)' }} />
    ) : a.image ? (
      <DraftImage src={a.image} alt={a.alt ?? ''} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12, display: 'block' }} />
    ) : (
      <div style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 12, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 13 }}>Click Upload to add an image</div>
    );
    return (
      <div style={{ display: 'flow-root', margin: '0 0 22px' }}>
        <div
          onClick={(e) => { e.stopPropagation(); setSelFig(b.id); }}
          onPointerDown={startDrag}
          style={{ position: 'relative', cursor: 'grab', touchAction: 'none', ...figureStyle(side, widthPct, top), ...(selected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 3, borderRadius: a.orb ? '50%' : 14 } : null) }}
        >
          {visual}
          {selected && (side === 'left' || side === 'right' || side === 'inline') && (
            <div
              data-resize="1"
              onPointerDown={startResize}
              style={{ position: 'absolute', bottom: -8, ...(side === 'left' ? { right: -8 } : { left: -8 }), width: 16, height: 16, background: '#fff', border: `2px solid ${ACCENT}`, borderRadius: 4, cursor: 'nwse-resize', zIndex: 9 }}
            />
          )}
          {selected && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: -44, left: 0, display: 'flex', gap: 8, background: '#fff', border: '1px solid #EAE4DA', borderRadius: 10, boxShadow: '0 8px 24px rgba(28,26,22,0.16)', padding: '5px 7px', whiteSpace: 'nowrap', zIndex: 8 }}>
              <div style={{ display: 'flex', gap: 1, background: '#F2EEE6', borderRadius: 7, padding: 2 }}>
                {SIDES.map((s) => (
                  <button key={s} onClick={() => setAttr({ side: s })} style={{ height: 24, padding: '0 8px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: side === s ? 600 : 500, background: side === s ? '#1c1a16' : 'transparent', color: side === s ? '#fff' : '#7a766c' }}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {(side === 'left' || side === 'right' || side === 'inline') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderLeft: '1px solid #EAE4DA', paddingLeft: 8 }}>
                  <button onClick={() => setAttr({ width: Math.max(26, widthPct - 4) })} style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>–</button>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, minWidth: 34, textAlign: 'center' }}>{widthPct}%</span>
                  <button onClick={() => setAttr({ width: Math.min(70, widthPct + 4) })} style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>+</button>
                </div>
              )}
              <button onClick={() => { fileFor.current = b.id; fileInput.current?.click(); }} style={{ height: 24, padding: '0 9px', border: 'none', borderLeft: '1px solid #EAE4DA', background: 'transparent', cursor: 'pointer', color: '#57534a', fontSize: 12, fontWeight: 500 }}>
                📎 {a.image ? 'Replace' : 'Upload'}
              </button>
            </div>
          )}
        </div>
        {edit('p', b.id + 'inner', mdInlineToHtml(b.inner), (md) => update(b.id, { inner: md }))}
      </div>
    );
  }

  function renderBlock(b: Block) {
    switch (b.type) {
      case 'heading':
        return edit(`h${Math.min(6, Math.max(1, b.depth))}`, b.id, b.text, (md) => update(b.id, { text: md }));
      case 'prose':
        return edit('p', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }));
      case 'code':
        return (
          <div key={b.id} style={{ margin: '4px 0 22px', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2722', background: '#1c1a16' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #322e28', fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a8478' }}>{b.lang || 'code'}</div>
            <pre contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => update(b.id, { code: e.currentTarget.textContent ?? '' })}
              style={{ margin: 0, padding: '14px 16px', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.65, color: '#e8e2d6', whiteSpace: 'pre', overflowX: 'auto', outline: 'none' }}>
              {b.code}
            </pre>
          </div>
        );
      case 'callout':
        return (
          <div key={b.id} style={{ display: 'flex', gap: 12, background: '#FBF2EA', border: '1px solid #F1DAC6', borderRadius: 11, padding: '15px 16px', margin: '16px 0' }}>
            <div style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginTop: 2 }}>i</div>
            {edit('div', b.id, mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), { flex: 1, fontSize: 15, color: '#6b4a2e' })}
          </div>
        );
      case 'cards': {
        const items = parseCards(b.raw);
        const setItems = (next: CardItem[]) => update(b.id, { raw: serializeCards(next) });
        return (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0' }}>
            {items.map((it, i) => (
              <div key={i} style={{ position: 'relative', border: '1px solid #EAE4DA', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
                <button onClick={() => setItems(items.filter((_, j) => j !== i))} title="Remove card" style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, border: 'none', background: 'transparent', color: '#b6b1a6', cursor: 'pointer', fontSize: 12 }}>✕</button>
                {edit('div', b.id + 't' + i, mdInlineToHtml(it.title), (md) => setItems(items.map((x, j) => (j === i ? { ...x, title: md } : x))), { fontWeight: 600, fontSize: 15, color: '#1c1a16' })}
                {edit('div', b.id + 'h' + i, mdInlineToHtml(it.href), (md) => setItems(items.map((x, j) => (j === i ? { ...x, href: md } : x))), { fontSize: 12.5, color: '#8a857a', marginTop: 2 })}
              </div>
            ))}
            <button onClick={() => setItems([...items, { title: 'New card', href: '/' }])} style={{ border: '1px dashed #E2DCD0', borderRadius: 12, padding: '14px 16px', background: 'transparent', color: ACCENT, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              + Card
            </button>
          </div>
        );
      }
      case 'spread':
        return <div key={b.id}>{renderSpread(b)}</div>;
    }
  }

  return (
    <div onClick={() => setSelFig(null)}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      <div contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => setMeta('title', e.currentTarget.textContent ?? '')}
        style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 700, fontSize: 40, lineHeight: 1.08, letterSpacing: '-0.025em', color: '#1c1a16', margin: '0 0 12px', outline: 'none' }}>
        {metaLine(frontmatter, 'title')}
      </div>
      <div contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => setMeta('description', e.currentTarget.textContent ?? '')}
        style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 17, color: '#8a857a', margin: '0 0 12px', outline: 'none' }}>
        {metaLine(frontmatter, 'description')}
      </div>
      <div style={{ height: 1, background: '#EAE4DA', margin: '18px 0 26px' }} />

      <div className="prose" style={{ maxWidth: 'none' }}>
        {insertRow(0)}
        {blocks.map((b, i) => (
          <div key={b.id}>
            <div
              onMouseEnter={() => setHoverId(b.id)}
              onMouseLeave={() => setHoverId((h) => (h === b.id ? null : h))}
              onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) reorderTo(dragIndex, i); setDragIndex(null); }}
              style={{ position: 'relative', outline: dragIndex !== null && hoverId === b.id ? `2px dashed ${ACCENT}` : 'none', outlineOffset: 4 }}
            >
              {hoverId === b.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  // Span all the way to the block's left edge (no gap) so moving
                  // the cursor onto the controls doesn't trigger mouseleave.
                  style={{ position: 'absolute', left: -38, top: 0, width: 38, paddingRight: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, zIndex: 9 }}
                >
                  <button
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => setDragIndex(null)}
                    title="Drag to reorder"
                    style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'grab', fontSize: 12, color: '#57534a', lineHeight: 1 }}
                  >
                    ⠿
                  </button>
                  <button onClick={() => moveBlock(i, -1)} title="Move up" style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#57534a' }}>↑</button>
                  <button onClick={() => moveBlock(i, 1)} title="Move down" style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#57534a' }}>↓</button>
                  <button onClick={() => deleteBlock(b.id)} title="Delete" style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#c0392b' }}>✕</button>
                </div>
              )}
              {renderBlock(b)}
            </div>
            {insertRow(i + 1)}
          </div>
        ))}
      </div>
    </div>
  );

  function insertRow(index: number) {
    const open = insertAt === index;
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', height: open ? 'auto' : 24, minHeight: 24, margin: open ? '6px 0' : 0 }}>
        <button
          onClick={() => setInsertAt(open ? null : index)}
          title="Insert a block"
          style={{ position: 'relative', zIndex: 7, width: 22, height: 22, borderRadius: 7, border: '1px solid #E2DCD0', background: '#fff', color: ACCENT, cursor: 'pointer', fontSize: 15, lineHeight: 1, transform: open ? 'rotate(45deg)' : 'none', boxShadow: '0 1px 2px rgba(28,26,22,0.06)' }}
        >
          +
        </button>
        {open && (
          <div style={{ position: 'absolute', top: 32, zIndex: 20, background: '#fff', border: '1px solid #EAE4DA', borderRadius: 12, boxShadow: '0 16px 40px rgba(28,26,22,0.18)', padding: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, width: 280 }}>
            {PALETTE.map(([type, label]) => (
              <button key={type} onClick={() => insertBlock(type, index)} style={{ padding: '9px 10px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontSize: 13.5, fontWeight: 500, color: '#2a2722' }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}
