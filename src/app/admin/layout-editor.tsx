'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RichFlow, type FlowObstacle } from '@/components/pretext/rich-flow';
import type { Run } from '@/components/pretext/extract-runs';
import { DraftImage } from '@/components/draft-image';
import { putAsset } from '@/lib/drafts';
import {
  findSpread,
  writeSpreadAttrs,
  type SpreadAttrs,
} from '@/components/pretext/spread-tag';

/**
 * Drag-to-arrange layout editor — the docs.dev answer to the pretext
 * playground. Renders the page's <Spread> block live; drag the figure to move
 * it, drag its corner to resize, and the prose reflows instantly. On drop, the
 * new geometry is written back into the <Spread> tag in the MDX source.
 */

type Drag =
  | { mode: 'move'; px: number; py: number; x: number; top: number }
  | { mode: 'resize'; px: number; py: number; w: number; h: number }
  | null;

function Orb() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #ffb27a 0%, #e8753b 35%, #7a2d12 100%)',
        boxShadow: '0 0 60px 12px rgba(232,117,59,0.40), inset -16px -20px 50px rgba(0,0,0,0.45)',
      }}
    />
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

export function LayoutEditor({
  content,
  onApply,
}: {
  content: string;
  onApply: (next: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const match = useMemo(() => findSpread(content), [content]);

  // Geometry the editor manipulates. Seeded from the tag; x defaults from side.
  const [geo, setGeo] = useState<Required<Pick<SpreadAttrs, 'x' | 'top' | 'width' | 'height'>>>({
    x: 0,
    top: 6,
    width: 220,
    height: 220,
  });
  const dragRef = useRef<Drag>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `geo` that's always current, so drag-end (a stale closure over
  // state) commits the dragged geometry rather than the value at drag-start.
  const geoRef = useRef(geo);
  const setGeoSynced = (updater: (g: typeof geo) => typeof geo) => {
    setGeo((g) => {
      const next = updater(g);
      geoRef.current = next;
      return next;
    });
  };
  // Stop re-seeding from the tag once the user starts arranging.
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

  // Seed geometry from the parsed tag. Re-runs as the measured width settles,
  // until the user drags — so `x` derived from `side="right"` is correct.
  useEffect(() => {
    if (userTouched.current || !match) return;
    const a = match.attrs;
    const w = a.width ?? 220;
    const h = a.height ?? 220;
    const x = a.x ?? (a.side === 'left' ? 0 : Math.max(0, width - w));
    const next = { x, top: a.top ?? 6, width: w, height: h };
    geoRef.current = next;
    setGeo(next);
  }, [match, width]);

  if (!match) {
    return (
      <p style={{ color: '#888', fontSize: 14 }}>
        No <code>&lt;Spread&gt;</code> block on this page yet. Add one in the editor to arrange it
        visually.
      </p>
    );
  }

  const sm = match;
  const isCircle = sm.attrs.orb === true;
  const runs = toPlainRuns(sm.inner);
  const figure: FlowObstacle = {
    id: 'editor-figure',
    side: 'right',
    shape: isCircle ? 'circle' : 'rect',
    x: geo.x,
    top: geo.top,
    width: geo.width,
    height: geo.height,
    gap: sm.attrs.gap ?? 28,
    node: isCircle ? (
      <Orb />
    ) : sm.attrs.image ? (
      <DraftImage
        src={sm.attrs.image}
        alt={sm.attrs.alt ?? ''}
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
      />
    ) : (
      <div style={{ width: '100%', height: '100%', borderRadius: 12, background: '#0d1117' }} />
    ),
  };

  function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // Upload an image and make it the Spread's figure (replacing the orb), keeping
  // the current position/size so it's immediately draggable.
  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) return;
    const dataUrl = await readDataUrl(file);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `/uploads/${Date.now()}-${safe}`;
    await putAsset({ path, contentType: file.type, dataUrl });
    userTouched.current = true;
    const g = geoRef.current;
    onApply(
      writeSpreadAttrs(content, {
        ...sm.attrs,
        orb: undefined,
        image: path,
        alt: file.name,
        side: g.x + g.width / 2 < width / 2 ? 'left' : 'right',
        x: g.x,
        top: g.top,
        width: g.width,
        height: g.height,
      }),
    );
  }

  function onPointerMove(e: PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setGeoSynced((g) => {
      if (d.mode === 'move') {
        return {
          ...g,
          x: clamp(d.x + (e.clientX - d.px), 0, Math.max(0, width - g.width)),
          top: Math.max(0, d.top + (e.clientY - d.py)),
        };
      }
      const w = clamp(d.w + (e.clientX - d.px), 80, width);
      const h = clamp(d.h + (e.clientY - d.py), 80, 800);
      return { ...g, width: w, height: h, x: Math.min(g.x, Math.max(0, width - w)) };
    });
  }

  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    // Commit the *current* geometry (via the ref) back into the MDX source.
    const g = geoRef.current;
    const side = g.x + g.width / 2 < width / 2 ? 'left' : 'right';
    onApply(
      writeSpreadAttrs(content, {
        ...sm.attrs,
        side,
        x: g.x,
        top: g.top,
        width: g.width,
        height: g.height,
      }),
    );
  }

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    userTouched.current = true;
    dragRef.current = { mode: 'move', px: e.clientX, py: e.clientY, x: geo.x, top: geo.top };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    userTouched.current = true;
    dragRef.current = { mode: 'resize', px: e.clientX, py: e.clientY, w: geo.width, h: geo.height };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <p style={{ fontSize: 13, color: '#888', margin: 0, flex: 1 }}>
          Drag the figure to move it · drag the corner to resize · text reflows live. Release to
          write the position back into the source.
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #ccc', background: 'transparent', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          📎 {sm.attrs.image ? 'Replace image' : 'Upload image'}
        </button>
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
      </div>
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          border: '1px dashed #ccc',
          borderRadius: 12,
          padding: 20,
          background: 'var(--pretext-preview-bg, #fafafa)',
        }}
      >
        <RichFlow runs={runs} obstacles={[figure]} fallback={null} />

        {/* Interactive overlay sitting exactly over the engine-positioned figure. */}
        <div
          onPointerDown={startMove}
          style={{
            position: 'absolute',
            left: 20 + geo.x,
            top: 20 + geo.top,
            width: geo.width,
            height: geo.height,
            cursor: 'grab',
            borderRadius: isCircle ? '50%' : 12,
            outline: '2px solid rgba(232,117,59,0.7)',
            outlineOffset: 2,
          }}
        >
          <div
            onPointerDown={startResize}
            style={{
              position: 'absolute',
              right: -7,
              bottom: -7,
              width: 14,
              height: 14,
              borderRadius: 3,
              background: '#e8753b',
              cursor: 'nwse-resize',
            }}
          />
        </div>
      </div>
    </div>
  );
}
