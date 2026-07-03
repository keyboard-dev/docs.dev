'use client';

/**
 * /admin — sign-in + page picker. Editing itself happens in the one unified
 * editor (on-page, or /admin/edit), so this is just the way in: enter the PIN,
 * then pick a page to edit.
 */

import { useCallback, useEffect, useState } from 'react';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [ghAvailable, setGhAvailable] = useState(false);
  const [user, setUser] = useState<{ method: string; login: string; name: string; avatar: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setGhAvailable(!!d.githubOAuth);
        setUser(d.user ?? null);
      })
      .catch(() => {});
    const err = new URLSearchParams(window.location.search).get('error');
    if (err) {
      queueMicrotask(() => {
        if (!cancelled) setError(err === 'no-repo-access' ? 'Your GitHub account has no push access to the docs repo.' : `GitHub sign-in failed (${err}).`);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPages = useCallback(async () => {
    const res = await fetch('/api/admin/pages');
    if (res.status === 401) return setAuthed(false);
    const data = await res.json();
    setAuthed(true);
    setPages(data.pages ?? []);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadPages);
  }, [loadPages]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      setPin('');
      setError('');
      void loadPages();
    } else {
      setError('Invalid PIN.');
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(false);
  }

  const shell: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '56px 24px', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#1c1a16' };
  const field: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, border: '1px solid #ccc', fontSize: 16 };

  if (authed === null) return <main style={shell}>Loading…</main>;

  if (!authed) {
    return (
      <main style={shell}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>docs.dev admin</h1>
        <p style={{ color: '#8a857a', marginBottom: 24 }}>Sign in to edit content.</p>
        {ghAvailable && (
          <>
            <a
              href={`/api/auth/github/login?return=${encodeURIComponent('/admin')}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderRadius: 10, background: '#1c1a16', color: '#fff', fontWeight: 600, fontSize: 15, textDecoration: 'none' }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.53 7.53 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Sign in with GitHub
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0', color: '#b6b1a6', fontSize: 12 }}>
              <span style={{ flex: 1, height: 1, background: '#EAE4DA' }} />
              or use the PIN
              <span style={{ flex: 1, height: 1, background: '#EAE4DA' }} />
            </div>
          </>
        )}
        <form onSubmit={login} style={{ display: 'flex', gap: 12 }}>
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={8} placeholder="PIN" autoFocus={!ghAvailable} style={{ ...field, fontSize: 22, letterSpacing: '0.4em', width: 160, textAlign: 'center' }} />
          <button type="submit" style={{ ...field, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Sign in</button>
        </form>
        {error && <p style={{ color: '#c0392b', marginTop: 16 }}>{error}</p>}
        <p style={{ color: '#b6b1a6', marginTop: 32, fontSize: 13 }}>
          {ghAvailable
            ? 'GitHub sign-in requires push access to the docs repo.'
            : (<>Proof of concept — default PIN is <code>1234</code>.</>)}
        </p>
      </main>
    );
  }

  return (
    <main style={shell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>docs.dev admin</h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {user && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#8a857a' }}>
              {user.avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="" width={22} height={22} style={{ borderRadius: '50%' }} />
              )}
              {user.name}
              {user.method === 'pin' && <span style={{ fontSize: 11, color: '#b6b1a6' }}>(PIN)</span>}
            </span>
          )}
          <button onClick={logout} style={{ ...field, padding: '6px 14px', fontSize: 13, background: 'transparent', cursor: 'pointer' }}>Sign out</button>
        </span>
      </div>
      <p style={{ color: '#8a857a', marginBottom: 20 }}>Pick a page to edit, or open it on the site and hit “Edit page”.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pages.map((p) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid #EAE4DA', borderRadius: 12, background: '#fff' }}>
            <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>/{p || '(index)'}</span>
            <a href={`/docs/${p}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#8a857a' }}>View ↗</a>
            <a href={`/admin/edit?slug=${encodeURIComponent(p)}`} style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: ACCENT, padding: '7px 14px', borderRadius: 8, textDecoration: 'none' }}>Edit</a>
          </div>
        ))}
      </div>
    </main>
  );
}
