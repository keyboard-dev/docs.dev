'use client';

/**
 * DocEditor — the one editor. Loads a page's draft (or published baseline),
 * renders it as editable blocks (EditableDoc), autosaves locally, and publishes
 * to GitHub. Used both at /admin/edit and as the on-page overlay launched from
 * any docs page, so there's a single cohesive editing experience.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditableDoc } from './editable-doc';
import { deleteDraft, deleteInlineEdits, getAsset, getDraft, putDraft } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

export function DocEditor({ slug, onDone }: { slug: string; onDone?: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [published, setPublished] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  const draftRef = useRef('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
    if (res.status === 401) return setAuthed(false);
    setAuthed(true);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);
    const draft = await getDraft(slug);
    const initial = draft?.content ?? baseline;
    draftRef.current = initial;
    setSource(initial);
    setStatus(draft && draft.content !== baseline ? 'Draft · saved locally' : '');
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function onChange(next: string) {
    draftRef.current = next;
    if (next === published) {
      void deleteDraft(slug);
      void deleteInlineEdits(slug);
      setStatus('');
    } else {
      void putDraft(slug, next);
      setStatus('Draft · saved locally');
    }
  }

  async function discard() {
    await deleteDraft(slug);
    await deleteInlineEdits(slug);
    draftRef.current = published;
    setSource(published);
    setStatus('');
  }

  async function publish() {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    try {
      const paths = new Set<string>();
      for (const m of draftRef.current.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
      const assets: Array<{ path: string; base64: string }> = [];
      for (const path of paths) {
        const a = await getAsset(path);
        if (a) assets.push({ path, base64: a.dataUrl.replace(/^data:[^;]+;base64,/, '') });
      }
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content: draftRef.current, assets }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      await deleteDraft(slug);
      await deleteInlineEdits(slug);
      setPublished(draftRef.current);
      setStatus('Published — the live page rebuilds shortly.');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

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
        {source == null ? <p style={{ color: '#aaa' }}>Loading…</p> : <EditableDoc key={slug} source={source} onChange={onChange} />}
      </main>
    </div>
  );
}
