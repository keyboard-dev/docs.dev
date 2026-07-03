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
        <p style={{ color: '#8a857a', marginBottom: 24 }}>Enter the PIN to edit content.</p>
        <form onSubmit={login} style={{ display: 'flex', gap: 12 }}>
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={8} placeholder="PIN" autoFocus style={{ ...field, fontSize: 22, letterSpacing: '0.4em', width: 160, textAlign: 'center' }} />
          <button type="submit" style={{ ...field, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Sign in</button>
        </form>
        {error && <p style={{ color: '#c0392b', marginTop: 16 }}>{error}</p>}
        <p style={{ color: '#b6b1a6', marginTop: 32, fontSize: 13 }}>Proof of concept — default PIN is <code>1234</code>.</p>
      </main>
    );
  }

  return (
    <main style={shell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>docs.dev admin</h1>
        <button onClick={logout} style={{ ...field, padding: '6px 14px', fontSize: 13, background: 'transparent', cursor: 'pointer' }}>Sign out</button>
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
