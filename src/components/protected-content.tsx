'use client';

/**
 * Body of a reading-PIN-protected page. The page itself prerenders as a lock
 * shell (title + description + this component); the content is never in the
 * static HTML. On mount we ask /api/reader/content for the page source — the
 * server checks the reader cookie (or an admin session) there — and render it
 * through the same client MDX pipeline the editor's preview uses, so an
 * unlocked page looks exactly like a published one. No cookie → the PIN form.
 */

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { LockKeyhole } from 'lucide-react';
import * as runtime from 'react/jsx-runtime';
import { getMDXComponents } from '@/components/mdx';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function stripFrontmatter(source: string): string {
  return source.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

/** Compile and render draft-grade MDX in the browser — same plugins as the
 *  published build (GFM tables, shiki highlighting, npm tabs). */
function ClientMdx({ body }: { body: string }) {
  const [Content, setContent] = useState<ComponentType<{ components?: unknown }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ evaluate }, { rehypeCode }, { remarkGfm }, { remarkNpm }, { remarkCodeTab }] = await Promise.all([
          import('@mdx-js/mdx'),
          import('fumadocs-core/mdx-plugins/rehype-code'),
          import('fumadocs-core/mdx-plugins/remark-gfm'),
          import('fumadocs-core/mdx-plugins/remark-npm'),
          import('fumadocs-core/mdx-plugins/remark-code-tab'),
        ]);
        if (cancelled) return;
        const mod = await evaluate(body, {
          Fragment: runtime.Fragment,
          jsx: runtime.jsx,
          jsxs: runtime.jsxs,
          baseUrl: window.location.href,
          remarkPlugins: [remarkGfm, remarkNpm, remarkCodeTab],
          rehypePlugins: [[rehypeCode, { lazy: true, fallbackLanguage: 'txt' }]],
        });
        if (!cancelled) setContent(() => mod.default as ComponentType<{ components?: unknown }>);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [body]);

  if (error) {
    return <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-fd-error, #dc2626)' }}>Render error: {error}</pre>;
  }
  if (!Content) return <p style={{ color: 'var(--color-fd-muted-foreground)' }}>Rendering…</p>;
  return <Content components={getMDXComponents()} />;
}

export function ProtectedContent({ slug }: { slug: string }) {
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reader/content?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = (await res.json()) as { content: string };
        setBody(stripFrontmatter(data.content));
        setState('unlocked');
        return true;
      }
    } catch {
      // fall through to the lock screen
    }
    setState('locked');
    return false;
  }, [slug]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/reader/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setPin('');
        if (await load()) return;
        setError('Unlocked, but the page failed to load — refresh and try again.');
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Invalid PIN.');
      }
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unlocked') return <ClientMdx body={body} />;

  if (state === 'checking') {
    return (
      <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        {[92, 100, 96, 60].map((w, i) => (
          <div key={i} style={{ height: 14, width: `${w}%`, borderRadius: 6, background: 'var(--color-fd-muted)', opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        border: '1px solid var(--color-fd-border)', borderRadius: 16, padding: '48px 24px',
        textAlign: 'center', marginTop: 8,
      }}
    >
      <span
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44,
          borderRadius: 12, color: ACCENT,
          background: 'color-mix(in srgb, var(--docsdev-accent, #c2571f) 10%, transparent)',
        }}
      >
        <LockKeyhole size={20} />
      </span>
      <div style={{ fontWeight: 600, fontSize: 16 }}>This page is protected</div>
      <p style={{ margin: 0, maxWidth: 380, fontSize: 14, color: 'var(--color-fd-muted-foreground)' }}>
        Enter the reading PIN you were given to view it. Unlocking lasts 30 days in this browser.
      </p>
      <form onSubmit={unlock} style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={32}
          placeholder="PIN"
          autoFocus
          style={{
            width: 150, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--color-fd-border)',
            background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 18,
            letterSpacing: '0.3em', textAlign: 'center', outline: 'none',
            fontFamily: 'var(--font-meta, ui-monospace, monospace)',
          }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '9px 16px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-fd-error, #dc2626)' }}>{error}</p>}
    </div>
  );
}
