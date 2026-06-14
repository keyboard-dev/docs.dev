'use client';

/**
 * In-app editing. Mounted on every docs page but renders nothing unless the
 * visitor has an admin session. When signed in, a floating "Edit" button opens
 * a drawer to edit the current page's MDX in context — autosaving a draft to
 * IndexedDB and publishing to GitHub, exactly like /admin, but without leaving
 * the page you're reading.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  deleteDraft,
  deleteInlineEdits,
  getAsset,
  getDraft,
  getInlineEdits,
  putAsset,
  putDraft,
  setInlineEdits,
} from '@/lib/drafts';
import { applyEdits, enablePlainTextEditing, type InlineEditController } from './inline-edit-dom';
import { LivePreview } from './live-preview';
import { LayoutEditor } from '@/app/admin/layout-editor';

// Themeable accent — override --docsdev-accent in your CSS to rebrand.
const orange = 'var(--docsdev-accent, #e8753b)';

// Components the inline editor can insert. `upload` items open the file picker.
type AddItem = { label: string; snippet?: string; upload?: 'image' | 'spread' };
const ADD_ITEMS: AddItem[] = [
  { label: 'Heading', snippet: '\n\n## New section\n\n' },
  { label: 'Callout', snippet: '\n\n<Callout type="info">\nYour note here.\n</Callout>\n\n' },
  { label: 'Card grid', snippet: '\n\n<Cards>\n  <Card title="Title" href="/" />\n</Cards>\n\n' },
  {
    label: 'Tabs',
    snippet:
      '\n\n<Tabs items={[\'One\', \'Two\']}>\n\n```ts tab="One"\nconst a = 1;\n```\n\n```ts tab="Two"\nconst b = 2;\n```\n\n</Tabs>\n\n',
  },
  { label: 'Code block', snippet: '\n\n```ts title="example.ts"\nconst x = 1;\n```\n\n' },
  { label: 'Install tabs', snippet: '\n\n```package-install\nreact\n```\n\n' },
  { label: 'Divider', snippet: '\n\n---\n\n' },
  { label: 'Image…', upload: 'image' },
  { label: 'Spread (orb)', snippet: '\n\n<Spread orb side="right" width="42%">\n\nYour prose flows around the orb.\n\n</Spread>\n\n' },
  { label: 'Spread w/ image…', upload: 'spread' },
];

// "/docs" -> "", "/docs/reading-experience" -> "reading-experience"
function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

export function InlineEditor() {
  const pathname = usePathname();
  const slug = slugFromPath(pathname);

  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState('');
  const [content, setContent] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [inlineMode, setInlineMode] = useState(false);
  const [showDraft, setShowDraft] = useState(true);
  const [pageShowsDraft, setPageShowsDraft] = useState(true);
  const [drawerMode, setDrawerMode] = useState<'markdown' | 'layout'>('markdown');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const uploadModeRef = useRef<'image' | 'spread'>('image');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineCtl = useRef<InlineEditController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadContent = useCallback(async () => {
    if (slug == null) return;
    const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
    const baseline = res.ok ? ((await res.json()).content as string) : '';
    setPublished(baseline);
    const draft = await getDraft(slug);
    if (draft && draft.content !== baseline) {
      setContent(draft.content);
      setHasDraft(true);
      setStatus('Local draft loaded.');
    } else {
      setContent(baseline);
      setHasDraft(false);
      setStatus('');
    }
  }, [slug]);

  // Load the draft for this page once we know the user is an admin, so the
  // page can render the draft persistently (not just while the drawer is open).
  useEffect(() => {
    if (admin) void loadContent();
  }, [admin, loadContent]);

  // Persist any changes immediately (used by drawer textarea + layout editor).
  function saveContent(next: string) {
    setContent(next);
    if (slug == null) return;
    if (next === published) {
      void deleteDraft(slug);
      void deleteInlineEdits(slug);
      setHasDraft(false);
      setStatus('');
    } else {
      void putDraft(slug, next);
      setHasDraft(true);
      setStatus('Draft saved locally.');
    }
  }

  // Inline (click-to-edit) mode: edits are keyed by the block's published text
  // (an EditsMap), so they re-apply to the page when you come back.
  useEffect(() => {
    if (!inlineMode || slug == null) return;
    let active = true;
    (async () => {
      const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
      const baseline = res.ok ? ((await res.json()).content as string) : '';
      const map = await getInlineEdits(slug);
      const existing = await getDraft(slug);
      if (!active) return;
      setPublished(baseline);
      // Prefer an existing draft (may include drawer edits) as the merged base.
      const merged = existing?.content ?? applyEdits(baseline, map);
      setContent(merged);
      setHasDraft(merged !== baseline);
      inlineCtl.current = enablePlainTextEditing(baseline, map, merged, (nextMap, nextMerged) => {
        setContent(nextMerged);
        const dirtyNow = nextMerged !== baseline;
        setHasDraft(dirtyNow);
        void setInlineEdits(slug, nextMap);
        if (dirtyNow) void putDraft(slug, nextMerged);
        else {
          void deleteInlineEdits(slug);
          void deleteDraft(slug);
        }
        setStatus('Draft saved locally.');
      });
      inlineCtl.current.setShowDraft(showDraft);
    })();
    return () => {
      active = false;
      inlineCtl.current?.destroy();
      inlineCtl.current = null;
    };
    // showDraft handled via a separate effect so toggling doesn't rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineMode, slug]);

  // Toggle what the page shows: your draft edits, or the published text.
  useEffect(() => {
    inlineCtl.current?.setShowDraft(showDraft);
  }, [showDraft]);

  // Keep a live ref to the working source for the drop handler's closure.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Drop-to-Spread: drag an image onto a paragraph and it wraps that paragraph
  // in a <Spread image=...> so the prose flows around it. Plain, unique
  // paragraphs only — formatted/duplicate ones fall back to the drawer.
  useEffect(() => {
    if (!admin || slug == null) return;
    const accent = 'var(--docsdev-accent, #e8753b)';
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const blockUnder = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? (t.closest('article p') as HTMLElement | null) : null;
    let hovered: HTMLElement | null = null;
    const clear = () => {
      if (hovered) {
        hovered.style.outline = '';
        hovered.style.outlineOffset = '';
        hovered = null;
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e) || (e.target as Element)?.closest?.('aside')) return;
      const blk = blockUnder(e.target);
      if (!blk) {
        clear();
        return;
      }
      e.preventDefault();
      if (hovered !== blk) {
        clear();
        hovered = blk;
        blk.style.outline = `2px dashed ${accent}`;
        blk.style.outlineOffset = '4px';
      }
    };
    const onDrop = async (e: DragEvent) => {
      if (!isFileDrag(e) || (e.target as Element)?.closest?.('aside')) return;
      const blk = blockUnder(e.target);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
      clear();
      if (!blk || !file) return;
      e.preventDefault();
      const text = (blk.textContent ?? '').trim();
      let working = contentRef.current;
      if (!working) {
        const res = await fetch(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
        working = res.ok ? ((await res.json()).content as string) : '';
      }
      const idx = working.indexOf(text);
      if (text.length < 3 || idx === -1 || working.indexOf(text, idx + 1) !== -1) {
        setStatus("Can't wrap that block here (formatted or duplicated) — use the drawer.");
        return;
      }
      const dataUrl = await readDataUrl(file);
      const path = `/uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      await putAsset({ path, contentType: file.type, dataUrl });
      const block = `<Spread image="${path}" alt="${file.name}" side="right" width="42%">\n\n${text}\n\n</Spread>`;
      const next = working.slice(0, idx) + block + working.slice(idx + text.length);
      saveContent(next);
      setPageShowsDraft(true);
      setStatus('Image dropped — this paragraph now flows around it.');
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragleave', clear);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragleave', clear);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, slug]);

  function onEdit(value: string) {
    setContent(value);
    if (slug == null) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (value === published) {
        void deleteDraft(slug);
        setHasDraft(false);
        setStatus('');
      } else {
        void putDraft(slug, value);
        setHasDraft(true);
        setStatus('Draft saved locally.');
      }
    }, 400);
  }

  // Read a File as a data URL.
  function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // Insert an MDX snippet at the textarea cursor (or end), saving the draft.
  function insertSnippet(snippet: string) {
    const ta = textareaRef.current;
    const at = ta ? ta.selectionStart : content.length;
    const next = content.slice(0, at) + snippet + content.slice(at);
    saveContent(next);
    setAddMenuOpen(false);
    setDrawerMode('markdown');
  }

  // Store uploaded images locally and insert markdown (or a Spread) at the cursor.
  async function handleFiles(files: FileList | File[]) {
    const ta = textareaRef.current;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    const asSpread = uploadModeRef.current === 'spread';
    let working = content;
    let insertAt = ta ? ta.selectionStart : working.length;
    for (const file of list) {
      const dataUrl = await readDataUrl(file);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `/uploads/${Date.now()}-${safe}`;
      await putAsset({ path, contentType: file.type, dataUrl });
      const snippet = asSpread
        ? `\n\n<Spread image="${path}" alt="${file.name}" side="right" width="42%">\n\nDescribe this image — the prose here flows around it.\n\n</Spread>\n\n`
        : `\n\n![${file.name}](${path})\n\n`;
      working = working.slice(0, insertAt) + snippet + working.slice(insertAt);
      insertAt += snippet.length;
    }
    uploadModeRef.current = 'image';
    saveContent(working);
    setStatus(asSpread ? 'Spread with image added to draft.' : 'Image added to draft.');
  }

  // Collect uploaded assets referenced by the current content, for publishing.
  async function collectAssets(): Promise<Array<{ path: string; base64: string }>> {
    const paths = new Set<string>();
    for (const m of content.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
    const out: Array<{ path: string; base64: string }> = [];
    for (const path of paths) {
      const asset = await getAsset(path);
      if (asset) out.push({ path, base64: asset.dataUrl.replace(/^data:[^;]+;base64,/, '') });
    }
    return out;
  }

  async function publish() {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    try {
      const assets = await collectAssets();
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, content, assets }),
      });
      const data = (await res.json().catch(() => ({}))) as { commitUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      if (slug != null) {
        await deleteDraft(slug);
        await deleteInlineEdits(slug);
      }
      setPublished(content);
      setHasDraft(false);
      setStatus('Published — the live page rebuilds shortly.');
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function discardDraft() {
    if (slug == null) return;
    await deleteDraft(slug);
    await deleteInlineEdits(slug);
    setContent(published);
    setHasDraft(false);
    setPageShowsDraft(true);
    setStatus('Draft discarded.');
  }

  if (!admin || slug == null) return null;
  const dirty = content !== published;

  return (
    <>
      {/* Inline (click-to-edit) mode bar */}
      {inlineMode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '8px 16px',
            margin: 8,
            borderRadius: 10,
            background: orange,
            color: 'white',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: 13,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          <strong>Inline editing</strong>
          <span style={{ opacity: 0.9 }}>Click any plain paragraph to edit · formatted blocks use the drawer</span>
          <button
            onClick={() => setShowDraft((v) => !v)}
            title="Toggle between your draft edits and the published text"
            style={{ border: '1px solid rgba(255,255,255,0.6)', background: showDraft ? 'rgba(255,255,255,0.2)' : 'transparent', color: 'white', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
          >
            {showDraft ? 'Showing: Draft' : 'Showing: Published'}
          </button>
          <button onClick={publish} disabled={publishing || !dirty} style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontWeight: 600, cursor: publishing || !dirty ? 'default' : 'pointer', background: 'white', color: orange, opacity: publishing || !dirty ? 0.6 : 1 }}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          <button onClick={() => setInlineMode(false)} style={{ border: '1px solid rgba(255,255,255,0.6)', background: 'transparent', color: 'white', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
            Done
          </button>
          {status && <span style={{ opacity: 0.85 }}>{status}</span>}
        </div>
      )}

      {!open && !inlineMode && hasDraft && (
        <button
          onClick={() => setPageShowsDraft((v) => !v)}
          title="This page has an unpublished draft"
          style={{
            position: 'fixed',
            left: 20,
            bottom: 20,
            zIndex: 60,
            padding: '8px 14px',
            borderRadius: 999,
            border: `1px solid ${orange}`,
            background: pageShowsDraft ? orange : 'white',
            color: pageShowsDraft ? 'white' : orange,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
            cursor: 'pointer',
          }}
        >
          ● {pageShowsDraft ? 'Showing draft' : 'Showing published'}
        </button>
      )}

      {!open && !inlineMode && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'flex', gap: 10 }}>
          <button
            onClick={() => setInlineMode(true)}
            style={{
              padding: '12px 16px',
              borderRadius: 999,
              border: `1px solid ${orange}`,
              background: 'white',
              color: orange,
              fontWeight: 600,
              fontSize: 14,
              boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
              cursor: 'pointer',
            }}
          >
            ✎ Inline edit{hasDraft ? ' ●' : ''}
          </button>
          <button
            onClick={() => setOpen(true)}
            style={{
              padding: '12px 18px',
              borderRadius: 999,
              border: 'none',
              background: orange,
              color: 'white',
              fontWeight: 600,
              fontSize: 14,
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              cursor: 'pointer',
            }}
          >
            ✏️ Drawer
          </button>
        </div>
      )}

      {/* Render the draft into the page: live while editing, and persistently
          afterwards (until you publish, discard, or toggle to published). */}
      {(open || (hasDraft && pageShowsDraft && !inlineMode)) && <LivePreview content={content} />}

      {open && (
        <aside
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(520px, 92vw)',
            zIndex: 60,
            background: 'var(--color-fd-background, #fff)',
            borderLeft: '1px solid rgba(127,127,127,0.25)',
            boxShadow: '-12px 0 40px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(127,127,127,0.2)' }}>
            <strong style={{ fontSize: 15 }}>Editing /{slug || '(index)'}</strong>
            {hasDraft && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(232,117,59,0.15)', color: orange }}>
                local draft
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
              <a href={`/admin/preview?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: orange }}>
                Preview ↗
              </a>
              <a href={`/admin?slug=${encodeURIComponent(slug)}`} style={{ fontSize: 12, color: '#888' }}>
                Full editor ↗
              </a>
              <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          </header>

          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(127,127,127,0.15)' }}>
            {(['markdown', 'layout'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setDrawerMode(m)}
                style={{
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 7,
                  border: `1px solid ${drawerMode === m ? orange : 'rgba(127,127,127,0.4)'}`,
                  background: drawerMode === m ? orange : 'transparent',
                  color: drawerMode === m ? 'white' : 'inherit',
                  cursor: 'pointer',
                }}
              >
                {m === 'layout' ? 'Layout (drag)' : 'Markdown'}
              </button>
            ))}
          </div>

          {drawerMode === 'markdown' ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onEdit(e.target.value)}
              onDrop={(e) => {
                if (e.dataTransfer.files.length) {
                  e.preventDefault();
                  void handleFiles(e.dataTransfer.files);
                }
              }}
              spellCheck={false}
              style={{
                flex: 1,
                margin: 0,
                padding: 16,
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                lineHeight: 1.6,
                background: 'transparent',
                color: 'inherit',
              }}
            />
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              <LayoutEditor content={content} onApply={saveContent} />
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(127,127,127,0.2)' }}>
            <button
              onClick={publish}
              disabled={publishing || !dirty}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: publishing || !dirty ? '#bbb' : orange,
                color: 'white',
                fontWeight: 600,
                fontSize: 14,
                cursor: publishing || !dirty ? 'default' : 'pointer',
              }}
            >
              {publishing ? 'Publishing…' : 'Publish to GitHub'}
            </button>

            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${orange}`, background: 'transparent', color: orange, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                ＋ Add
              </button>
              {addMenuOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, minWidth: 190, background: 'var(--color-fd-background, #fff)', border: '1px solid rgba(127,127,127,0.3)', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.2)', overflow: 'hidden', zIndex: 70 }}>
                  {ADD_ITEMS.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => {
                        if (it.upload) {
                          uploadModeRef.current = it.upload;
                          setAddMenuOpen(false);
                          fileInputRef.current?.click();
                        } else {
                          insertSnippet(it.snippet!);
                        }
                      }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' }}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                uploadModeRef.current = 'image';
                fileInputRef.current?.click();
              }}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' }}
            >
              📎 Upload image
            </button>
            {hasDraft && (
              <button
                onClick={discardDraft}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', fontSize: 13, cursor: 'pointer' }}
              >
                Discard draft
              </button>
            )}
            {status && <span style={{ fontSize: 12, color: '#888', wordBreak: 'break-word' }}>{status}</span>}
          </footer>
        </aside>
      )}
    </>
  );
}
