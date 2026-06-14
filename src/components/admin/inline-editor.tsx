'use client';

/**
 * On-page editor. Mounted on every docs page; renders nothing unless the
 * visitor is an admin. "Edit page" turns the *real* page into the editor: the
 * editable blocks are portaled into the page's own <article>, so the sidebar,
 * table of contents, header, and column width are exactly the published page's.
 * A floating toolbar handles draft status / preview / discard / publish / done.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { EditableDoc } from './editable-doc';
import { usePageDraft } from './use-page-draft';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

function EditOverlay({ slug, onDone }: { slug: string; onDone: () => void }) {
  const { source, status, publishing, onChange, discard, publish } = usePageDraft(slug);
  const [host, setHost] = useState<HTMLElement | null>(null);

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
    setHost(container);
    return () => {
      container.remove();
      style.remove();
    };
  }, []);

  const ghost: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #E2DCD0', background: '#fff', color: '#57534a', fontSize: 13, cursor: 'pointer', fontFamily: 'ui-sans-serif, system-ui, sans-serif' };

  return (
    <>
      {host && source != null && createPortal(<EditableDoc key={slug} source={source} onChange={onChange} />, host)}
      <div style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 12, background: '#fff', border: '1px solid #EAE4DA', boxShadow: '0 8px 28px rgba(28,26,22,0.18)', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1a16' }}>Editing</span>
        {status && <span style={{ fontSize: 12, color: '#8a857a' }}>● {status}</span>}
        <a href={`/admin/preview?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: ACCENT }}>Preview ↗</a>
        <button onClick={discard} style={ghost}>Discard</button>
        <button onClick={publish} disabled={publishing} style={{ height: 30, padding: '0 14px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
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

  if (!admin || slug == null) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', alignItems: 'center', gap: 7, padding: '12px 18px', borderRadius: 999, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 14, fontFamily: 'ui-sans-serif, system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer' }}
        >
          ✎ Edit page
        </button>
      )}
      {open && <EditOverlay slug={slug} onDone={() => setOpen(false)} />}
    </>
  );
}
