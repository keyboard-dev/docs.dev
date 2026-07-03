'use client';

/**
 * On-page editor. Mounted on every docs page; renders nothing unless the
 * visitor is an admin. "Edit page" turns the *real* page into the editor: the
 * editable blocks are portaled into the page's own <article>, so the sidebar,
 * table of contents, header, and column width are exactly the published page's.
 *
 * The floating toolbar carries the draft lifecycle: an Edit ↔ Preview toggle
 * (preview compiles the draft MDX in place, inside the same article — never a
 * different-looking page), draft status, Discard (confirmed), Publish with
 * clear progress, and Done. All chrome uses the Fumadocs theme variables.
 */

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Eye, Pencil } from 'lucide-react';
import * as runtime from 'react/jsx-runtime';
import { EditableDoc } from './editable-doc';
import { usePageDraft } from './use-page-draft';
import { getMDXComponents } from '@/components/mdx';
import { getDraft } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

function splitFrontmatter(source: string): { title: string; description: string; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { title: '', description: '', body: source };
  const get = (key: string) =>
    (m[1]!.match(new RegExp(`^${key}:\\s*(.*)$`, 'm')) ?? [])[1]?.replace(/^["']|["']$/g, '') ?? '';
  return { title: get('title'), description: get('description'), body: source.slice(m[0].length) };
}

/** Renders the draft exactly as it will publish — same components, same
 *  chrome, same column — inside the page's own article. */
function PreviewInPlace({ source }: { source: string }) {
  const [Content, setContent] = useState<ComponentType<{ components?: unknown }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { title, description, body } = splitFrontmatter(source);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { evaluate } = await import('@mdx-js/mdx');
        if (cancelled) return;
        setContent(null);
        setError(null);
        const mod = await evaluate(body, {
          Fragment: runtime.Fragment,
          jsx: runtime.jsx,
          jsxs: runtime.jsxs,
          baseUrl: window.location.href,
        });
        if (!cancelled) setContent(() => mod.default as ComponentType<{ components?: unknown }>);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [body]);

  return (
    <>
      <h1 className="text-[1.75em] font-semibold">{title}</h1>
      {description && <p className="mb-0 text-lg text-fd-muted-foreground">{description}</p>}
      <div style={{ height: 1, background: 'var(--color-fd-border)', margin: '24px 0' }} />
      <div className="prose" style={{ maxWidth: 'none' }}>
        {error ? (
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-fd-error, #dc2626)' }}>Preview error: {error}</pre>
        ) : Content ? (
          <Content components={getMDXComponents()} />
        ) : (
          <p style={{ color: 'var(--color-fd-muted-foreground)' }}>Rendering preview…</p>
        )}
      </div>
    </>
  );
}

function EditOverlay({ slug, onDone }: { slug: string; onDone: () => void }) {
  const { source, revision, status, publishing, onChange, discard, publish, getCurrent } = usePageDraft(slug);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  // Snapshot of the draft for preview mode (kept in sync when toggling).
  const [previewSource, setPreviewSource] = useState('');

  // Take over the page's own <article> so the chrome (sidebar/TOC/width) is real.
  useEffect(() => {
    const article = document.querySelector('article');
    if (!article) return;
    const container = document.createElement('div');
    container.setAttribute('data-editor', '');
    article.appendChild(container);
    const style = document.createElement('style');
    style.textContent = `article > :not([data-editor]) { display: none !important; }`;
    document.head.appendChild(style);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setHost(container);
    });
    return () => {
      cancelled = true;
      container.remove();
      style.remove();
    };
  }, []);

  const showPreview = useCallback(() => {
    setPreviewSource(getCurrent());
    setMode('preview');
  }, [getCurrent]);

  const onDiscard = useCallback(() => {
    if (!window.confirm('Discard your local draft and return to the published version?')) return;
    void discard();
    setMode('edit');
  }, [discard]);

  const seg = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
    borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? 'var(--color-fd-primary)' : 'transparent',
    color: active ? 'var(--color-fd-primary-foreground)' : 'var(--color-fd-muted-foreground)',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  });
  const ghost: React.CSSProperties = {
    height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-fd-border)',
    background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 13, cursor: 'pointer',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  };

  const published = status.startsWith('Published');

  return (
    <>
      {host &&
        source != null &&
        createPortal(
          mode === 'edit' ? (
            <EditableDoc key={`${slug}:${revision}`} source={source} onChange={onChange} />
          ) : (
            <PreviewInPlace source={previewSource} />
          ),
          host,
        )}
      <div
        className="dd-pop"
        style={{
          position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
          fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
        }}
      >
        <div style={{ display: 'flex', gap: 2, background: 'var(--color-fd-muted)', borderRadius: 9, padding: 2 }}>
          <button style={seg(mode === 'edit')} onClick={() => setMode('edit')}>
            <Pencil size={12} /> Edit
          </button>
          <button style={seg(mode === 'preview')} onClick={showPreview}>
            <Eye size={12} /> Preview
          </button>
        </div>
        {status && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)', maxWidth: 340 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flex: 'none',
                background: published ? 'var(--color-fd-success, #16a34a)' : ACCENT,
              }}
            />
            {status}
          </span>
        )}
        <button onClick={onDiscard} style={ghost}>Discard</button>
        <button
          onClick={publish}
          disabled={publishing}
          style={{
            height: 30, padding: '0 14px', borderRadius: 8, border: 'none',
            background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13,
            cursor: publishing ? 'default' : 'pointer', opacity: publishing ? 0.7 : 1,
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button onClick={onDone} style={ghost}>Done</button>
      </div>
    </>
  );
}

export function InlineEditor() {
  const pathname = usePathname();
  const slug = slugFromPath(pathname);
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => !cancelled && setAdmin(!!d.admin))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Unpublished-draft badge on the Edit button.
  useEffect(() => {
    if (!admin || slug == null || open) return;
    let cancelled = false;
    getDraft(slug)
      .then((d) => !cancelled && setHasDraft(!!d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [admin, slug, open]);

  if (!admin || slug == null) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 18px', borderRadius: 999, border: 'none', background: ACCENT, color: '#fff',
            fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer',
          }}
        >
          <Pencil size={14} /> Edit page
          {hasDraft && (
            <span
              title="This page has an unpublished draft"
              style={{
                marginLeft: 2, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '2px 8px',
              }}
            >
              DRAFT
            </span>
          )}
        </button>
      )}
      {open && <EditOverlay slug={slug} onDone={() => setOpen(false)} />}
    </>
  );
}
