'use client';

/**
 * Sidebar page management for admins.
 *
 * - "Pages" button injected at the bottom of the sidebar nav, opening a panel
 *   to create pages, jump to them, and delete them.
 * - New pages are born as shared drafts: they're immediately editable on
 *   their own URL (the docs route renders an admin shell for unknown slugs)
 *   and appear in the sidebar with a DRAFT dot — no build required. Publish
 *   makes them real.
 * - Draft-only pages are injected into the sidebar nav (template-cloned from
 *   the theme's own links) so navigation feels native.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { FilePlus2, Files, Trash2, X } from 'lucide-react';
import { putDraft, deleteDraft } from '@/lib/drafts';
import { editorName, listServerDrafts, pushServerDraft, deleteServerDraft } from '@/lib/draft-sync';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

type PageRow = { slug: string; draftOnly: boolean; author?: string };

export function SidebarAdmin() {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PageRow[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const injected = useRef<HTMLElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => !cancelled && setAdmin(!!d.admin))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Host container for the "Pages" button, appended after the sidebar nav.
  useEffect(() => {
    if (!admin) return;
    const anchor = document.querySelector<HTMLAnchorElement>('#nd-sidebar a[href^="/docs"]');
    const list = anchor?.parentElement;
    if (!list || !list.parentElement) return;
    const container = document.createElement('div');
    list.parentElement.insertBefore(container, list.nextSibling);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setHost(container);
    });
    return () => {
      cancelled = true;
      container.remove();
      queueMicrotask(() => setHost(null));
    };
  }, [admin]);

  const refresh = useCallback(async () => {
    const [pagesRes, drafts] = await Promise.all([
      fetch('/api/admin/pages').then((r) => (r.ok ? r.json() : { pages: [] })).catch(() => ({ pages: [] })),
      listServerDrafts(),
    ]);
    const built: string[] = pagesRes.pages ?? [];
    const draftOnly = drafts.filter((d) => !built.includes(d.slug.replace(/^\/+|\/+$/g, '') || 'index'));
    setRows([
      ...built.map((slug) => ({ slug, draftOnly: false })),
      ...draftOnly.map((d) => ({ slug: d.slug || 'index', draftOnly: true, author: d.author })),
    ]);
  }, []);

  useEffect(() => {
    if (admin) void Promise.resolve().then(refresh);
  }, [admin, refresh, pathname]);

  // Inject draft-only pages into the sidebar nav (cloned from a real link).
  useEffect(() => {
    for (const el of injected.current) el.remove();
    injected.current = [];
    if (!admin) return;
    try {
      const anchor = document.querySelector<HTMLAnchorElement>('#nd-sidebar a[href^="/docs"]');
      const list = anchor?.parentElement;
      if (!anchor || !list) return;
      for (const row of rows.filter((r) => r.draftOnly)) {
        const href = `/docs/${row.slug === 'index' ? '' : row.slug}`;
        if (list.querySelector(`a[href="${href}"]`)) continue;
        const a = anchor.cloneNode(true) as HTMLAnchorElement;
        a.setAttribute('href', href);
        a.removeAttribute('data-active');
        a.textContent = row.slug;
        const dot = document.createElement('span');
        dot.textContent = 'DRAFT';
        dot.style.cssText = `margin-left:8px;font-size:9px;font-weight:700;letter-spacing:0.05em;color:${'var(--docsdev-accent, #c2571f)'};`;
        a.appendChild(dot);
        a.addEventListener('click', (e) => {
          e.preventDefault();
          router.push(href);
        });
        list.appendChild(a);
        injected.current.push(a);
      }
    } catch {
      // sidebar markup is theme-specific; injection is best-effort
    }
    return () => {
      for (const el of injected.current) el.remove();
      injected.current = [];
    };
  }, [admin, rows, router]);

  const createPage = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    const slug = slugify(t);
    if (!slug) return;
    const content = `---\ntitle: ${t}\ndescription: \n---\n\nStart writing…\n`;
    await putDraft(slug, content);
    await pushServerDraft(slug, content, 0, editorName(true));
    setTitle('');
    setOpen(false);
    void refresh();
    router.push(`/docs/${slug}?edit=1`);
  }, [title, refresh, router]);

  const deletePage = useCallback(
    async (row: PageRow) => {
      const label = row.slug === 'index' ? 'the home page' : `"${row.slug}"`;
      if (!window.confirm(row.draftOnly ? `Delete the draft page ${label}?` : `Delete ${label}? This commits the removal to GitHub.`)) return;
      const res = await fetch(`/api/admin/pages?slug=${encodeURIComponent(row.slug === 'index' ? '' : row.slug)}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setNote(data.error ?? 'Delete failed.');
        return;
      }
      await deleteDraft(row.slug === 'index' ? '' : row.slug);
      await deleteServerDraft(row.slug === 'index' ? '' : row.slug);
      setNote(row.draftOnly ? 'Draft deleted.' : 'Deletion committed — the page disappears after the next build.');
      void refresh();
      if (pathname === `/docs/${row.slug === 'index' ? '' : row.slug}`) router.push('/docs');
    },
    [pathname, refresh, router],
  );

  if (!admin) return null;

  return (
    <>
      {host &&
        createPortal(
          <button
            onClick={() => {
              setNote('');
              setOpen((o) => !o);
              void refresh();
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
              marginTop: 4, border: 'none', borderRadius: 8, background: 'transparent',
              color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, fontWeight: 500,
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Files size={14} /> Pages…
          </button>,
          host,
        )}

      {open && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', left: 16, bottom: 64, zIndex: 95, width: 300,
            maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
            <strong style={{ fontSize: 13.5, flex: 1 }}>Pages</strong>
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid var(--color-fd-border)' }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createPage();
              }}
              placeholder="New page title…"
              style={{
                flex: 1, height: 30, border: '1px solid var(--color-fd-border)', borderRadius: 8,
                background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 13, padding: '0 10px', outline: 'none',
              }}
            />
            <button
              onClick={() => void createPage()}
              title="Create page (opens the editor)"
              style={{
                display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px',
                borderRadius: 8, border: 'none', background: ACCENT, color: '#fff',
                fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              <FilePlus2 size={13} /> Create
            </button>
          </div>

          <div style={{ overflowY: 'auto', padding: 6 }}>
            {rows.map((row) => {
              const href = `/docs/${row.slug === 'index' ? '' : row.slug}`;
              return (
                <div
                  key={row.slug + (row.draftOnly ? ':d' : '')}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      setOpen(false);
                      router.push(href);
                    }}
                    style={{ flex: 1, fontSize: 13, color: 'var(--color-fd-foreground)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {row.slug === 'index' ? 'Home' : row.slug}
                  </a>
                  {row.draftOnly && (
                    <span title={row.author ? `Draft by ${row.author}` : 'Unpublished draft'} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: ACCENT }}>
                      DRAFT
                    </span>
                  )}
                  <button
                    onClick={() => void deletePage(row)}
                    title="Delete page"
                    className="dd-icon-btn"
                    data-danger="1"
                    style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
            {rows.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>Loading…</div>}
          </div>

          {note && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
              {note}
            </div>
          )}
        </div>
      )}
    </>
  );
}
