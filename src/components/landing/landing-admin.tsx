'use client';

/**
 * On-page editor for the landing ("layout") page. Renders nothing unless the
 * visitor is an admin. "Edit layout" opens a side panel whose fields update
 * the live page as you type — including the pretext Flow demos, which reflow
 * in real time. Edits persist per-browser (localStorage) until published;
 * Publish commits content/landing.json via /api/admin/layout, and
 * push-to-deploy CI rebuilds the site with the new copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { PencilRuler, Plus, Trash2, X } from 'lucide-react';
import { sanitizeLandingCopy, type LandingCopy, type LandingCta } from '@/lib/landing';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const DRAFT_KEY = 'docsdev-landing-draft';

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--color-fd-border)', borderRadius: 8,
  background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 13,
  padding: '6px 9px', outline: 'none', fontFamily: 'inherit',
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)', margin: '2px 0' }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-fd-foreground)', borderBottom: '1px solid var(--color-fd-border)', paddingBottom: 6, marginTop: 10 }}>
      {children}
    </div>
  );
}

function Text({ value, onChange, mono, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      style={{ ...inputStyle, ...(mono ? { fontFamily: 'var(--font-meta, ui-monospace, monospace)', fontSize: 12 } : {}) }}
    />
  );
}

function Area({ value, onChange, rows = 4, mono }: { value: string; onChange: (v: string) => void; rows?: number; mono?: boolean }) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.45, ...(mono ? { fontFamily: 'var(--font-meta, ui-monospace, monospace)', fontSize: 12 } : {}) }}
    />
  );
}

function CtaRows({ ctas, onChange }: { ctas: LandingCta[]; onChange: (next: LandingCta[]) => void }) {
  const set = (i: number, patch: Partial<LandingCta>) => onChange(ctas.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ctas.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input value={c.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" spellCheck={false} style={{ ...inputStyle, flex: 2 }} />
          <input value={c.href} onChange={(e) => set(i, { href: e.target.value })} placeholder="/docs or https://…" spellCheck={false} style={{ ...inputStyle, flex: 3, fontFamily: 'var(--font-meta, ui-monospace, monospace)', fontSize: 11.5 }} />
          <select
            value={c.style}
            onChange={(e) => set(i, { style: e.target.value as LandingCta['style'] })}
            style={{ ...inputStyle, width: 82, flex: 'none', padding: '6px 4px' }}
          >
            <option value="primary">Filled</option>
            <option value="outline">Outline</option>
            <option value="text">Text</option>
          </select>
          <button onClick={() => onChange(ctas.filter((_, j) => j !== i))} title="Remove button" className="dd-icon-btn" data-danger="1" style={{ border: 'none', background: 'transparent', flex: 'none' }}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {ctas.length < 4 && (
        <button
          onClick={() => onChange([...ctas, { label: 'New button', href: '/docs', style: 'outline' }])}
          style={{ display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', border: '1px dashed var(--color-fd-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 12, padding: '4px 9px', cursor: 'pointer' }}
        >
          <Plus size={11} /> Button
        </button>
      )}
    </div>
  );
}

export function LandingAdmin({
  published,
  copy,
  onChange,
}: {
  published: LandingCopy;
  copy: LandingCopy;
  onChange: (next: LandingCopy) => void;
}) {
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAdmin(!!d.admin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-apply a locally saved (unpublished) draft on load; drop it once the
  // published build has caught up with it.
  useEffect(() => {
    if (!admin) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      if (raw === JSON.stringify(published)) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const saved = sanitizeLandingCopy(JSON.parse(raw));
      queueMicrotask(() => {
        onChange(saved);
        setDirty(true);
      });
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  const update = useCallback(
    (next: LandingCopy) => {
      onChange(next);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setDirty(true);
      setNote('Previewing — only you see this until you publish.');
    },
    [onChange],
  );

  const discard = useCallback(() => {
    if (!window.confirm('Discard your landing page draft and return to the published copy?')) return;
    localStorage.removeItem(DRAFT_KEY);
    onChange(published);
    setDirty(false);
    setNote('');
  }, [onChange, published]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setNote('Publishing…');
    try {
      const res = await fetch('/api/admin/layout', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ copy }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setNote(res.ok ? 'Committed — the site rebuilds with this copy; your preview stays on meanwhile.' : (data.error ?? 'Publish failed.'));
    } catch (err) {
      setNote(`Publish failed: ${(err as Error).message}`);
    } finally {
      setPublishing(false);
    }
  }, [copy]);

  if (!admin) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 18px', borderRadius: 999, border: 'none', background: ACCENT, color: '#fff',
          fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer',
        }}
      >
        <PencilRuler size={14} /> Edit layout
        {dirty && (
          <span style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '2px 8px' }}>
            DRAFT
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      className="dd-pop"
      style={{
        position: 'fixed', top: 12, right: 12, bottom: 12, zIndex: 90, width: 360, maxWidth: 'calc(100vw - 24px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--color-fd-border)' }}>
        <PencilRuler size={14} style={{ color: ACCENT }} />
        <strong style={{ fontSize: 13.5, flex: 1 }}>Layout page</strong>
        {dirty && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: ACCENT }}>DRAFT</span>}
        <button onClick={() => setOpen(false)} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
          Everything here updates the page live — the flowing demo re-lays out as you type.
        </div>

        <SectionTitle>Hero</SectionTitle>
        <Label>Eyebrow</Label>
        <Text value={copy.hero.eyebrow} onChange={(v) => update({ ...copy, hero: { ...copy.hero, eyebrow: v } })} />
        <Label>Title (one line per row)</Label>
        <Area rows={2} value={copy.hero.titleLines.join('\n')} onChange={(v) => update({ ...copy, hero: { ...copy.hero, titleLines: v.split('\n').slice(0, 3) } })} />
        <Label>Tagline</Label>
        <Area rows={3} value={copy.hero.tagline} onChange={(v) => update({ ...copy, hero: { ...copy.hero, tagline: v } })} />
        <Label>Buttons</Label>
        <CtaRows ctas={copy.hero.ctas} onChange={(ctas) => update({ ...copy, hero: { ...copy.hero, ctas } })} />

        <SectionTitle>Flow demo</SectionTitle>
        <Label>First paragraph (wraps the orb)</Label>
        <Area rows={7} value={copy.demo.intro} onChange={(v) => update({ ...copy, demo: { ...copy.demo, intro: v } })} />
        <Label>Second paragraph (wraps the code)</Label>
        <Area rows={6} value={copy.demo.body} onChange={(v) => update({ ...copy, demo: { ...copy.demo, body: v } })} />
        <Label>Code sample</Label>
        <Area rows={6} mono value={copy.demo.code} onChange={(v) => update({ ...copy, demo: { ...copy.demo, code: v } })} />

        <SectionTitle>Features</SectionTitle>
        <Label>Section heading</Label>
        <Text value={copy.features.heading} onChange={(v) => update({ ...copy, features: { ...copy.features, heading: v } })} />
        {copy.features.items.map((f, i) => (
          <div key={i} style={{ border: '1px solid var(--color-fd-border)', borderRadius: 10, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={f.title}
                placeholder="Feature title"
                spellCheck={false}
                onChange={(e) => update({ ...copy, features: { ...copy.features, items: copy.features.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) } })}
                style={{ ...inputStyle, fontWeight: 600 }}
              />
              <button
                onClick={() => update({ ...copy, features: { ...copy.features, items: copy.features.items.filter((_, j) => j !== i) } })}
                title="Remove feature"
                className="dd-icon-btn"
                data-danger="1"
                style={{ border: 'none', background: 'transparent', flex: 'none' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <Area rows={3} value={f.body} onChange={(v) => update({ ...copy, features: { ...copy.features, items: copy.features.items.map((x, j) => (j === i ? { ...x, body: v } : x)) } })} />
            <Text mono placeholder="/docs/…" value={f.href} onChange={(v) => update({ ...copy, features: { ...copy.features, items: copy.features.items.map((x, j) => (j === i ? { ...x, href: v } : x)) } })} />
          </div>
        ))}
        {copy.features.items.length < 12 && (
          <button
            onClick={() => update({ ...copy, features: { ...copy.features, items: [...copy.features.items, { title: 'New feature', body: 'What it does and why it matters.', href: '/docs' }] } })}
            style={{ display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', border: '1px dashed var(--color-fd-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 12, padding: '4px 9px', cursor: 'pointer' }}
          >
            <Plus size={11} /> Feature
          </button>
        )}

        <SectionTitle>Closing</SectionTitle>
        <Label>Title</Label>
        <Text value={copy.closing.title} onChange={(v) => update({ ...copy, closing: { ...copy.closing, title: v } })} />
        <Label>Body</Label>
        <Area rows={3} value={copy.closing.body} onChange={(v) => update({ ...copy, closing: { ...copy.closing, body: v } })} />
        <Label>Buttons</Label>
        <CtaRows ctas={copy.closing.ctas} onChange={(ctas) => update({ ...copy, closing: { ...copy.closing, ctas } })} />

        <SectionTitle>Search & social</SectionTitle>
        <Label>Browser / social title</Label>
        <Text value={copy.meta.title} onChange={(v) => update({ ...copy, meta: { ...copy.meta, title: v } })} />
        <Label>Social description</Label>
        <Area rows={3} value={copy.meta.description} onChange={(v) => update({ ...copy, meta: { ...copy.meta, description: v } })} />
        <div style={{ fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>
          Title and description apply after the rebuild (they live in the page&apos;s metadata).
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--color-fd-border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {note && <div style={{ fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>{note}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={discard}
            disabled={!dirty}
            style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-fd-border)', background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 13, cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.5 }}
          >
            Discard
          </button>
          <button
            onClick={() => void publish()}
            disabled={publishing}
            style={{ height: 30, padding: '0 14px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13, cursor: publishing ? 'default' : 'pointer', opacity: publishing ? 0.7 : 1 }}
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </aside>
  );
}
