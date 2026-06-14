'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditableDoc } from '@/components/admin/editable-doc';
import { deleteDraft, deleteInlineEdits, getAsset, getDraft, putDraft } from '@/lib/drafts';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

export default function EditPage() {
  const [slug, setSlug] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [published, setPublished] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  const draftRef = useRef('');

  const load = useCallback(async (s: string) => {
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(s)}`);
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);
    const draft = await getDraft(s);
    const initial = draft?.content ?? baseline;
    draftRef.current = initial;
    setSource(initial);
    setStatus(draft && draft.content !== baseline ? 'Local draft' : '');
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('slug') ?? '';
    setSlug(s);
    void load(s);
  }, [load]);

  function onChange(next: string) {
    draftRef.current = next;
    if (next === published) {
      void deleteDraft(slug);
      void deleteInlineEdits(slug);
      setStatus('');
    } else {
      void putDraft(slug, next);
      setStatus('Draft saved locally');
    }
  }

  async function collectAssets() {
    const paths = new Set<string>();
    for (const m of draftRef.current.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
    const out: Array<{ path: string; base64: string }> = [];
    for (const path of paths) {
      const a = await getAsset(path);
      if (a) out.push({ path, base64: a.dataUrl.replace(/^data:[^;]+;base64,/, '') });
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
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '60px 24px' }}>
        <p>You need to <a href="/admin" style={{ color: ACCENT }}>sign in</a> to edit.</p>
      </main>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #EAE4DA', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <strong style={{ fontSize: 15 }}>Editing /{slug || '(index)'}</strong>
        {status && <span style={{ fontSize: 12, color: '#8a857a' }}>● {status}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
          <a href={`/admin/preview?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: ACCENT }}>Preview ↗</a>
          <a href={`/docs/${slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#8a857a' }}>Published ↗</a>
          <button onClick={publish} disabled={publishing} style={{ height: 34, padding: '0 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </span>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '44px 24px 140px' }}>
        {source == null ? <p style={{ color: '#aaa' }}>Loading…</p> : <EditableDoc key={slug} source={source} onChange={onChange} />}
      </main>
    </div>
  );
}
