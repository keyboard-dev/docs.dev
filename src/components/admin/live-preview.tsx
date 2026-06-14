'use client';

/**
 * Live in-place preview for the drawer editor. While the drawer is open, this
 * compiles the draft MDX and renders it into the page's <article>, hiding the
 * published content — so editing raw MDX updates the page live, the same way
 * inline editing does, but for structural/markdown changes too.
 */

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import * as runtime from 'react/jsx-runtime';
import { evaluate, type EvaluateOptions } from '@mdx-js/mdx';
import { getMDXComponents } from '@/components/mdx';

const MDXComponents = getMDXComponents();

function parse(src: string): { title?: string; description?: string; body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '');
  }
  return { title: meta.title, description: meta.description, body: src.slice(m[0].length) };
}

export function LivePreview({ content }: { content: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [Body, setBody] = useState<ComponentType<{ components?: unknown }> | null>(null);
  const [meta, setMeta] = useState<{ title?: string; description?: string }>({});

  // Mount a portal host inside <article> and hide the published content.
  useEffect(() => {
    const article = document.querySelector('article');
    if (!article) return;
    const container = document.createElement('div');
    container.setAttribute('data-live-preview', '');
    article.appendChild(container);
    const style = document.createElement('style');
    style.textContent = `article > :not([data-live-preview]) { display: none !important; }`;
    document.head.appendChild(style);
    setHost(container);
    return () => {
      container.remove();
      style.remove();
      setHost(null);
    };
  }, []);

  // Recompile (debounced) as the draft changes; keep the last good render on error.
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const { title, description, body } = parse(content);
      setMeta({ title, description });
      try {
        const mod = await evaluate(body, {
          Fragment: runtime.Fragment,
          jsx: runtime.jsx,
          jsxs: runtime.jsxs,
          baseUrl: window.location.href,
        } as unknown as EvaluateOptions);
        if (active) setBody(() => mod.default as ComponentType<{ components?: unknown }>);
      } catch {
        /* mid-typing MDX is often invalid; keep the last successful render */
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [content]);

  if (!host) return null;
  return createPortal(
    <div>
      {meta.title && <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 6px' }}>{meta.title}</h1>}
      {meta.description && <p style={{ color: '#888', margin: '0 0 24px' }}>{meta.description}</p>}
      {Body ? <Body components={MDXComponents} /> : <p style={{ color: '#aaa' }}>Compiling…</p>}
    </div>,
    host,
  );
}
