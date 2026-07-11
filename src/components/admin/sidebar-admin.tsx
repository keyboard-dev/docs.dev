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
import { Check, FileJson2, FilePlus2, Files, GitBranch, MessagesSquare, Palette, Trash2, Upload, X } from 'lucide-react';
import { putDraft, deleteDraft } from '@/lib/drafts';
import { editorName, fetchServerDraft, listServerDrafts, primeEditorName, pushServerDraft, deleteServerDraft } from '@/lib/draft-sync';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

/* Theme picker: the accent previews live via the CSS variable (drafts and the
   editor pick it up instantly) and persists locally until published. */
const ACCENT_PRESETS = ['#c2571f', '#b91c1c', '#b45309', '#15803d', '#0f766e', '#1d4ed8', '#7c3aed', '#be185d'];
const ACCENT_PREVIEW_KEY = 'docsdev-accent-preview';

function currentAccent(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--docsdev-accent').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#c2571f';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

type PageRow = { slug: string; draftOnly: boolean; author?: string };
type BranchPageRow = { slug: string; path: string; status: 'added' | 'modified' };
type QuestionRow = { id: number; ts: number; page: string; question: string; answered: boolean; sources: number };
type QuestionStats = { total7d: number; unanswered7d: number };

function relTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

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
  const [themeOpen, setThemeOpen] = useState(false);
  const [accent, setAccent] = useState('#c2571f');
  const [themeNote, setThemeNote] = useState('');
  const [publishingTheme, setPublishingTheme] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [branchPages, setBranchPages] = useState<BranchPageRow[] | null>(null);
  const [branchNote, setBranchNote] = useState('');
  const [specsOpen, setSpecsOpen] = useState(false);
  const [specs, setSpecs] = useState<Array<{ name: string; size: number }> | null>(null);
  const [specNote, setSpecNote] = useState('');
  const [specBusy, setSpecBusy] = useState(false);
  const specFileRef = useRef<HTMLInputElement>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [questionStats, setQuestionStats] = useState<QuestionStats | null>(null);
  const [questionsAvailable, setQuestionsAvailable] = useState(true);
  const [unansweredOnly, setUnansweredOnly] = useState(false);

  // Re-apply a locally previewed (unpublished) accent for admins on load.
  useEffect(() => {
    if (!admin) return;
    const saved = localStorage.getItem(ACCENT_PREVIEW_KEY);
    if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) {
      document.documentElement.style.setProperty('--docsdev-accent', saved);
    }
    queueMicrotask(() => setAccent(saved && /^#[0-9a-fA-F]{6}$/.test(saved) ? saved.toLowerCase() : currentAccent()));
  }, [admin]);

  const applyAccent = useCallback((hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setAccent(hex.toLowerCase());
    document.documentElement.style.setProperty('--docsdev-accent', hex.toLowerCase());
    localStorage.setItem(ACCENT_PREVIEW_KEY, hex.toLowerCase());
    setThemeNote('Previewing — only you see this until you publish.');
  }, []);

  const resetAccent = useCallback(() => {
    localStorage.removeItem(ACCENT_PREVIEW_KEY);
    document.documentElement.style.removeProperty('--docsdev-accent');
    setThemeNote('');
    queueMicrotask(() => setAccent(currentAccent()));
  }, []);

  const publishTheme = useCallback(async () => {
    setPublishingTheme(true);
    setThemeNote('Publishing…');
    try {
      const res = await fetch('/api/admin/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setThemeNote(
        res.ok
          ? 'Committed — the site rebuilds with this accent; your preview stays on meanwhile.'
          : (data.error ?? 'Publish failed.'),
      );
    } catch (err) {
      setThemeNote(`Publish failed: ${(err as Error).message}`);
    } finally {
      setPublishingTheme(false);
    }
  }, [accent]);

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

  /* Ask AI insights: recent reader questions (anonymous — no identity is
     stored) with an unanswered filter. Requires the INSIGHTS D1 binding. */
  const loadQuestions = useCallback(async (unanswered: boolean) => {
    setQuestions(null);
    const res = await fetch(`/api/admin/insights?limit=50${unanswered ? '&unanswered=1' : ''}`);
    const data = (await res.json().catch(() => ({}))) as {
      available?: boolean;
      stats?: QuestionStats;
      questions?: QuestionRow[];
    };
    if (!res.ok) {
      setQuestions([]);
      return;
    }
    setQuestionsAvailable(data.available !== false);
    setQuestionStats(data.stats ?? null);
    setQuestions(data.questions ?? []);
  }, []);

  const openQuestions = useCallback(async () => {
    setOpen(false);
    setThemeOpen(false);
    setBranchesOpen(false);
    setSpecsOpen(false);
    setQuestionsOpen((o) => !o);
    setUnansweredOnly(false);
    await loadQuestions(false);
  }, [loadQuestions]);

  /* OpenAPI specs: list openapi/*.json, upload a new/updated spec (committed
     to the deploy branch — the build regenerates the API reference from it),
     and delete specs. */
  const openSpecs = useCallback(async () => {
    setOpen(false);
    setThemeOpen(false);
    setBranchesOpen(false);
    setQuestionsOpen(false);
    setSpecNote('');
    setSpecsOpen((o) => !o);
    setSpecs(null);
    const res = await fetch('/api/admin/openapi');
    const data = (await res.json().catch(() => ({}))) as { specs?: Array<{ name: string; size: number }>; error?: string };
    if (!res.ok) {
      setSpecNote(data.error ?? 'Could not list API specs.');
      setSpecs([]);
      return;
    }
    setSpecs(data.specs ?? []);
  }, []);

  const uploadSpec = useCallback(async (file: File) => {
    const name = slugify(file.name.replace(/\.json$/i, '')).replace(/[^a-z0-9-]/g, '') || 'api';
    setSpecBusy(true);
    setSpecNote(`Validating ${file.name}…`);
    try {
      const content = await file.text();
      const res = await fetch('/api/admin/openapi', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSpecNote(data.error ?? 'Upload failed.');
        return;
      }
      setSpecNote(`Committed openapi/${name}.json — the site is rebuilding; the reference updates when the deploy lands.`);
      const list = await fetch('/api/admin/openapi').then((r) => r.json()).catch(() => ({}));
      setSpecs(list.specs ?? null);
    } finally {
      setSpecBusy(false);
      if (specFileRef.current) specFileRef.current.value = '';
    }
  }, []);

  const deleteSpec = useCallback(async (name: string) => {
    if (!window.confirm(`Remove the "${name}" spec? Its reference pages disappear on the next build.`)) return;
    const res = await fetch(`/api/admin/openapi?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setSpecNote(data.error ?? 'Delete failed.');
      return;
    }
    setSpecNote(`Removed ${name} — committed; the reference updates on the next deploy.`);
    setSpecs((s) => (s ?? []).filter((x) => x.name !== name));
  }, []);

  /* Branch review: list branches, list a branch's changed docs pages, and
     load one into the shared-draft store — from there the normal preview/
     edit/publish flow applies. Read-only against git. */
  const openBranches = useCallback(async () => {
    setOpen(false);
    setThemeOpen(false);
    setSpecsOpen(false);
    setQuestionsOpen(false);
    setBranchNote('');
    setBranch(null);
    setBranchPages(null);
    setBranchesOpen((o) => !o);
    setBranches(null);
    const res = await fetch('/api/admin/branches');
    const data = (await res.json().catch(() => ({}))) as { branches?: Array<{ name: string }>; error?: string };
    if (!res.ok) {
      setBranchNote(data.error ?? 'Could not list branches.');
      setBranches([]);
      return;
    }
    setBranches((data.branches ?? []).map((b) => b.name));
  }, []);

  const pickBranch = useCallback(async (name: string) => {
    setBranch(name);
    setBranchPages(null);
    setBranchNote('');
    const res = await fetch(`/api/admin/branches?branch=${encodeURIComponent(name)}`);
    const data = (await res.json().catch(() => ({}))) as { pages?: BranchPageRow[]; error?: string };
    if (!res.ok) {
      setBranchNote(data.error ?? 'Could not compare branches.');
      setBranchPages([]);
      return;
    }
    setBranchPages(data.pages ?? []);
    if ((data.pages ?? []).length === 0) setBranchNote('No docs pages changed on this branch.');
  }, []);

  const loadBranchPage = useCallback(
    async (page: BranchPageRow) => {
      if (!branch) return;
      setBranchNote(`Loading ${page.slug}…`);
      const res = await fetch(
        `/api/admin/branches?branch=${encodeURIComponent(branch)}&slug=${encodeURIComponent(page.slug)}`,
      );
      const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
      if (!res.ok || typeof data.content !== 'string') {
        setBranchNote(data.error ?? 'Could not load the page.');
        return;
      }
      const slug = page.slug === 'index' ? '' : page.slug;
      // Re-reviewing refreshes the snapshot — but never clobber an existing
      // draft (even your own touch-ups) without an explicit OK.
      const existing = await fetchServerDraft(slug);
      if (existing && existing.content !== data.content) {
        const label = page.slug === 'index' ? 'the home page' : `"${page.slug}"`;
        if (!window.confirm(`Replace the existing draft of ${label} (by ${existing.author}) with the branch version?`)) {
          setBranchNote('Kept the existing draft.');
          return;
        }
      }
      const pushed = await pushServerDraft(slug, data.content, existing?.updatedAt ?? 0, editorName(true));
      if (!pushed.ok && 'conflict' in pushed) {
        // Raced with a save between the check and the push.
        setBranchNote(`${pushed.conflict.author} just saved a newer draft of this page — try again.`);
        return;
      }
      await putDraft(slug, data.content);
      setBranchesOpen(false);
      void refresh();
      router.push(slug ? `/docs/${slug}?edit=1` : '/docs?edit=1');
    },
    [branch, refresh, router],
  );

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
          <>
            <button
              onClick={() => {
                setNote('');
                setThemeOpen(false);
                setBranchesOpen(false);
                setSpecsOpen(false);
                setQuestionsOpen(false);
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
            </button>
            <button
              onClick={() => void openBranches()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
                border: 'none', borderRadius: 8, background: 'transparent',
                color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <GitBranch size={14} /> Branches…
            </button>
            <button
              onClick={() => void openSpecs()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
                border: 'none', borderRadius: 8, background: 'transparent',
                color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FileJson2 size={14} /> API specs…
            </button>
            <button
              onClick={() => void openQuestions()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
                border: 'none', borderRadius: 8, background: 'transparent',
                color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <MessagesSquare size={14} /> Questions…
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setBranchesOpen(false);
                setSpecsOpen(false);
                setQuestionsOpen(false);
                setThemeOpen((o) => !o);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
                border: 'none', borderRadius: 8, background: 'transparent',
                color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Palette size={14} style={{ color: ACCENT }} /> Theme…
            </button>
          </>,
          host,
        )}

      {themeOpen && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', left: 16, bottom: 64, zIndex: 95, width: 300,
            display: 'flex', flexDirection: 'column',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
            <strong style={{ fontSize: 13.5, flex: 1 }}>Theme</strong>
            <button onClick={() => setThemeOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
              Accent color — applies instantly, everywhere, including open drafts.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  title={hex}
                  onClick={() => applyAccent(hex)}
                  style={{
                    width: 28, height: 28, borderRadius: 8, background: hex, cursor: 'pointer',
                    border: accent === hex ? '2px solid var(--color-fd-foreground)' : '1px solid var(--color-fd-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  }}
                >
                  {accent === hex && <Check size={13} />}
                </button>
              ))}
              <label
                title="Custom color"
                style={{
                  width: 28, height: 28, borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
                  border: '1px dashed var(--color-fd-border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)',
                }}
              >
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => applyAccent(e.target.value)}
                  style={{ opacity: 0, width: 0, height: 0, border: 'none', padding: 0 }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={accent}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) applyAccent(v);
                  else setAccent(v);
                }}
                spellCheck={false}
                style={{
                  width: 90, height: 28, border: '1px solid var(--color-fd-border)', borderRadius: 8,
                  background: 'transparent', color: 'var(--color-fd-foreground)', fontSize: 12.5,
                  fontFamily: 'var(--font-meta, ui-monospace, monospace)', padding: '0 8px', outline: 'none',
                }}
              />
              <span style={{ width: 20, height: 20, borderRadius: 6, background: ACCENT, border: '1px solid var(--color-fd-border)' }} />
              <span style={{ flex: 1 }} />
              <button
                onClick={resetAccent}
                style={{ height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--color-fd-border)', background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 12, cursor: 'pointer' }}
              >
                Reset
              </button>
              <button
                onClick={() => void publishTheme()}
                disabled={publishingTheme || !/^#[0-9a-fA-F]{6}$/.test(accent)}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 8, border: 'none', background: ACCENT,
                  color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: publishingTheme ? 0.6 : 1,
                }}
              >
                Publish
              </button>
            </div>
          </div>

          {themeNote && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
              {themeNote}
            </div>
          )}
        </div>
      )}

      {questionsOpen && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', left: 16, bottom: 64, zIndex: 95, width: 340,
            maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
            <MessagesSquare size={13} style={{ color: 'var(--color-fd-muted-foreground)' }} />
            <strong style={{ fontSize: 13.5, flex: 1 }}>Questions</strong>
            {questionStats && questionsAvailable && (
              <span style={{ fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>
                7d: {questionStats.total7d} · {questionStats.unanswered7d} unanswered
              </span>
            )}
            <button onClick={() => setQuestionsOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          {questionsAvailable && (
            <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--color-fd-border)' }}>
              {([['All', false], ['Unanswered', true]] as const).map(([label, val]) => (
                <button
                  key={label}
                  onClick={() => {
                    setUnansweredOnly(val);
                    void loadQuestions(val);
                  }}
                  style={{
                    height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                    border: '1px solid var(--color-fd-border)',
                    background: unansweredOnly === val ? ACCENT : 'transparent',
                    color: unansweredOnly === val ? '#fff' : 'var(--color-fd-muted-foreground)',
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div style={{ overflowY: 'auto', padding: 6 }}>
            {!questionsAvailable && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>
                Insights are off — nothing is being logged. Add the <code>INSIGHTS</code> D1 binding in{' '}
                <code>wrangler.jsonc</code> (one <code>wrangler d1 create</code>) to see what readers ask.
              </div>
            )}
            {questionsAvailable &&
              (questions ?? []).map((row) => (
                <div key={row.id} style={{ padding: '7px 8px', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.35 }}>{row.question}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, fontSize: 11, color: 'var(--color-fd-muted-foreground)' }}>
                    <span
                      title={row.answered ? `Retrieval matched ${row.sources} page${row.sources === 1 ? '' : 's'}` : 'No docs matched this question'}
                      style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: row.answered ? 'var(--color-fd-success, #15803d)' : ACCENT,
                      }}
                    />
                    <span>{relTime(row.ts)}</span>
                    {row.page && (
                      <a href={row.page} style={{ color: 'inherit', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.page}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            {questionsAvailable && questions === null && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>Loading…</div>
            )}
            {questionsAvailable && questions?.length === 0 && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>
                {unansweredOnly ? 'No unanswered questions — the docs are keeping up.' : 'No questions logged yet.'}
              </div>
            )}
          </div>

          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>
            Anonymous by design: question, page, and time only — no reader identity. Pruned after 90 days.
          </div>
        </div>
      )}

      {specsOpen && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', left: 16, bottom: 64, zIndex: 95, width: 300,
            maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
            <FileJson2 size={13} style={{ color: 'var(--color-fd-muted-foreground)' }} />
            <strong style={{ fontSize: 13.5, flex: 1 }}>API specs</strong>
            <button onClick={() => setSpecsOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid var(--color-fd-border)' }}>
            <input
              ref={specFileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadSpec(file);
              }}
            />
            <button
              onClick={() => specFileRef.current?.click()}
              disabled={specBusy}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, height: 30,
                borderRadius: 8, border: 'none', background: ACCENT, color: '#fff',
                fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: specBusy ? 0.6 : 1,
              }}
            >
              <Upload size={13} /> Upload OpenAPI spec (.json)
            </button>
          </div>

          <div style={{ overflowY: 'auto', padding: 6 }}>
            {(specs ?? []).map((spec) => (
              <div
                key={spec.name}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {spec.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-fd-muted-foreground)' }}>
                  {spec.size >= 1024 ? `${Math.round(spec.size / 1024)} KB` : `${spec.size} B`}
                </span>
                <button
                  onClick={() => void deleteSpec(spec.name)}
                  title="Remove spec"
                  className="dd-icon-btn"
                  data-danger="1"
                  style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {specs === null && <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>Loading…</div>}
            {specs?.length === 0 && !specNote && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>No specs yet — upload one to generate an API reference.</div>
            )}
          </div>

          {specNote && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
              {specNote}
            </div>
          )}
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>
            Uploads commit to <code>openapi/</code>; the build regenerates /docs/api-reference from them — reuploading a name replaces that spec.
          </div>
        </div>
      )}

      {branchesOpen && (
        <div
          className="dd-pop"
          style={{
            position: 'fixed', left: 16, bottom: 64, zIndex: 95, width: 300,
            maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-fd-border)' }}>
            {branch ? (
              <button
                onClick={() => {
                  setBranch(null);
                  setBranchPages(null);
                  setBranchNote('');
                }}
                title="Back to branches"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', fontSize: 12.5, padding: 0 }}
              >
                ←
              </button>
            ) : (
              <GitBranch size={13} style={{ color: 'var(--color-fd-muted-foreground)' }} />
            )}
            <strong style={{ fontSize: 13.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {branch ?? 'Branches'}
            </strong>
            <button onClick={() => setBranchesOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ overflowY: 'auto', padding: 6 }}>
            {!branch &&
              (branches ?? []).map((name) => (
                <button
                  key={name}
                  onClick={() => void pickBranch(name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px',
                    border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer',
                    fontSize: 13, color: 'var(--color-fd-foreground)', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <GitBranch size={12} style={{ color: 'var(--color-fd-muted-foreground)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                </button>
              ))}
            {!branch && branches === null && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>Loading branches…</div>
            )}
            {!branch && branches?.length === 0 && !branchNote && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>No other branches.</div>
            )}

            {branch &&
              (branchPages ?? []).map((page) => (
                <div
                  key={page.path}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.slug === 'index' ? 'Home' : page.slug}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: page.status === 'added' ? ACCENT : 'var(--color-fd-muted-foreground)' }}>
                    {page.status === 'added' ? 'NEW' : 'EDITED'}
                  </span>
                  <button
                    onClick={() => void loadBranchPage(page)}
                    title="Load into the editor as a draft"
                    style={{
                      height: 24, padding: '0 9px', borderRadius: 7, border: 'none', background: ACCENT,
                      color: '#fff', fontWeight: 600, fontSize: 11.5, cursor: 'pointer',
                    }}
                  >
                    Review
                  </button>
                </div>
              ))}
            {branch && branchPages === null && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)' }}>Comparing with the default branch…</div>
            )}
          </div>

          {branchNote && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 12, color: 'var(--color-fd-muted-foreground)' }}>
              {branchNote}
            </div>
          )}
          {!branch && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-fd-border)', fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>
              Review docs written on a branch (e.g. by Claude Code): load a page as a draft, touch it up, publish.
            </div>
          )}
        </div>
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
