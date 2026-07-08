'use client';

/**
 * On-page editor. Mounted on every docs page; renders nothing unless the
 * visitor is an admin. "Edit page" turns the *real* page into the editor: the
 * editable blocks are portaled into the page's own <article>, so the sidebar,
 * table of contents, header, and column width are exactly the published page's.
 *
 * Drafts stay real after you leave the editor: when an admin visits a page
 * that has unpublished local edits (or has just published, before the site
 * rebuilds), the draft is compiled through the real MDX pipeline and rendered
 * in place of the stale build — what you saw when you hit Done is what you
 * keep seeing.
 *
 * The floating toolbar carries the draft lifecycle: an Edit ↔ Preview toggle
 * (preview compiles the draft in place — never a different-looking page),
 * draft status, Discard (confirmed), Publish with clear progress, and Done.
 * All chrome uses the Fumadocs theme variables.
 */

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { Eye, Pencil } from 'lucide-react';
import * as runtime from 'react/jsx-runtime';
import { EditableDoc } from './editable-doc';
import { DeployStatusCard, forgetPublish, recallPublish, type PublishRef } from './deploy-status';
import { usePageDraft } from './use-page-draft';
import { getMDXComponents } from '@/components/mdx';
import { getDraft } from '@/lib/drafts';
import { fetchServerDraft, primeEditorName } from '@/lib/draft-sync';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

function splitFrontmatter(source: string): { title: string; description: string; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { title: '', description: '', body: source };
  const get = (key: string) =>
    (m[1]!.match(new RegExp(`^${key}:\\s*(.*)$`, 'm')) ?? [])[1]?.replace(/^["']|["']$/g, '') ?? '';
  return { title: get('title'), description: get('description'), body: source.slice(m[0].length) };
}

/** Takes over the page's own <article>: hides its (stale) children and
 *  returns a host container inside it, so anything portaled in sits in the
 *  real page chrome — sidebar, TOC, column width and all. */
function useArticleTakeover(active: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let container: HTMLElement | null = null;
    let cancelled = false;
    const style = document.createElement('style');
    style.textContent = `article > :not([data-editor]) { display: none !important; }`;
    document.head.appendChild(style);

    // Client-side navigation can swap the <article> out from under us (e.g.
    // "New page" navigates and then opens the editor), so attachment
    // self-heals: whenever the container is missing or disconnected,
    // re-attach to the current article.
    const ensure = () => {
      if (cancelled || container?.isConnected) return;
      const article = document.querySelector('article');
      if (!article) return;
      container?.remove();
      container = document.createElement('div');
      container.setAttribute('data-editor', '');
      // The article is `flex flex-col gap-4`; the takeover replaces all items.
      container.className = 'flex flex-col gap-4';
      article.appendChild(container);
      setHost(container);
    };
    queueMicrotask(ensure);
    const iv = setInterval(ensure, 400);
    return () => {
      cancelled = true;
      clearInterval(iv);
      container?.remove();
      style.remove();
      queueMicrotask(() => setHost(null));
    };
  }, [active]);

  return active ? host : null;
}

/** Renders draft MDX exactly as it will publish — same components, same
 *  remark/rehype pipeline (GFM tables, shiki highlighting), same chrome. */
function PreviewInPlace({ source }: { source: string }) {
  const [Content, setContent] = useState<ComponentType<{ components?: unknown }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { title, description, body } = splitFrontmatter(source);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Subpath imports keep node-only plugins (remark-image → node:fs)
        // out of the client bundle. remark-npm turns package-install fences
        // into the npm/pnpm/yarn/bun tabs, exactly like the build.
        const [{ evaluate }, { rehypeCode }, { remarkGfm }, { remarkNpm }, { remarkCodeTab }] = await Promise.all([
          import('@mdx-js/mdx'),
          import('fumadocs-core/mdx-plugins/rehype-code'),
          import('fumadocs-core/mdx-plugins/remark-gfm'),
          import('fumadocs-core/mdx-plugins/remark-npm'),
          import('fumadocs-core/mdx-plugins/remark-code-tab'),
        ]);
        if (cancelled) return;
        setContent(null);
        setError(null);
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75em] font-semibold">{title}</h1>
      {description && <p className="mb-0 text-lg text-fd-muted-foreground">{description}</p>}
      <div className="flex flex-row gap-2 items-center border-b pb-6" aria-hidden>
        <div style={{ height: 30, width: 132, borderRadius: 8, background: 'var(--color-fd-muted)', opacity: 0.5 }} />
        <div style={{ height: 30, width: 74, borderRadius: 8, background: 'var(--color-fd-muted)', opacity: 0.5 }} />
      </div>
      <div className="prose flex-1">
        {error ? (
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-fd-error, #dc2626)' }}>Preview error: {error}</pre>
        ) : Content ? (
          <Content components={getMDXComponents()} />
        ) : (
          <p style={{ color: 'var(--color-fd-muted-foreground)' }}>Rendering…</p>
        )}
      </div>
    </div>
  );
}

function EditOverlay({ slug, onDone }: { slug: string; onDone: (source: string, published: boolean) => void }) {
  const { source, revision, status, publishing, conflict, lastPublish, dismissPublishInfo, onChange, discard, publish, adoptConflict, overwriteConflict, getCurrent } = usePageDraft(slug);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  // Snapshot of the draft for preview mode (kept in sync when toggling).
  const [previewSource, setPreviewSource] = useState('');
  const host = useArticleTakeover(true);
  const published = status.startsWith('Published');

  // Commit any in-progress field edit before a lifecycle action (some
  // browsers don't move focus to buttons on click, so blur wouldn't fire).
  const commitFocused = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el?.isContentEditable) el.blur();
  };

  const showPreview = useCallback(() => {
    commitFocused();
    setPreviewSource(getCurrent());
    setMode('preview');
  }, [getCurrent]);

  const onDiscard = useCallback(() => {
    if (!window.confirm('Discard your local draft and return to the published version?')) return;
    void discard();
    setMode('edit');
  }, [discard]);

  const seg = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
    borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? 'var(--color-fd-primary)' : 'transparent',
    color: active ? 'var(--color-fd-primary-foreground)' : 'var(--color-fd-muted-foreground)',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  });
  const ghost: React.CSSProperties = {
    height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-fd-border)',
    background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 13, cursor: 'pointer',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  };

  return (
    <>
      {host &&
        source != null &&
        createPortal(
          mode === 'edit' ? (
            <EditableDoc key={`${slug}:${revision}`} source={source} onChange={onChange} />
          ) : (
            <PreviewInPlace source={previewSource} />
          ),
          host,
        )}
      <div
        className="dd-pop"
        style={{
          position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
          fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
        }}
      >
        <div style={{ display: 'flex', gap: 2, background: 'var(--color-fd-muted)', borderRadius: 9, padding: 2 }}>
          <button style={seg(mode === 'edit')} onClick={() => setMode('edit')}>
            <Pencil size={12} /> Edit
          </button>
          <button style={seg(mode === 'preview')} onClick={showPreview}>
            <Eye size={12} /> Preview
          </button>
        </div>
        {status && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)', maxWidth: 340 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flex: 'none',
                background: conflict ? 'var(--color-fd-error, #dc2626)' : published ? 'var(--color-fd-success, #16a34a)' : ACCENT,
              }}
            />
            {status}
          </span>
        )}
        {conflict && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void adoptConflict()} style={{ ...ghost, height: 26, fontSize: 12 }}>
              Load theirs
            </button>
            <button onClick={() => void overwriteConflict()} style={{ ...ghost, height: 26, fontSize: 12 }}>
              Keep mine
            </button>
          </span>
        )}
        <button onClick={onDiscard} style={ghost}>Discard</button>
        <button
          onClick={() => {
            commitFocused();
            publish();
          }}
          disabled={publishing}
          style={{
            height: 30, padding: '0 14px', borderRadius: 8, border: 'none',
            background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13,
            cursor: publishing ? 'default' : 'pointer', opacity: publishing ? 0.7 : 1,
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button
          onClick={() => {
            commitFocused();
            onDone(getCurrent(), published);
          }}
          style={ghost}
        >
          Done
        </button>
      </div>
      {lastPublish && (
        <DeployStatusCard
          publish={lastPublish}
          onDismiss={dismissPublishInfo}
          style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 89 }}
        />
      )}
    </>
  );
}

/** The same deploy-status card, shown after the editor closes — anchored to
 *  the "Edit page / PUBLISHED ✓" pill while the publish makes its way live. */
function PublishedStatusFloat({ slug }: { slug: string }) {
  const [publish, setPublish] = useState<PublishRef | null>(() =>
    typeof window === 'undefined' ? null : recallPublish(slug),
  );
  if (!publish) return null;
  return (
    <DeployStatusCard
      publish={publish}
      onDismiss={() => {
        forgetPublish();
        setPublish(null);
      }}
      style={{ position: 'fixed', right: 20, bottom: 72, zIndex: 60 }}
    />
  );
}

type Override = { slug: string; source: string; kind: 'draft' | 'published'; author?: string };

export function InlineEditor() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slug = slugFromPath(pathname);
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  // When set, the article shows this source instead of the (stale) build:
  // an unpublished local draft, or freshly-published content awaiting deploy.
  const [override, setOverride] = useState<Override | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setAdmin(!!d.admin);
        if (d.user?.method === 'github') primeEditorName(d.user.name || d.user.login);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the draft (local cache or a teammate's shared draft — newest wins)
  // whenever we're on a page and not editing.
  useEffect(() => {
    if (!admin || slug == null || open) return;
    let cancelled = false;
    Promise.all([getDraft(slug), fetchServerDraft(slug)])
      .then(([local, remote]) => {
        if (cancelled) return;
        const localAt = local?.updatedAt ?? 0;
        const remoteAt = remote?.updatedAt ?? 0;
        if (remote && remoteAt >= localAt) {
          setOverride({ slug, source: remote.content, kind: 'draft', author: remote.author });
        } else if (local) {
          setOverride({ slug, source: local.content, kind: 'draft' });
        } else {
          setOverride((prev) => (prev && prev.kind === 'published' && prev.slug === slug ? prev : null));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [admin, slug, open]);

  // ?edit=1 opens the editor directly (used by "New page").
  useEffect(() => {
    if (!(admin && slug != null && searchParams.get('edit'))) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [admin, slug, searchParams]);

  const showOverride = !open && admin && slug != null && override != null && override.slug === slug;
  const liveHost = useArticleTakeover(showOverride);

  // Generated API reference pages are built from the OpenAPI schema — the
  // source of truth is openapi/*.json, so in-site editing is disabled there.
  const [apiPage, setApiPage] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setApiPage(!!document.querySelector('article [data-api-page]')));
  }, [slug]);

  if (!admin || slug == null || apiPage) return null;

  return (
    <>
      {showOverride && liveHost && createPortal(<PreviewInPlace source={override.source} />, liveHost)}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 18px', borderRadius: 999, border: 'none', background: ACCENT, color: '#fff',
            fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer',
          }}
        >
          <Pencil size={14} /> Edit page
          {showOverride && (
            <span
              title={
                override.kind === 'draft'
                  ? `Showing an unpublished draft${override.author ? ` by ${override.author}` : ''} — the live site is unchanged`
                  : 'Published — showing the new version while the site rebuilds'
              }
              style={{
                marginLeft: 2, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '2px 8px',
              }}
            >
              {override.kind === 'draft' ? 'DRAFT' : 'PUBLISHED ✓'}
            </span>
          )}
        </button>
      )}
      {!open && showOverride && override.kind === 'published' && <PublishedStatusFloat slug={slug} />}
      {open && (
        <EditOverlay
          slug={slug}
          onDone={(source, published) => {
            if (published) setOverride({ slug, source, kind: 'published' });
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
