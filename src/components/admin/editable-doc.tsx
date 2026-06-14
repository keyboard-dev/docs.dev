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

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { parseDoc, serializeDoc, type Block } from './mdx-blocks';
import { mdInlineToHtml, htmlToMdInline } from './inline-md';
import { parseAttrs, serializeAttrs, type SpreadAttrs } from '@/components/pretext/spread-tag';
import { DraftImage } from '@/components/draft-image';
import { putAsset } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const SIDES: Array<NonNullable<SpreadAttrs['side']>> = ['left', 'right', 'full', 'inline'];

function metaLine(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1]!.replace(/^["']|["']$/g, '') : '';
}
function setMetaLine(fm: string, key: string, val: string): string {
  if (new RegExp(`^${key}:`, 'm').test(fm)) return fm.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${val}`);
  return fm.replace(/\n---\n?$/, `\n${key}: ${val}\n---\n`);
}

function figureStyle(side: string, widthPct: number): CSSProperties {
  if (side === 'full') return { float: 'none', width: '100%', margin: '8px 0 20px', clear: 'both' };
  if (side === 'inline') return { float: 'none', width: widthPct + '%', margin: '10px auto 20px', display: 'block' };
  if (side === 'left') return { float: 'left', width: widthPct + '%', margin: '6px 24px 12px 0' };
  return { float: 'right', width: widthPct + '%', margin: '6px 0 12px 24px' };
}

export function EditableDoc({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const initial = useMemo(() => parseDoc(source), [source.length === 0]); // seed once
  const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const [selFig, setSelFig] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
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

  const proseStyle: CSSProperties = { fontFamily: 'Georgia, serif', fontSize: 18, lineHeight: 1.72, color: '#2a2722', outline: 'none' };
  const editable = (html: string, onBlurMd: (md: string) => void, style: CSSProperties) => (
    <div
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, outline: 'none' }}
      onBlur={(e) => onBlurMd(htmlToMdInline(e.currentTarget))}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  function renderSpread(b: Extract<Block, { type: 'spread' }>) {
    const a = parseAttrs(b.attrs);
    const side = a.side ?? 'right';
    const widthPct = a.width ?? 42;
    const selected = selFig === b.id;
    const setAttr = (patch: Partial<SpreadAttrs>) => update(b.id, { attrs: serializeAttrs({ ...a, ...patch }) });
    const visual = a.orb ? (
      <div style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 12, background: 'radial-gradient(125% 125% at 30% 24%, #f6b079 0%, #e07a2c 38%, #c2571f 64%, #8f3d12 100%)', boxShadow: '0 12px 34px rgba(170,75,22,0.3)' }} />
    ) : a.image ? (
      <DraftImage src={a.image} alt={a.alt ?? ''} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12, display: 'block' }} />
    ) : (
      <div style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 12, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 13 }}>Click Upload to add an image</div>
    );
    return (
      <div style={{ display: 'flow-root', margin: '0 0 22px' }}>
        <div
          onClick={(e) => { e.stopPropagation(); setSelFig(b.id); }}
          style={{ position: 'relative', cursor: 'pointer', ...figureStyle(side, widthPct), ...(selected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 3, borderRadius: 14 } : null) }}
        >
          {visual}
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
        {editable(mdInlineToHtml(b.inner), (md) => update(b.id, { inner: md }), proseStyle)}
      </div>
    );
  }

  function renderBlock(b: Block) {
    switch (b.type) {
      case 'heading':
        return (
          <div key={b.id} contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => update(b.id, { text: e.currentTarget.textContent ?? '' })}
            style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 600, fontSize: b.depth <= 2 ? 25 : 20, letterSpacing: '-0.02em', color: '#1c1a16', margin: '30px 0 14px', outline: 'none' }}>
            {b.text}
          </div>
        );
      case 'prose':
        return <div key={b.id} style={{ margin: '0 0 16px' }}>{editable(mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), proseStyle)}</div>;
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
          <div key={b.id} style={{ display: 'flex', gap: 12, background: '#FBF2EA', border: '1px solid #F1DAC6', borderRadius: 11, padding: '15px 16px', margin: '4px 0 22px' }}>
            <div style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginTop: 2 }}>i</div>
            {editable(mdInlineToHtml(b.text), (md) => update(b.id, { text: md }), { flex: 1, fontFamily: 'Georgia, serif', fontSize: 15.5, color: '#6b4a2e', outline: 'none' })}
          </div>
        );
      case 'cards':
        return (
          <pre key={b.id} contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => update(b.id, { raw: e.currentTarget.textContent ?? '' })}
            style={{ margin: '4px 0 22px', padding: 14, borderRadius: 10, border: '1px dashed #E2DCD0', background: '#FAF8F4', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, color: '#57534a', whiteSpace: 'pre-wrap', outline: 'none' }}>
            {b.raw}
          </pre>
        );
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

      {insertRow(0)}
      {blocks.map((b, i) => (
        <div key={b.id}>
          <div
            onMouseEnter={() => setHoverId(b.id)}
            onMouseLeave={() => setHoverId((h) => (h === b.id ? null : h))}
            style={{ position: 'relative' }}
          >
            {hoverId === b.id && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: -10, top: 0, display: 'flex', gap: 3, zIndex: 9 }}>
                {[['↑', () => moveBlock(i, -1)], ['↓', () => moveBlock(i, 1)], ['✕', () => deleteBlock(b.id)]].map(([label, fn], k) => (
                  <button key={k} onClick={fn as () => void} style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: label === '✕' ? '#c0392b' : '#57534a' }}>
                    {label as string}
                  </button>
                ))}
              </div>
            )}
            {renderBlock(b)}
          </div>
          {insertRow(i + 1)}
        </div>
      ))}
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
