'use client';

/** Shared draft lifecycle for a page: load (draft or published baseline),
 *  autosave locally, discard, and publish to GitHub. Used by both the
 *  standalone /admin/edit screen and the on-page edit overlay. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDraft, deleteInlineEdits, getAsset, getDraft, putDraft } from '@/lib/drafts';

export function usePageDraft(slug: string) {
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

  const onChange = useCallback(
    (next: string) => {
      draftRef.current = next;
      if (next === published) {
        void deleteDraft(slug);
        void deleteInlineEdits(slug);
        setStatus('');
      } else {
        void putDraft(slug, next);
        setStatus('Draft · saved locally');
      }
    },
    [published, slug],
  );

  const discard = useCallback(async () => {
    await deleteDraft(slug);
    await deleteInlineEdits(slug);
    draftRef.current = published;
    setSource(published);
    setStatus('');
  }, [published, slug]);

  const publish = useCallback(async () => {
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
  }, [slug]);

  return { source, authed, status, publishing, onChange, discard, publish };
}
