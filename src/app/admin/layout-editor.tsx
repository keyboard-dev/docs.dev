'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RichFlow, type FlowObstacle } from '@/components/pretext/rich-flow';
import type { Run } from '@/components/pretext/extract-runs';
import { DraftImage } from '@/components/draft-image';
import { putAsset } from '@/lib/drafts';
import { findSpread, writeSpreadAttrs, type SpreadAttrs } from '@/components/pretext/spread-tag';

/**
 * Drag-to-arrange layout editor for a <Spread>. Pretext does the actual text
 * flow; this just edits the *relative* position model the design specified —
 * a side (Left / Right / Inline / Full), a width as a % of the column, and a
 * vertical anchor — so what you arrange matches the published page at any width.
 */

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const SIDES: Array<SpreadAttrs['side']> = ['left', 'right', 'full', 'inline'];

type Geo = { side: NonNullable<SpreadAttrs['side']>; widthPct: number; top: number };
type Drag = { mode: 'move' | 'resize'; px: number; py: number; geo: Geo } | null;

function Orb() {
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'radial-gradient(125% 125% at 30% 24%, #f6b079 0%, #e07a2c 38%, #c2571f 64%, #8f3d12 100%)', boxShadow: '0 12px 34px rgba(170,75,22,0.30)' }} />
  );
}

function toPlainRuns(markdown: string): Run[] {
  const text = markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? [{ text, kind: 'text' }] : [];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Mirror RichFlow's geometry so the overlay sits exactly over the figure.
function figGeo(W: number, side: Geo['side'], widthPct: number, top: number, aspect: number) {
  const narrow = W <= 560;
  const full = narrow || side === 'full';
  const w = full ? W : Math.round((widthPct / 100) * W);
  const h = Math.round(w / aspect);
  const x = full ? 0 : side === 'left' ? 0 : side === 'inline' ? Math.round((W - w) / 2) : W - w;
  const y = narrow ? 0 : top;
  return { x, y, w, h, full };
}

export function LayoutEditor({ content, onApply }: { content: string; onApply: (next: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const match = useMemo(() => findSpread(content), [content]);
  const [geo, setGeo] = useState<Geo>({ side: 'right', widthPct: 42, top: 6 });
  const geoRef = useRef(geo);
  const setGeoSynced = (next: Geo) => {
    geoRef.current = next;
    setGeo(next);
  };
  const dragRef = useRef<Drag>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userTouched = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seed from the tag (until the user starts arranging).
  useEffect(() => {
    if (userTouched.current || !match) return;
    const a = match.attrs;
    const next: Geo = { side: a.side ?? 'right', widthPct: a.width ?? 42, top: a.top ?? 6 };
    geoRef.current = next;
    setGeo(next);
  }, [match]);

  if (!match) {
    return (
      <p style={{ color: '#888', fontSize: 14 }}>
        No <code>&lt;Spread&gt;</code> block on this page yet. Add one to arrange it visually.
      </p>
    );
  }

  const sm = match;
  const isCircle = sm.attrs.orb === true;
  const aspect = isCircle ? 1 : 4 / 3;
  const runs = toPlainRuns(sm.inner);
  const node = isCircle ? (
    <Orb />
  ) : sm.attrs.image ? (
    <DraftImage src={sm.attrs.image} alt={sm.attrs.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
  ) : (
    <div style={{ width: '100%', height: '100%', borderRadius: 12, background: '#0d1117' }} />
  );

  const figure: FlowObstacle = {
    id: 'editor-figure',
    side: geo.side,
    shape: isCircle ? 'circle' : 'rect',
    widthPct: geo.widthPct,
    aspect,
    anchorTop: geo.top,
    gap: sm.attrs.gap ?? 28,
    node,
  };

  function commit(next: Geo, extra?: Partial<SpreadAttrs>) {
    onApply(writeSpreadAttrs(content, { ...sm.attrs, side: next.side, width: next.widthPct, top: next.top, ...extra }));
  }

  function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) return;
    const dataUrl = await readDataUrl(file);
    const path = `/uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    await putAsset({ path, contentType: file.type, dataUrl });
    userTouched.current = true;
    commit(geoRef.current, { orb: undefined, image: path, alt: file.name });
  }

  function onPointerMove(e: PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (d.mode === 'move') {
      const mid = rect.left + rect.width / 2;
      const side: Geo['side'] = e.clientX < mid - 60 ? 'left' : e.clientX > mid + 60 ? 'right' : d.geo.side;
      const top = clamp(d.geo.top + (e.clientY - d.py), 0, 440);
      setGeoSynced({ ...d.geo, side, top: Math.round(top) });
    } else {
      const colW = width;
      const dxPct = ((e.clientX - d.px) / colW) * 100;
      const w = clamp(d.geo.side === 'left' ? d.geo.widthPct + dxPct : d.geo.widthPct - dxPct, 26, 70);
      setGeoSynced({ ...d.geo, widthPct: Math.round(w) });
    }
  }
  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    commit(geoRef.current);
  }
  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    userTouched.current = true;
    dragRef.current = { mode: 'move', px: e.clientX, py: e.clientY, geo: geoRef.current };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    userTouched.current = true;
    dragRef.current = { mode: 'resize', px: e.clientX, py: e.clientY, geo: geoRef.current };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }

  function setSide(side: Geo['side']) {
    userTouched.current = true;
    const next = { ...geoRef.current, side };
    setGeoSynced(next);
    commit(next);
  }
  function stepWidth(delta: number) {
    userTouched.current = true;
    const next = { ...geoRef.current, widthPct: clamp(geoRef.current.widthPct + delta, 26, 70) };
    setGeoSynced(next);
    commit(next);
  }

  const fg = figGeo(width, geo.side, geo.widthPct, geo.top, aspect);
  const showHandle = !fg.full;
  const isFloat = geo.side === 'left' || geo.side === 'right' || geo.side === 'inline';

  const segBtn = (label: string, val: Geo['side']): React.CSSProperties => ({
    height: 24, padding: '0 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 12, fontWeight: geo.side === val ? 600 : 500,
    background: geo.side === val ? '#1c1a16' : 'transparent', color: geo.side === val ? '#fff' : '#7a766c',
  });

  return (
    <div>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 10px' }}>
        Click the figure for presets · drag to move · drag the corner to resize. Position is stored
        as side + width %, so it matches the published page and reflows on mobile.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUpload(f);
          e.target.value = '';
        }}
      />
      <div ref={wrapRef} style={{ position: 'relative', border: '1px dashed #ccc', borderRadius: 12, padding: 0, overflow: 'hidden' }}>
        <RichFlow runs={runs} obstacles={[figure]} fallback={null} />

        {/* Selection ring + handle over the figure */}
        <div
          onPointerDown={startMove}
          style={{ position: 'absolute', left: fg.x, top: fg.y, width: fg.w, height: fg.h, cursor: 'grab', borderRadius: isCircle ? '50%' : 12, outline: `2px solid ${ACCENT}`, outlineOffset: 2 }}
        >
          {showHandle && (
            <div
              onPointerDown={startResize}
              style={{ position: 'absolute', bottom: -7, ...(geo.side === 'left' ? { right: -7 } : { left: -7 }), width: 15, height: 15, background: '#fff', border: `2px solid ${ACCENT}`, borderRadius: 4, cursor: 'nwse-resize' }}
            />
          )}
        </div>

        {/* Floating chip: Left / Right / Full / Inline + width % + Replace */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: Math.max(2, fg.y - 44), left: clamp(fg.x, 6, Math.max(6, width - 360)), display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #EAE4DA', borderRadius: 10, boxShadow: '0 8px 24px rgba(28,26,22,0.16)', padding: '5px 7px', whiteSpace: 'nowrap', zIndex: 8 }}
        >
          <div style={{ display: 'flex', gap: 1, background: '#F2EEE6', borderRadius: 7, padding: 2 }}>
            {SIDES.map((s) => (
              <button key={s} onClick={() => setSide(s!)} style={segBtn(s === 'full' ? 'Full' : s === 'inline' ? 'Inline' : s === 'left' ? 'Left' : 'Right', s!)}>
                {s === 'full' ? 'Full' : s === 'inline' ? 'Inline' : s === 'left' ? 'Left' : 'Right'}
              </button>
            ))}
          </div>
          {isFloat && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderLeft: '1px solid #EAE4DA', paddingLeft: 8 }}>
              <button onClick={() => stepWidth(-4)} style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#57534a' }}>–</button>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#1c1a16', minWidth: 34, textAlign: 'center' }}>{geo.widthPct}%</span>
              <button onClick={() => stepWidth(4)} style={{ width: 22, height: 22, border: '1px solid #E2DCD0', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#57534a' }}>+</button>
            </div>
          )}
          <button onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', border: 'none', borderLeft: '1px solid #EAE4DA', background: 'transparent', cursor: 'pointer', color: '#57534a', fontSize: 12, fontWeight: 500 }}>
            📎 {sm.attrs.image ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
