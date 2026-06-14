'use client';

/**
 * In-app editing. Mounted on every docs page but renders nothing unless the
 * visitor has an admin session. When signed in, a floating "Edit" button opens
 * a drawer to edit the current page's MDX in context — autosaving a draft to
 * IndexedDB and publishing to GitHub, exactly like /admin, but without leaving
 * the page you're reading.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { deleteDraft, getDraft, putDraft } from '@/lib/drafts';

const orange = '#e8753b';

// "/docs" -> "", "/docs/reading-experience" -> "reading-experience"
function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

export function InlineEditor() {
  const pathname = usePathname();
  const slug = slugFromPath(pathname);

  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState('');
  const [content, setContent] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadContent = useCallback(async () => {
    if (slug == null) return;
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);
    const draft = await getDraft(slug);
    if (draft && draft.content !== baseline) {
      setContent(draft.content);
      setHasDraft(true);
      setStatus('Local draft loaded.');
    } else {
      setContent(baseline);
      setHasDraft(false);
      setStatus('');
    }
  }, [slug]);

  useEffect(() => {
    if (open) void loadContent();
  }, [open, loadContent]);

  function onEdit(value: string) {
    setContent(value);
    if (slug == null) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (value === published) {
        void deleteDraft(slug);
        setHasDraft(false);
        setStatus('');
      } else {
        void putDraft(slug, value);
        setHasDraft(true);
        setStatus('Draft saved locally.');
      }
    }, 400);
  }

  async function publish() {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    try {
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content }),
      });
      const data = (await res.json().catch(() => ({}))) as { commitUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      if (slug != null) await deleteDraft(slug);
      setPublished(content);
      setHasDraft(false);
      setStatus('Published — the live page rebuilds shortly.');
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (!admin || slug == null) return null;
  const dirty = content !== published;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 60,
            padding: '12px 18px',
            borderRadius: 999,
            border: 'none',
            background: orange,
            color: 'white',
            fontWeight: 600,
            fontSize: 14,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            cursor: 'pointer',
          }}
        >
          ✏️ Edit{hasDraft ? ' ●' : ''}
        </button>
      )}

      {open && (
        <aside
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(520px, 92vw)',
            zIndex: 60,
            background: 'var(--color-fd-background, #fff)',
            borderLeft: '1px solid rgba(127,127,127,0.25)',
            boxShadow: '-12px 0 40px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(127,127,127,0.2)' }}>
            <strong style={{ fontSize: 15 }}>Editing /{slug || '(index)'}</strong>
            {hasDraft && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(232,117,59,0.15)', color: orange }}>
                local draft
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
              <a href={`/admin/preview?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: orange }}>
                Preview ↗
              </a>
              <a href={`/admin?slug=${encodeURIComponent(slug)}`} style={{ fontSize: 12, color: '#888' }}>
                Full editor ↗
              </a>
              <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          </header>

          <textarea
            value={content}
            onChange={(e) => onEdit(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              margin: 0,
              padding: 16,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              lineHeight: 1.6,
              background: 'transparent',
              color: 'inherit',
            }}
          />

          <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(127,127,127,0.2)' }}>
            <button
              onClick={publish}
              disabled={publishing || !dirty}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: publishing || !dirty ? '#bbb' : orange,
                color: 'white',
                fontWeight: 600,
                fontSize: 14,
                cursor: publishing || !dirty ? 'default' : 'pointer',
              }}
            >
              {publishing ? 'Publishing…' : 'Publish to GitHub'}
            </button>
            {status && <span style={{ fontSize: 12, color: '#888', wordBreak: 'break-word' }}>{status}</span>}
          </footer>
        </aside>
      )}
    </>
  );
}
