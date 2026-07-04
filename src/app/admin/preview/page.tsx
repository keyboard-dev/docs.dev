'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import { evaluate, type EvaluateOptions } from '@mdx-js/mdx';
import { getMDXComponents } from '@/components/mdx';
import { getDraft } from '@/lib/drafts';

/**
 * Draft preview — renders a page exactly as it will look, using the unpublished
 * IndexedDB draft, without touching the live site. The draft MDX is compiled in
 * the browser at request time. The published page stays unchanged until you
 * hit Publish in the editor.
 */

type Frontmatter = { title?: string; description?: string };

function splitFrontmatter(source: string): { fm: Frontmatter; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: source };
  const fm: Frontmatter = {};
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) (fm as Record<string, string>)[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '');
  }
  return { fm, body: source.slice(m[0].length) };
}

const MDXComponents = getMDXComponents();

export default function PreviewPage() {
  const [slug, setSlug] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [fm, setFm] = useState<Frontmatter>({});
  const [Content, setContent] = useState<ComponentType<{ components?: unknown }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setError(null);
    setContent(null);
    // Prefer the local draft; fall back to the published file.
    const draft = await getDraft(s);
    let source = draft?.content;
    if (source == null) {
      const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(s)}`);
      source = res.ok ? ((await res.json()).content as string) : '';
    }
    setIsDraft(draft != null);

    const { fm: frontmatter, body } = splitFrontmatter(source);
    setFm(frontmatter);
    try {
      const mod = await evaluate(body, {
        Fragment: runtime.Fragment,
        jsx: runtime.jsx,
        jsxs: runtime.jsxs,
        baseUrl: window.location.href,
      } as unknown as EvaluateOptions);
      setContent(() => mod.default as ComponentType<{ components?: unknown }>);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('slug') ?? '';
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSlug(s);
    });
    void Promise.resolve().then(() => load(s));
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div>
      {/* Unpublished-draft banner */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          padding: '10px 20px',
          background: isDraft ? '#e8753b' : '#444',
          color: 'white',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        <strong>{isDraft ? '● Draft preview' : 'Published (no local draft)'}</strong>
        <span style={{ opacity: 0.85 }}>
          {isDraft
            ? 'Showing your unpublished edits — the live site is unchanged.'
            : 'No draft for this page; showing the published version.'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          <a href={`/admin?slug=${encodeURIComponent(slug)}`} style={{ color: 'white', textDecoration: 'underline' }}>
            ← Editor
          </a>
          <a href={`/docs/${slug}`} target="_blank" rel="noreferrer" style={{ color: 'white', textDecoration: 'underline' }}>
            View published ↗
          </a>
        </span>
      </div>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
          {fm.title ?? slug}
        </h1>
        {fm.description && (
          <p style={{ fontSize: 18, color: '#888', margin: '0 0 32px' }}>{fm.description}</p>
        )}
        {error ? (
          <pre style={{ color: '#e0533b', whiteSpace: 'pre-wrap' }}>Preview error: {error}</pre>
        ) : Content ? (
          <Content components={MDXComponents} />
        ) : (
          <p style={{ color: '#aaa' }}>Compiling preview…</p>
        )}
      </main>
    </div>
  );
}
