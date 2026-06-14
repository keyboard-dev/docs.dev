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
import { deleteDraft, getAsset, getDraft, putAsset, putDraft } from '@/lib/drafts';
import { enablePlainTextEditing, type InlineEditController } from './inline-edit-dom';

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
  const [inlineMode, setInlineMode] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineCtl = useRef<InlineEditController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Inline (click-to-edit) mode: enable plain-text editing on the rendered page.
  useEffect(() => {
    if (!inlineMode || slug == null) return;
    let active = true;
    (async () => {
      const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
      const baseline = res.ok ? ((await res.json()).content as string) : '';
      const draft = await getDraft(slug);
      const working = draft && draft.content !== baseline ? draft.content : baseline;
      if (!active) return;
      setPublished(baseline);
      setContent(working);
      inlineCtl.current = enablePlainTextEditing(working, (next) => {
        setContent(next);
        setHasDraft(next !== baseline);
        void putDraft(slug, next);
        setStatus('Draft saved locally.');
      });
    })();
    return () => {
      active = false;
      inlineCtl.current?.destroy();
      inlineCtl.current = null;
    };
  }, [inlineMode, slug]);

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

  // Read a File as a data URL.
  function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // Store uploaded images locally and insert markdown at the cursor.
  async function handleFiles(files: FileList | File[]) {
    const ta = textareaRef.current;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    let working = content;
    let insertAt = ta ? ta.selectionStart : working.length;
    for (const file of list) {
      const dataUrl = await readDataUrl(file);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `/uploads/${Date.now()}-${safe}`;
      await putAsset({ path, contentType: file.type, dataUrl });
      const snippet = `\n\n![${file.name}](${path})\n\n`;
      working = working.slice(0, insertAt) + snippet + working.slice(insertAt);
      insertAt += snippet.length;
    }
    onEdit(working);
    setStatus('Image added to draft.');
  }

  // Collect uploaded assets referenced by the current content, for publishing.
  async function collectAssets(): Promise<Array<{ path: string; base64: string }>> {
    const paths = new Set<string>();
    for (const m of content.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
    const out: Array<{ path: string; base64: string }> = [];
    for (const path of paths) {
      const asset = await getAsset(path);
      if (asset) out.push({ path, base64: asset.dataUrl.replace(/^data:[^;]+;base64,/, '') });
    }
    return out;
  }

  async function publish() {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    try {
      const assets = await collectAssets();
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content, assets }),
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
      {/* Inline (click-to-edit) mode bar */}
      {inlineMode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '8px 16px',
            margin: 8,
            borderRadius: 10,
            background: orange,
            color: 'white',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: 13,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          <strong>Inline editing</strong>
          <span style={{ opacity: 0.9 }}>Click any plain paragraph to edit · formatted blocks use the drawer</span>
          <button onClick={publish} disabled={publishing || !dirty} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontWeight: 600, cursor: publishing || !dirty ? 'default' : 'pointer', background: 'white', color: orange, opacity: publishing || !dirty ? 0.6 : 1 }}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          <button onClick={() => setInlineMode(false)} style={{ border: '1px solid rgba(255,255,255,0.6)', background: 'transparent', color: 'white', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
            Done
          </button>
          {status && <span style={{ opacity: 0.85 }}>{status}</span>}
        </div>
      )}

      {!open && !inlineMode && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', gap: 10 }}>
          <button
            onClick={() => setInlineMode(true)}
            style={{
              padding: '12px 16px',
              borderRadius: 999,
              border: `1px solid ${orange}`,
              background: 'white',
              color: orange,
              fontWeight: 600,
              fontSize: 14,
              boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
              cursor: 'pointer',
            }}
          >
            ✎ Inline edit{hasDraft ? ' ●' : ''}
          </button>
          <button
            onClick={() => setOpen(true)}
            style={{
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
            ✏️ Drawer
          </button>
        </div>
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
            ref={textareaRef}
            value={content}
            onChange={(e) => onEdit(e.target.value)}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                void handleFiles(e.dataTransfer.files);
              }
            }}
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
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
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' }}
            >
              📎 Upload image
            </button>
            {status && <span style={{ fontSize: 12, color: '#888', wordBreak: 'break-word' }}>{status}</span>}
          </footer>
        </aside>
      )}
    </>
  );
}
