'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDraft, getDraft, putDraft } from '@/lib/drafts';
import { LayoutEditor } from './layout-editor';

type Status = { kind: 'idle' | 'ok' | 'err' | 'info'; msg?: string };

const orange = '#e8753b';

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [slug, setSlug] = useState('');
  const [published, setPublished] = useState('');
  const [content, setContent] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<'markdown' | 'layout'>('markdown');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPages = useCallback(async () => {
    const res = await fetch('/api/admin/pages');
    if (res.status === 401) return setAuthed(false);
    const data = await res.json();
    setAuthed(true);
    setPages(data.pages ?? []);
    const initial =
      new URLSearchParams(window.location.search).get('slug') ?? data.pages?.[0] ?? '';
    setSlug(initial);
  }, []);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const loadContent = useCallback(async (s: string) => {
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(s)}`);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);
    const draft = await getDraft(s);
    if (draft && draft.content !== baseline) {
      setContent(draft.content);
      setHasDraft(true);
      setStatus({ kind: 'info', msg: 'Local draft loaded (unpublished).' });
    } else {
      setContent(baseline);
      setHasDraft(false);
      setStatus({ kind: 'idle' });
    }
  }, []);

  useEffect(() => {
    if (authed) void loadContent(slug);
  }, [authed, slug, loadContent]);

  function onEdit(value: string) {
    setContent(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (value === published) {
        void deleteDraft(slug);
        setHasDraft(false);
        setStatus({ kind: 'idle' });
      } else {
        void putDraft(slug, value);
        setHasDraft(true);
        setStatus({ kind: 'info', msg: 'Draft saved locally.' });
      }
    }, 400);
  }

  // Used by the visual layout editor: apply a rewritten source immediately.
  function applyContent(next: string) {
    setContent(next);
    if (next === published) {
      void deleteDraft(slug);
      setHasDraft(false);
      setStatus({ kind: 'idle' });
    } else {
      void putDraft(slug, next);
      setHasDraft(true);
      setStatus({ kind: 'info', msg: 'Layout updated — draft saved locally.' });
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      setPin('');
      void loadPages();
    } else {
      setStatus({ kind: 'err', msg: 'Invalid PIN.' });
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(false);
    setContent('');
  }

  async function discardDraft() {
    await deleteDraft(slug);
    setContent(published);
    setHasDraft(false);
    setStatus({ kind: 'idle', msg: undefined });
  }

  async function publish() {
    setPublishing(true);
    setStatus({ kind: 'info', msg: 'Committing to GitHub…' });
    try {
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content }),
      });
      const data = (await res.json().catch(() => ({}))) as { commitUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      await deleteDraft(slug);
      setPublished(content);
      setHasDraft(false);
      setStatus({
        kind: 'ok',
        msg: data.commitUrl ? `Published. Commit: ${data.commitUrl}` : 'Published to GitHub.',
      });
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as Error).message });
    } finally {
      setPublishing(false);
    }
  }

  const shell: React.CSSProperties = {
    maxWidth: 940,
    margin: '0 auto',
    padding: '48px 24px 96px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  };
  const btn = (bg: string): React.CSSProperties => ({
    fontSize: 15,
    padding: '11px 22px',
    borderRadius: 10,
    border: 'none',
    background: bg,
    color: 'white',
    fontWeight: 600,
    cursor: 'pointer',
  });
  const field: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #ccc',
    fontSize: 14,
  };

  if (authed === null) return <main style={shell}>Loading…</main>;

  if (!authed) {
    return (
      <main style={shell}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>docs.dev admin</h1>
        <p style={{ color: '#888', marginBottom: 24 }}>Enter the PIN to edit content.</p>
        <form onSubmit={login} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            maxLength={8}
            placeholder="PIN"
            autoFocus
            style={{ ...field, fontSize: 22, letterSpacing: '0.4em', width: 160, textAlign: 'center' }}
          />
          <button type="submit" style={btn(orange)}>
            Sign in
          </button>
        </form>
        {status.kind === 'err' && <p style={{ color: '#e0533b', marginTop: 16 }}>{status.msg}</p>}
        <p style={{ color: '#aaa', marginTop: 32, fontSize: 13 }}>
          Proof of concept — default PIN is <code>1234</code>.
        </p>
      </main>
    );
  }

  const dirty = content !== published;

  return (
    <main style={shell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>docs.dev admin</h1>
        <button onClick={logout} style={{ ...field, cursor: 'pointer', background: 'transparent' }}>
          Sign out
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '20px 0' }}>
        <label style={{ fontSize: 14, color: '#888' }}>Page</label>
        <select value={slug} onChange={(e) => setSlug(e.target.value)} style={field}>
          {pages.map((p) => (
            <option key={p} value={p}>
              /{p || '(index)'}
            </option>
          ))}
        </select>
        <a href={`/docs/${slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: orange }}>
          View page ↗
        </a>
        {hasDraft && (
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'rgba(232,117,59,0.15)', color: orange }}>
            ● local draft
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['markdown', 'layout'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              ...field,
              cursor: 'pointer',
              textTransform: 'capitalize',
              background: mode === m ? orange : 'transparent',
              color: mode === m ? 'white' : 'inherit',
              borderColor: mode === m ? orange : '#ccc',
            }}
          >
            {m === 'layout' ? 'Layout (drag)' : 'Markdown'}
          </button>
        ))}
      </div>

      {mode === 'markdown' ? (
        <textarea
          value={content}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            height: 460,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #ccc',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 14,
            lineHeight: 1.6,
            resize: 'vertical',
          }}
        />
      ) : (
        <LayoutEditor key={slug} content={content} onApply={applyContent} />
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={publish} disabled={publishing || !dirty} style={btn(publishing || !dirty ? '#bbb' : orange)}>
          {publishing ? 'Publishing…' : 'Publish to GitHub'}
        </button>
        {hasDraft && (
          <button onClick={discardDraft} style={{ ...field, cursor: 'pointer', background: 'transparent' }}>
            Discard draft
          </button>
        )}
        {status.msg && (
          <span
            style={{
              fontSize: 13,
              color:
                status.kind === 'ok' ? '#2a9d5c' : status.kind === 'err' ? '#e0533b' : '#888',
              wordBreak: 'break-all',
            }}
          >
            {status.msg}
          </span>
        )}
      </div>
    </main>
  );
}
