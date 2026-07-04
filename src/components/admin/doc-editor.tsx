'use client';

/**
 * DocEditor — standalone editor screen (/admin/edit). Renders the page as
 * editable blocks in a centered column. The on-page overlay (EditOverlay) is
 * preferred for day-to-day editing since it keeps the real page chrome.
 */

import { EditableDoc } from './editable-doc';
import { usePageDraft } from './use-page-draft';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

export function DocEditor({ slug, onDone }: { slug: string; onDone?: () => void }) {
  const { source, revision, authed, status, publishing, onChange, discard, publish } = usePageDraft(slug);

  if (authed === false) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '60px 24px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        You need to <a href="/admin" style={{ color: ACCENT }}>sign in</a> to edit.
      </div>
    );
  }
  const ghost: React.CSSProperties = { height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #E2DCD0', background: '#fff', color: '#57534a', fontSize: 13, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100%', background: '#FAF8F4' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #EAE4DA', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <strong style={{ fontSize: 15 }}>Editing /{slug || '(index)'}</strong>
        {status && <span style={{ fontSize: 12, color: '#8a857a' }}>● {status}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href={`/admin/preview?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: ACCENT, alignSelf: 'center' }}>Preview ↗</a>
          <button onClick={discard} style={ghost}>Discard</button>
          <button onClick={publish} disabled={publishing} style={{ height: 34, padding: '0 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          {onDone && <button onClick={onDone} style={ghost}>Done</button>}
        </span>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '44px 24px 160px' }}>
        {source == null ? <p style={{ color: '#aaa' }}>Loading…</p> : <EditableDoc key={`${slug}:${revision}`} source={source} onChange={onChange} />}
      </main>
    </div>
  );
}
