'use client';

/** Shared draft lifecycle for a page.
 *
 *  Three layers, fastest to most durable:
 *    - IndexedDB: instant autosave as you type (never lose local work)
 *    - the shared drafts API: debounced push, so teammates and other devices
 *      see your draft; pulls on load and adopts whichever copy is newest
 *    - publish: commits to GitHub, then polls the built page until the deploy
 *      lands ("Live ✓")
 *
 *  Conflicts use a last-writer guard: pushes carry the server version they
 *  were based on; if a teammate saved since, the push is rejected and the
 *  conflict is surfaced (load theirs / keep mine) instead of silently
 *  clobbering either side. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDraft, deleteInlineEdits, getAsset, getDraft, putDraft } from '@/lib/drafts';
import {
  deleteServerDraft,
  editorName,
  fetchServerDraft,
  pushServerDraft,
  type RemoteDraft,
} from '@/lib/draft-sync';
import { forgetPublish, recallPublish, rememberPublish, type PublishRef } from './deploy-status';
import { docsContentRoute } from '@/lib/shared';

const PUSH_DEBOUNCE_MS = 2500;
const LIVE_POLL_MS = 8000;
const LIVE_POLL_MAX_MS = 5 * 60 * 1000;

function builtContentUrl(slug: string): string {
  return `${docsContentRoute}/${slug ? `${slug}/` : ''}content.md`;
}

export function usePageDraft(slug: string) {
  const [source, setSource] = useState<string | null>(null);
  const [published, setPublished] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  /** A teammate's newer draft that blocked our last push (409). */
  const [conflict, setConflict] = useState<RemoteDraft | null>(null);
  /** The commit our last publish created — drives the deploy-status card.
   *  Recalled from sessionStorage so it survives closing/reopening the editor. */
  const [lastPublish, setLastPublish] = useState<PublishRef | null>(() =>
    typeof window === 'undefined' ? null : recallPublish(slug),
  );
  /** Bumped whenever `source` is replaced wholesale (load/discard/adopt) so the
   *  editor remounts with fresh state instead of keeping stale blocks. */
  const [revision, setRevision] = useState(0);
  const draftRef = useRef('');
  /** updatedAt of the server draft our edits are based on. */
  const serverBase = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLivePoll = () => {
    if (livePoll.current) clearInterval(livePoll.current);
    livePoll.current = null;
  };
  useEffect(() => () => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    stopLivePoll();
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
    if (res.status === 401) return setAuthed(false);
    setAuthed(true);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);

    const [local, remote] = await Promise.all([getDraft(slug), fetchServerDraft(slug)]);
    const localAt = local?.updatedAt ?? 0;
    const remoteAt = remote?.updatedAt ?? 0;
    serverBase.current = remoteAt;

    let initial = baseline;
    let note = '';
    if (remote && remoteAt >= localAt && remote.content !== baseline) {
      initial = remote.content;
      note = `Draft by ${remote.author} · shared`;
      void putDraft(slug, remote.content); // refresh the local cache
    } else if (local && local.content !== baseline) {
      initial = local.content;
      note = 'Draft · saved locally';
    }
    draftRef.current = initial;
    setSource(initial);
    setRevision((r) => r + 1);
    setStatus(note);
  }, [slug]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const pushNow = useCallback(async () => {
    const content = draftRef.current;
    if (content === '' || conflict) return;
    const result = await pushServerDraft(slug, content, serverBase.current, editorName(true));
    if (result.ok) {
      serverBase.current = result.updatedAt;
      setStatus('Draft · synced with team');
    } else if ('conflict' in result) {
      setConflict(result.conflict);
      setStatus(`${result.conflict.author} saved a newer draft of this page`);
    } else {
      setStatus('Draft · saved locally (sync unavailable)');
    }
  }, [slug, conflict]);

  const onChange = useCallback(
    (next: string) => {
      draftRef.current = next;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      if (next === published) {
        void deleteDraft(slug);
        void deleteInlineEdits(slug);
        void deleteServerDraft(slug);
        serverBase.current = 0;
        setStatus('');
        return;
      }
      void putDraft(slug, next);
      setStatus((s) => (s.includes('newer draft') ? s : 'Draft · saving…'));
      pushTimer.current = setTimeout(() => void pushNow(), PUSH_DEBOUNCE_MS);
    },
    [published, slug, pushNow],
  );

  /** Adopt the teammate's conflicting draft (theirs wins). */
  const adoptConflict = useCallback(async () => {
    if (!conflict) return;
    serverBase.current = conflict.updatedAt;
    draftRef.current = conflict.content;
    await putDraft(slug, conflict.content);
    setSource(conflict.content);
    setRevision((r) => r + 1);
    setConflict(null);
    setStatus(`Loaded ${conflict.author}'s draft`);
  }, [conflict, slug]);

  /** Keep our version (ours wins — overwrites the teammate's server draft). */
  const overwriteConflict = useCallback(async () => {
    if (!conflict) return;
    serverBase.current = conflict.updatedAt;
    setConflict(null);
    await pushServerDraft(slug, draftRef.current, conflict.updatedAt, editorName(true)).then((r) => {
      if (r.ok) {
        serverBase.current = r.updatedAt;
        setStatus('Draft · synced with team');
      }
    });
  }, [conflict, slug]);

  const discard = useCallback(async () => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    await deleteDraft(slug);
    await deleteInlineEdits(slug);
    await deleteServerDraft(slug);
    draftRef.current = published;
    serverBase.current = 0;
    setConflict(null);
    setSource(published);
    setRevision((r) => r + 1);
    setStatus('');
  }, [published, slug]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    if (pushTimer.current) clearTimeout(pushTimer.current);
    try {
      const paths = new Set<string>();
      for (const m of draftRef.current.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
      const assets: Array<{ path: string; base64: string }> = [];
      for (const path of paths) {
        const a = await getAsset(path);
        if (a) assets.push({ path, base64: a.dataUrl.replace(/^data:[^;]+;base64,/, '') });
      }
      // Snapshot the currently-built content so we can detect the redeploy.
      const before = await fetch(builtContentUrl(slug), { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);

      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content: draftRef.current, assets }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        commitSha?: string;
        commitUrl?: string;
        repo?: string;
        branch?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      if (data.commitSha) {
        const ref: PublishRef = {
          slug,
          sha: data.commitSha,
          url: data.commitUrl ?? '',
          repo: data.repo ?? '',
          branch: data.branch ?? '',
          at: Date.now(),
        };
        rememberPublish(ref);
        setLastPublish(ref);
      }
      await deleteDraft(slug);
      await deleteInlineEdits(slug);
      await deleteServerDraft(slug);
      serverBase.current = 0;
      setConflict(null);
      setPublished(draftRef.current);
      setStatus('Published ✓ — deploying…');

      // Poll the built page until the deploy lands.
      stopLivePoll();
      const startedAt = Date.now();
      livePoll.current = setInterval(async () => {
        if (Date.now() - startedAt > LIVE_POLL_MAX_MS) {
          stopLivePoll();
          setStatus('Published ✓ — deploy is taking a while; it will land shortly.');
          return;
        }
        const now = await fetch(builtContentUrl(slug), { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : null))
          .catch(() => null);
        if (now != null && now !== before) {
          stopLivePoll();
          setStatus('Live ✓ — the published site is up to date.');
        }
      }, LIVE_POLL_MS);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [slug]);

  const dismissPublishInfo = useCallback(() => {
    forgetPublish();
    setLastPublish(null);
  }, []);

  return {
    source,
    revision,
    authed,
    status,
    publishing,
    conflict,
    lastPublish,
    dismissPublishInfo,
    onChange,
    discard,
    publish,
    adoptConflict,
    overwriteConflict,
    getCurrent: () => draftRef.current,
  };
}
