'use client';

/**
 * The landing page's editor — the same unified editing experience as docs
 * pages, applied to the section list in content/landing.json:
 *
 *   - "Edit layout" turns the *real* page into the editor: every text node
 *     is a contentEditable field with the exact published classes.
 *   - Sections behave like a document editor: hover between sections for
 *     the insert rail (with templates — hero, flowing prose + figure,
 *     feature grid, quote, CTA banner), and every section has move up/down
 *     and delete controls.
 *   - Flow figures are full Spreads: drag to either side and vertically,
 *     resize from the corner (the prose reflows live through pretext), and
 *     swap between orb / image / code from the selection chip. Images
 *     upload into the drafts store and publish as real files.
 *   - Drafts behave exactly like page drafts: instant IndexedDB autosave,
 *     debounced sync to the shared drafts store under the reserved
 *     `_landing` slug, conflict handling, and the same toolbar: Edit ↔
 *     Preview, draft status, Discard, Publish with deploy detection, Done.
 *   - Publish commits content/landing.json (plus uploaded figure images)
 *     via /api/admin/layout.
 */

import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  FIGURE_MAX_W,
  FIGURE_MIN_W,
  LANDING_DRAFT_SLUG,
  SECTION_TEMPLATES,
  figureHeight,
  sanitizeLandingCopy,
  type FlowFigure,
  type FlowSection,
  type LandingCopy,
  type LandingCta,
  type LandingSection,
} from '@/lib/landing';
import { deleteDraft, getAsset, getDraft, putAsset, putDraft } from '@/lib/drafts';
import {
  deleteServerDraft,
  editorName,
  fetchServerDraft,
  pushServerDraft,
  type RemoteDraft,
} from '@/lib/draft-sync';
import { Flow } from '@/components/pretext/flow';
import { FigureVisual, LandingView, codePreStyle, ctaClass, figureObstacle, sectionClass } from './landing';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const PUSH_DEBOUNCE_MS = 2500;
const LIVE_POLL_MS = 8000;
const LIVE_POLL_MAX_MS = 5 * 60 * 1000;
const DEFAULT_CODE = "const docs = own('repo');\ndeploy(docs, 'cloudflare');";
const uploadPathFor = (file: File) => `/uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

/* ------------------------------------------------------------------ */
/* draft lifecycle — the landing twin of use-page-draft                 */
/* ------------------------------------------------------------------ */

export type LandingDraft = ReturnType<typeof useLandingDraft>;

function parseCopy(json: string): LandingCopy | null {
  try {
    return sanitizeLandingCopy(JSON.parse(json));
  } catch {
    return null;
  }
}

export function useLandingDraft(published: LandingCopy, admin: boolean) {
  const [publishedJson, setPublishedJson] = useState(() => JSON.stringify(published));
  const [copy, setCopy] = useState(published);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState<RemoteDraft | null>(null);
  const [author, setAuthor] = useState<string | undefined>(undefined);
  const draftRef = useRef(JSON.stringify(published));
  const serverBase = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const conflictRef = useRef<RemoteDraft | null>(null);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  const stopLivePoll = () => {
    if (livePoll.current) clearInterval(livePoll.current);
    livePoll.current = null;
  };
  useEffect(
    () => () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      stopLivePoll();
    },
    [],
  );

  // Load the newest draft — local cache or a teammate's shared draft.
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    (async () => {
      const [local, remote] = await Promise.all([getDraft(LANDING_DRAFT_SLUG), fetchServerDraft(LANDING_DRAFT_SLUG)]);
      if (cancelled) return;
      const localAt = local?.updatedAt ?? 0;
      const remoteAt = remote?.updatedAt ?? 0;
      serverBase.current = remoteAt;
      let json: string | null = null;
      let note = '';
      if (remote && remoteAt >= localAt && remote.content !== draftRef.current) {
        json = remote.content;
        note = `Draft by ${remote.author} · shared`;
        setAuthor(remote.author);
        void putDraft(LANDING_DRAFT_SLUG, remote.content);
      } else if (local && local.content !== draftRef.current) {
        json = local.content;
        note = 'Draft · saved locally';
      }
      if (json) {
        const parsed = parseCopy(json);
        if (parsed) {
          draftRef.current = JSON.stringify(parsed);
          setCopy(parsed);
          setRevision((r) => r + 1);
          setStatus(note);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [admin]);

  const pushNow = useCallback(async () => {
    if (conflictRef.current) return;
    const content = draftRef.current;
    const result = await pushServerDraft(LANDING_DRAFT_SLUG, content, serverBase.current, editorName(true));
    if (result.ok) {
      serverBase.current = result.updatedAt;
      setStatus('Draft · synced with team');
    } else if ('conflict' in result) {
      setConflict(result.conflict);
      setStatus(`${result.conflict.author} saved a newer draft of this page`);
    } else {
      setStatus('Draft · saved locally (sync unavailable)');
    }
  }, []);

  const onChange = useCallback(
    (next: LandingCopy) => {
      const json = JSON.stringify(next);
      draftRef.current = json;
      setCopy(next);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      if (json === publishedJson) {
        void deleteDraft(LANDING_DRAFT_SLUG);
        void deleteServerDraft(LANDING_DRAFT_SLUG);
        serverBase.current = 0;
        setStatus('');
        return;
      }
      void putDraft(LANDING_DRAFT_SLUG, json);
      setStatus((s) => (s.includes('newer draft') ? s : 'Draft · saving…'));
      pushTimer.current = setTimeout(() => void pushNow(), PUSH_DEBOUNCE_MS);
    },
    [publishedJson, pushNow],
  );

  const discard = useCallback(async () => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    await deleteDraft(LANDING_DRAFT_SLUG);
    await deleteServerDraft(LANDING_DRAFT_SLUG);
    const parsed = parseCopy(publishedJson) ?? published;
    draftRef.current = publishedJson;
    serverBase.current = 0;
    setConflict(null);
    setAuthor(undefined);
    setCopy(parsed);
    setRevision((r) => r + 1);
    setStatus('');
  }, [published, publishedJson]);

  /** Adopt the teammate's conflicting draft (theirs wins). */
  const adoptConflict = useCallback(async () => {
    const c = conflictRef.current;
    if (!c) return;
    const parsed = parseCopy(c.content);
    if (!parsed) return;
    serverBase.current = c.updatedAt;
    draftRef.current = JSON.stringify(parsed);
    await putDraft(LANDING_DRAFT_SLUG, draftRef.current);
    setCopy(parsed);
    setRevision((r) => r + 1);
    setConflict(null);
    setStatus(`Loaded ${c.author}'s draft`);
  }, []);

  /** Keep our version (ours wins — overwrites the teammate's server draft). */
  const overwriteConflict = useCallback(async () => {
    const c = conflictRef.current;
    if (!c) return;
    serverBase.current = c.updatedAt;
    setConflict(null);
    const result = await pushServerDraft(LANDING_DRAFT_SLUG, draftRef.current, c.updatedAt, editorName(true));
    if (result.ok) {
      serverBase.current = result.updatedAt;
      setStatus('Draft · synced with team');
    }
  }, []);

  const publish = useCallback(async () => {
    setPublishing(true);
    setStatus('Committing to GitHub…');
    if (pushTimer.current) clearTimeout(pushTimer.current);
    try {
      // Uploaded figure images live in IndexedDB until published — collect
      // every /uploads/ path referenced by the copy and ship the files along
      // (same mechanism as publishing a docs page).
      const paths = new Set<string>();
      for (const m of draftRef.current.matchAll(/\/uploads\/[a-zA-Z0-9._/-]+/g)) paths.add(m[0]);
      const assets: Array<{ path: string; base64: string }> = [];
      for (const path of paths) {
        const a = await getAsset(path);
        if (a) assets.push({ path, base64: a.dataUrl.replace(/^data:[^;]+;base64,/, '') });
      }

      // Snapshot the currently-built page so we can detect the redeploy.
      const before = await fetch('/', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);

      const res = await fetch('/api/admin/layout', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ copy: JSON.parse(draftRef.current), assets }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Publish failed.');
      await deleteDraft(LANDING_DRAFT_SLUG);
      await deleteServerDraft(LANDING_DRAFT_SLUG);
      serverBase.current = 0;
      setConflict(null);
      setAuthor(undefined);
      setPublishedJson(draftRef.current);
      setStatus('Published ✓ — deploying…');

      stopLivePoll();
      const startedAt = Date.now();
      livePoll.current = setInterval(async () => {
        if (Date.now() - startedAt > LIVE_POLL_MAX_MS) {
          stopLivePoll();
          setStatus('Published ✓ — deploy is taking a while; it will land shortly.');
          return;
        }
        const now = await fetch('/', { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : null))
          .catch(() => null);
        if (now != null && before != null && now !== before) {
          stopLivePoll();
          setStatus('Live ✓ — the published site is up to date.');
        }
      }, LIVE_POLL_MS);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, []);

  const dirty = useMemo(() => JSON.stringify(copy) !== publishedJson, [copy, publishedJson]);

  return {
    copy,
    revision,
    status,
    publishing,
    conflict,
    dirty,
    author,
    onChange,
    discard,
    publish,
    adoptConflict,
    overwriteConflict,
    getCurrent: () => parseCopy(draftRef.current) ?? copy,
  };
}

/* ------------------------------------------------------------------ */
/* editable fields (plain text, same identity trick as the doc editor)  */
/* ------------------------------------------------------------------ */

/** Setting innerHTML on every render would blow the caret away; cache the
 *  object per field so unchanged content keeps the same identity and React
 *  leaves the DOM alone (same approach as editable-doc's stableHtml). */
const htmlObjCache = new Map<string, { __html: string }>();
function stableHtml(id: string, html: string): { __html: string } {
  const cur = htmlObjCache.get(id);
  if (cur && cur.__html === html) return cur;
  const next = { __html: html };
  htmlObjCache.set(id, next);
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readText(el: HTMLElement, single: boolean): string {
  const t = (el.innerText ?? '').replace(/ /g, ' ');
  return single ? t.replace(/\s*\n\s*/g, ' ').trim() : t.replace(/\n+$/, '');
}

type FieldHandlers = { onLive: (text: string) => void; onCommit: (text: string) => void };

function F({
  id,
  tag,
  text,
  single = true,
  className = '',
  style,
  placeholder,
  onLive,
  onCommit,
}: {
  id: string;
  tag: string;
  text: string;
  single?: boolean;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
} & FieldHandlers) {
  return createElement(tag, {
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    className: `dd-field ${className}`.trim(),
    style: single ? style : { whiteSpace: 'pre-wrap', ...style },
    'data-placeholder': placeholder ?? '',
    onInput: (e: React.FormEvent<HTMLElement>) => onLive(readText(e.currentTarget, single)),
    onBlur: (e: React.FocusEvent<HTMLElement>) => onCommit(readText(e.currentTarget, single)),
    dangerouslySetInnerHTML: stableHtml(id, escapeHtml(text)),
  });
}

function focusEnd(el: HTMLElement | null) {
  if (!el || document.activeElement === el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

const chipInput: CSSProperties = {
  height: 22,
  width: 150,
  border: '1px solid var(--color-fd-border)',
  borderRadius: 6,
  background: 'var(--color-fd-popover)',
  color: 'var(--color-fd-foreground)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  padding: '0 6px',
  outline: 'none',
};

const chipSelect: CSSProperties = {
  height: 22,
  border: '1px solid var(--color-fd-border)',
  borderRadius: 6,
  background: 'var(--color-fd-popover)',
  color: 'var(--color-fd-muted-foreground)',
  fontSize: 11,
  padding: '0 4px',
  outline: 'none',
  cursor: 'pointer',
};

/* ------------------------------------------------------------------ */
/* the editable page                                                    */
/* ------------------------------------------------------------------ */

type Apply = (c: LandingCopy, text: string) => LandingCopy;

/** Immutable update of one section. */
function withSection(c: LandingCopy, i: number, update: (s: LandingSection) => LandingSection): LandingCopy {
  return { ...c, sections: c.sections.map((s, j) => (j === i ? update(s) : s)) };
}

/** Uncontrolled twin of LandingView: same sections, same classes, but every
 *  text node is a field, sections insert/move/delete like a document editor,
 *  and flow figures drag/resize/swap in place. Emits the full LandingCopy on
 *  every change; never re-reads `initial` (the parent remounts it via the
 *  draft revision key on load/discard/adopt). */
function LandingEditable({ initial, onChange }: { initial: LandingCopy; onChange: (next: LandingCopy) => void }) {
  const uid = useId();
  const [copy, setCopyState] = useState(initial);
  const stateRef = useRef(copy);
  useEffect(() => {
    stateRef.current = copy;
  }, [copy]);
  const live = useRef<Record<string, { text: string; apply: Apply }>>({});
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (emitTimer.current) clearTimeout(emitTimer.current);
    },
    [],
  );

  const emitNow = useCallback(() => {
    let c = stateRef.current;
    for (const { text, apply } of Object.values(live.current)) c = apply(c, text);
    onChange(c);
  }, [onChange]);

  const scheduleEmit = useCallback(() => {
    if (emitTimer.current) clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(emitNow, 500);
  }, [emitNow]);

  /** Wire a text field: live keystrokes autosave through refs (no re-render,
   *  the caret stays put); blur commits into state. */
  const bind = useCallback(
    (id: string, apply: Apply): FieldHandlers => ({
      onLive: (text) => {
        live.current[id] = { text, apply };
        scheduleEmit();
      },
      onCommit: (text) => {
        delete live.current[id];
        const next = apply(stateRef.current, text);
        stateRef.current = next;
        setCopyState(next);
        if (emitTimer.current) clearTimeout(emitTimer.current);
        emitNow();
      },
    }),
    [scheduleEmit, emitNow],
  );

  /** Structural change (sections, buttons, cards, figure geometry). */
  const structural = useCallback(
    (next: LandingCopy) => {
      stateRef.current = next;
      setCopyState(next);
      emitNow();
    },
    [emitNow],
  );

  /* ---------------- section operations ---------------- */

  const insertSection = useCallback(
    (at: number, section: LandingSection) => {
      const sections = [...stateRef.current.sections];
      sections.splice(at, 0, section);
      structural({ ...stateRef.current, sections });
    },
    [structural],
  );

  const removeSection = useCallback(
    (i: number) => {
      structural({ ...stateRef.current, sections: stateRef.current.sections.filter((_, j) => j !== i) });
    },
    [structural],
  );

  const moveSection = useCallback(
    (i: number, dir: -1 | 1) => {
      const sections = [...stateRef.current.sections];
      const j = i + dir;
      if (j < 0 || j >= sections.length) return;
      const [s] = sections.splice(i, 1);
      sections.splice(j, 0, s!);
      structural({ ...stateRef.current, sections });
    },
    [structural],
  );

  /* ---------------- image upload (docs-editor pattern) ---------------- */

  const fileInput = useRef<HTMLInputElement>(null);
  const fileFor = useRef<number | null>(null);
  const pickImage = (i: number) => {
    fileFor.current = i;
    fileInput.current?.click();
  };
  async function onFile(file: File) {
    const i = fileFor.current;
    if (i == null || !file.type.startsWith('image/')) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const path = uploadPathFor(file);
    await putAsset({ path, contentType: file.type, dataUrl });
    const s = stateRef.current.sections[i];
    if (s?.type === 'flow') {
      structural(
        withSection(stateRef.current, i, (sec) => ({
          ...(sec as FlowSection),
          figure: { ...(sec as FlowSection).figure, kind: 'image', src: path, alt: file.name },
        })),
      );
    }
  }

  /* ---------------- per-type editable sections ---------------- */

  const ctaStyles: Array<{ v: LandingCta['style']; label: string }> = [
    { v: 'primary', label: 'Filled' },
    { v: 'outline', label: 'Outline' },
    { v: 'text', label: 'Text' },
  ];

  const ctaRow = (i: number, ctas: LandingCta[], setCtas: (next: LandingCta[]) => void) => (
    <>
      {ctas.map((cta, k) => (
        <span key={k} style={{ position: 'relative', display: 'inline-flex' }}>
          <F
            id={`${uid}:s${i}.cta${k}`}
            tag="span"
            text={cta.label}
            className={ctaClass(cta.style)}
            placeholder="Label"
            style={{ cursor: 'text' }}
            {...bind(`s${i}.cta${k}`, (c, t) =>
              withSection(c, i, (sec) => {
                const list = (sec as { ctas: LandingCta[] }).ctas.map((x, j) => (j === k ? { ...x, label: t } : x));
                return { ...sec, ctas: list } as LandingSection;
              }),
            )}
          />
          <span
            className="dd-langchip dd-pop"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 70, display: 'flex', gap: 4, padding: 4, alignItems: 'center' }}
          >
            <input
              value={cta.href}
              placeholder="/docs or https://…"
              spellCheck={false}
              onChange={(e) => setCtas(ctas.map((x, j) => (j === k ? { ...x, href: e.target.value } : x)))}
              style={chipInput}
            />
            <select
              value={cta.style}
              onChange={(e) => setCtas(ctas.map((x, j) => (j === k ? { ...x, style: e.target.value as LandingCta['style'] } : x)))}
              style={chipSelect}
            >
              {ctaStyles.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setCtas(ctas.filter((_, j) => j !== k))}
              title="Remove button"
              className="dd-icon-btn"
              data-danger="1"
              style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
            >
              <Trash2 size={11} />
            </button>
          </span>
        </span>
      ))}
      {ctas.length < 4 && (
        <button
          onClick={() => setCtas([...ctas, { label: 'New button', href: '/docs', style: 'outline' }])}
          title="Add a button"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '10px 12px', borderRadius: 12,
            border: '1px dashed var(--color-fd-border)', background: 'transparent',
            color: 'var(--color-fd-muted-foreground)', fontSize: 13, cursor: 'pointer',
          }}
        >
          <Plus size={12} /> Button
        </button>
      )}
    </>
  );

  function renderSection(s: LandingSection, i: number) {
    switch (s.type) {
      case 'hero':
        return (
          <>
            <F
              id={`${uid}:s${i}.eyebrow`}
              tag="p"
              text={s.eyebrow}
              className="mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--docsdev-accent,#e8753b)]"
              placeholder="Eyebrow"
              {...bind(`s${i}.eyebrow`, (c, t) => withSection(c, i, (sec) => ({ ...sec, eyebrow: t }) as LandingSection))}
            />
            <F
              id={`${uid}:s${i}.title`}
              tag="h1"
              text={s.titleLines.join('\n')}
              single={false}
              className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]"
              placeholder="Page title"
              {...bind(`s${i}.title`, (c, t) =>
                withSection(c, i, (sec) => ({ ...sec, titleLines: t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3) }) as LandingSection),
              )}
            />
            <F
              id={`${uid}:s${i}.tagline`}
              tag="p"
              text={s.tagline}
              className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-fd-muted-foreground"
              placeholder="Tagline"
              {...bind(`s${i}.tagline`, (c, t) => withSection(c, i, (sec) => ({ ...sec, tagline: t }) as LandingSection))}
            />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {ctaRow(i, s.ctas, (ctas) => structural(withSection(stateRef.current, i, (sec) => ({ ...sec, ctas }) as LandingSection)))}
            </div>
          </>
        );
      case 'flow':
        return (
          <EditFlowSection
            key={`${uid}:s${i}.flowsec`}
            idBase={`${uid}:s${i}`}
            section={s}
            onFigure={(figure) => structural(withSection(stateRef.current, i, (sec) => ({ ...sec, figure }) as LandingSection))}
            onPickImage={() => pickImage(i)}
            codeBind={bind(`s${i}.figcode`, (c, t) =>
              withSection(c, i, (sec) => ({ ...sec, figure: { ...(sec as FlowSection).figure, code: t } }) as LandingSection),
            )}
            textBind={bind(`s${i}.text`, (c, t) => withSection(c, i, (sec) => ({ ...sec, text: t }) as LandingSection))}
          />
        );
      case 'features':
        return (
          <>
            <F
              id={`${uid}:s${i}.heading`}
              tag="h2"
              text={s.heading}
              className="mb-8 text-[26px] font-bold tracking-[-0.01em]"
              placeholder="Section heading"
              {...bind(`s${i}.heading`, (c, t) => withSection(c, i, (sec) => ({ ...sec, heading: t }) as LandingSection))}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((f, k) => (
                <div key={k} className="rounded-2xl border border-fd-border p-5" style={{ position: 'relative' }}>
                  <F
                    id={`${uid}:s${i}.f${k}.title`}
                    tag="h3"
                    text={f.title}
                    className="mb-2 text-[15px] font-semibold"
                    placeholder="Feature title"
                    {...bind(`s${i}.f${k}.title`, (c, t) =>
                      withSection(c, i, (sec) => ({
                        ...sec,
                        items: (sec as { items: typeof s.items }).items.map((x, j) => (j === k ? { ...x, title: t } : x)),
                      }) as LandingSection),
                    )}
                  />
                  <F
                    id={`${uid}:s${i}.f${k}.body`}
                    tag="p"
                    text={f.body}
                    className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground"
                    placeholder="What it does and why it matters."
                    {...bind(`s${i}.f${k}.body`, (c, t) =>
                      withSection(c, i, (sec) => ({
                        ...sec,
                        items: (sec as { items: typeof s.items }).items.map((x, j) => (j === k ? { ...x, body: t } : x)),
                      }) as LandingSection),
                    )}
                  />
                  <span
                    className="dd-langchip dd-pop"
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', left: 10, bottom: -13, zIndex: 70, display: 'flex', gap: 4, padding: 4, alignItems: 'center' }}
                  >
                    <input
                      value={f.href}
                      placeholder="/docs/…"
                      spellCheck={false}
                      onChange={(e) =>
                        structural(
                          withSection(stateRef.current, i, (sec) => ({
                            ...sec,
                            items: (sec as { items: typeof s.items }).items.map((x, j) => (j === k ? { ...x, href: e.target.value } : x)),
                          }) as LandingSection),
                        )
                      }
                      style={chipInput}
                    />
                    <button
                      onClick={() =>
                        structural(
                          withSection(stateRef.current, i, (sec) => ({
                            ...sec,
                            items: (sec as { items: typeof s.items }).items.filter((_, j) => j !== k),
                          }) as LandingSection),
                        )
                      }
                      title="Remove feature"
                      className="dd-icon-btn"
                      data-danger="1"
                      style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
              ))}
              {s.items.length < 12 && (
                <button
                  onClick={() =>
                    structural(
                      withSection(stateRef.current, i, (sec) => ({
                        ...sec,
                        items: [...(sec as { items: typeof s.items }).items, { title: 'New feature', body: 'What it does and why it matters.', href: '/docs' }],
                      }) as LandingSection),
                    )
                  }
                  title="Add a feature card"
                  className="rounded-2xl p-5"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 96,
                    border: '1px dashed var(--color-fd-border)', background: 'transparent',
                    color: 'var(--color-fd-muted-foreground)', fontSize: 13.5, cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Feature
                </button>
              )}
            </div>
          </>
        );
      case 'quote':
        return (
          <div className="mx-auto max-w-[640px] text-center">
            <div aria-hidden className="font-mono text-[44px] leading-none text-[var(--docsdev-accent,#e8753b)]">
              &ldquo;
            </div>
            <F
              id={`${uid}:s${i}.qtext`}
              tag="p"
              text={s.text}
              className="m-0 mt-1 text-[21px] font-medium leading-relaxed"
              placeholder="The quote"
              {...bind(`s${i}.qtext`, (c, t) => withSection(c, i, (sec) => ({ ...sec, text: t }) as LandingSection))}
            />
            <p className="mt-5 text-[14px] text-fd-muted-foreground" style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
              <F
                id={`${uid}:s${i}.qname`}
                tag="span"
                text={s.name}
                placeholder="Name"
                {...bind(`s${i}.qname`, (c, t) => withSection(c, i, (sec) => ({ ...sec, name: t }) as LandingSection))}
              />
              ·
              <F
                id={`${uid}:s${i}.qrole`}
                tag="span"
                text={s.role}
                placeholder="Company or role"
                {...bind(`s${i}.qrole`, (c, t) => withSection(c, i, (sec) => ({ ...sec, role: t }) as LandingSection))}
              />
            </p>
          </div>
        );
      case 'cta':
        return (
          <div className="rounded-3xl border border-fd-border p-10 text-center">
            <F
              id={`${uid}:s${i}.ctitle`}
              tag="h2"
              text={s.title}
              className="m-0 text-[24px] font-bold"
              placeholder="Closing title"
              {...bind(`s${i}.ctitle`, (c, t) => withSection(c, i, (sec) => ({ ...sec, title: t }) as LandingSection))}
            />
            <F
              id={`${uid}:s${i}.cbody`}
              tag="p"
              text={s.body}
              className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground"
              placeholder="Closing body"
              {...bind(`s${i}.cbody`, (c, t) => withSection(c, i, (sec) => ({ ...sec, body: t }) as LandingSection))}
            />
            <div className="mt-6 flex justify-center gap-3">
              {ctaRow(i, s.ctas, (ctas) => structural(withSection(stateRef.current, i, (sec) => ({ ...sec, ctas }) as LandingSection)))}
            </div>
          </div>
        );
    }
  }

  const count = copy.sections.length;

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28" style={{ paddingTop: 40 }}>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />

      {/* Search & social metadata — off-page for readers, edited here like
          the docs editor's title/description fields. */}
      <section
        style={{
          border: '1px dashed var(--color-fd-border)', borderRadius: 12, padding: '10px 14px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)' }}>
          Search & social (applies after the rebuild)
        </span>
        <F
          id={`${uid}:meta.title`}
          tag="div"
          text={copy.meta.title}
          className="text-[15px] font-semibold"
          placeholder="Browser / social title"
          {...bind('meta.title', (c, t) => ({ ...c, meta: { ...c.meta, title: t } }))}
        />
        <F
          id={`${uid}:meta.description`}
          tag="div"
          text={copy.meta.description}
          className="text-[13px] text-fd-muted-foreground"
          placeholder="Social description"
          {...bind('meta.description', (c, t) => ({ ...c, meta: { ...c.meta, description: t } }))}
        />
      </section>

      {/* The section factories close over latest-value refs (autosave buffer,
          state snapshot) that are only ever read inside event handlers; the
          rule's interprocedural trace can't see that (same suppression as
          editable-doc's block factories). */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {copy.sections.map((s, i) => (
        <div key={i}>
          <InsertPoint onInsert={(section) => insertSection(i, section)} />
          <section className={sectionClass(s.type, i)} style={{ position: 'relative' }} data-section-index={i}>
            <SectionControls
              type={s.type}
              canUp={i > 0}
              canDown={i < count - 1}
              onUp={() => moveSection(i, -1)}
              onDown={() => moveSection(i, 1)}
              onDelete={() => {
                if (window.confirm(`Delete this ${s.type} section?`)) removeSection(i);
              }}
            />
            {renderSection(s, i)}
          </section>
        </div>
      ))}
      <InsertPoint always onInsert={(section) => insertSection(count, section)} />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* section chrome: hover controls + the insert rail                     */
/* ------------------------------------------------------------------ */

function SectionControls({
  type,
  canUp,
  canDown,
  onUp,
  onDown,
  onDelete,
}: {
  type: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <span
      className="dd-langchip dd-pop"
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: -14, right: 0, zIndex: 75, display: 'flex', gap: 2, padding: '3px 5px', alignItems: 'center' }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fd-muted-foreground)', padding: '0 5px' }}>
        {type}
      </span>
      <button onClick={onUp} disabled={!canUp} title="Move section up" className="dd-icon-btn" style={{ border: 'none', background: 'transparent', opacity: canUp ? 1 : 0.3 }}>
        <ArrowUp size={12} />
      </button>
      <button onClick={onDown} disabled={!canDown} title="Move section down" className="dd-icon-btn" style={{ border: 'none', background: 'transparent', opacity: canDown ? 1 : 0.3 }}>
        <ArrowDown size={12} />
      </button>
      <button onClick={onDelete} title="Delete section" className="dd-icon-btn" data-danger="1" style={{ border: 'none', background: 'transparent' }}>
        <Trash2 size={12} />
      </button>
    </span>
  );
}

/** The between-sections insert rail: a hairline with a centered "+ Section"
 *  button (revealed on hover), opening the template menu. */
function InsertPoint({ onInsert, always }: { onInsert: (s: LandingSection) => void; always?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: 'relative', height: always ? 44 : 22, margin: '2px 0', display: 'flex', alignItems: 'center', zIndex: open ? 80 : undefined }}
    >
      <span aria-hidden className="dd-insert-line" style={{ flex: 1, ...(open ? { background: ACCENT } : null) }} />
      <button
        onClick={() => setOpen((o) => !o)}
        title="Add a section"
        className={always ? '' : 'dd-langchip'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', margin: '0 8px',
          borderRadius: 999, border: `1px ${always ? 'dashed' : 'solid'} var(--color-fd-border)`,
          background: 'var(--color-fd-popover)', color: open ? ACCENT : 'var(--color-fd-muted-foreground)',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <Plus size={12} /> Section
      </button>
      <span aria-hidden className="dd-insert-line" style={{ flex: 1, ...(open ? { background: ACCENT } : null) }} />
      {open && (
        <div
          className="dd-pop"
          style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', zIndex: 85,
            width: 320, padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px' }}>
            <strong style={{ fontSize: 12, flex: 1 }}>Add a section</strong>
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', display: 'flex' }}>
              <X size={13} />
            </button>
          </div>
          {SECTION_TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => {
                onInsert(t.make());
                setOpen(false);
              }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 8px',
                borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fd-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fd-foreground)' }}>{t.label}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-fd-muted-foreground)' }}>{t.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* flow section: draggable / resizable / swappable figure               */
/* ------------------------------------------------------------------ */

function EditFlowSection({
  idBase,
  section,
  onFigure,
  onPickImage,
  codeBind,
  textBind,
}: {
  idBase: string;
  section: FlowSection;
  onFigure: (figure: FlowFigure) => void;
  onPickImage: () => void;
  codeBind: FieldHandlers;
  textBind: FieldHandlers;
}) {
  const committed = section.figure;
  // During a drag we lay out from local geometry so pretext reflows the prose
  // live under the pointer; pointer-up commits it to the copy.
  const [liveFig, setLiveFig] = useState<FlowFigure | null>(null);
  const [selected, setSelected] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const fig = liveFig ?? committed;

  // Click anywhere outside the section deselects the figure.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setSelected(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [selected]);

  const finishDrag = (cur: FlowFigure | null) => {
    setLiveFig(null);
    if (cur) onFigure(cur);
  };

  function startFigureDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-fig-ui]')) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(true);
    const startY = e.clientY;
    let cur: FlowFigure | null = null;
    const move = (ev: PointerEvent) => {
      const col = (rootRef.current ?? document.body).getBoundingClientRect();
      const rel = (ev.clientX - col.left) / col.width;
      const side: FlowFigure['side'] = rel < 0.5 ? 'left' : 'right';
      const top = Math.max(0, Math.min(600, committed.top + (ev.clientY - startY)));
      cur = { ...committed, side, top: Math.round(top) };
      setLiveFig(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      finishDrag(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = fig.width;
    let cur: FlowFigure | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const grow = fig.side === 'left' ? dx : -dx;
      cur = { ...committed, width: Math.round(Math.max(FIGURE_MIN_W, Math.min(FIGURE_MAX_W, startW + grow))) };
      setLiveFig(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      finishDrag(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const setKind = (kind: FlowFigure['kind']) => {
    if (kind === committed.kind) return;
    if (kind === 'image') {
      onFigure({ ...committed, kind, src: committed.src ?? '', alt: committed.alt ?? '' });
      if (!committed.src) onPickImage();
    } else if (kind === 'code') {
      onFigure({ ...committed, kind, width: Math.max(committed.width, 280), code: committed.code || DEFAULT_CODE });
    } else {
      onFigure({ ...committed, kind, width: Math.min(committed.width, 300) });
    }
  };

  const chip = selected && (
    <div
      data-fig-ui
      className="dd-pop"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: -40, left: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', whiteSpace: 'nowrap', zIndex: 78 }}
    >
      <div style={{ display: 'flex', gap: 1, background: 'var(--color-fd-muted)', borderRadius: 7, padding: 2 }}>
        {(['left', 'right'] as const).map((s) => (
          <button key={s} className="dd-chip-btn" data-on={fig.side === s} onClick={() => onFigure({ ...committed, side: s })} style={{ height: 22 }}>
            {s === 'left' ? 'Left' : 'Right'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 1, background: 'var(--color-fd-muted)', borderRadius: 7, padding: 2 }}>
        {(['orb', 'image', 'code'] as const).map((k) => (
          <button key={k} className="dd-chip-btn" data-on={fig.kind === k} onClick={() => setKind(k)} style={{ height: 22 }}>
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {fig.kind === 'image' && (
        <button
          className="dd-chip-btn"
          style={{ display: 'flex', alignItems: 'center', gap: 5, borderLeft: '1px solid var(--color-fd-border)', borderRadius: 0, paddingLeft: 9 }}
          onClick={onPickImage}
        >
          <Upload size={12} /> {fig.src ? 'Replace' : 'Upload'}
        </button>
      )}
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--color-fd-muted-foreground)', paddingRight: 4 }}>{fig.width}px</span>
    </div>
  );

  // The figure's visual — editable code gets its own field inside the card.
  const visual =
    fig.kind === 'code' ? (
      <pre style={codePreStyle} data-fig-ui>
        <F id={`${idBase}.figcode`} tag="code" text={committed.code ?? ''} single={false} placeholder="Code…" style={{ display: 'block', minHeight: '100%' }} {...codeBind} />
      </pre>
    ) : (
      <FigureVisual figure={fig} />
    );

  const figureNode = (
    <div
      data-fig
      onPointerDown={startFigureDrag}
      onClick={(e) => {
        e.stopPropagation();
        setSelected(true);
      }}
      title={selected ? undefined : 'Click to select · drag to move'}
      style={{
        position: 'relative', width: '100%', height: '100%', cursor: 'grab', touchAction: 'none',
        ...(selected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 3, borderRadius: fig.kind === 'orb' ? '50%' : 14 } : null),
      }}
    >
      {visual}
      {chip}
      {selected && (
        <div
          data-fig-ui
          onPointerDown={startResize}
          title="Drag to resize"
          style={{
            position: 'absolute', bottom: -7, right: -7, width: 14, height: 14,
            background: 'var(--color-fd-popover)', border: `2px solid ${ACCENT}`, borderRadius: 4,
            cursor: 'nwse-resize', zIndex: 76, touchAction: 'none',
          }}
        />
      )}
    </div>
  );

  if (textEditing) {
    // Focused prose: a float approximation so the caret behaves like normal
    // text; blur returns to the true pretext flow.
    return (
      <div ref={rootRef} style={{ display: 'flow-root' }}>
        <div
          style={{
            width: fig.width,
            height: figureHeight(fig),
            float: fig.side,
            margin: fig.side === 'left' ? '4px 28px 12px 0' : '4px 0 12px 28px',
          }}
        >
          <FigureVisual figure={fig} />
        </div>
        <p
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className="dd-field"
          data-placeholder="Write the prose that flows around the figure…"
          ref={focusEnd}
          onInput={(e) => textBind.onLive(readText(e.currentTarget, true))}
          onBlur={(e) => {
            textBind.onCommit(readText(e.currentTarget, true));
            setTextEditing(false);
          }}
          style={{
            margin: 0,
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
            fontSize: 19,
            fontWeight: 400,
            lineHeight: '32px',
          }}
          dangerouslySetInnerHTML={stableHtml(`${idBase}.text`, escapeHtml(section.text))}
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-fig-ui], a')) return;
        setTextEditing(true);
      }}
      style={{ cursor: 'text' }}
      title="Click the prose to edit it"
    >
      <Flow text={section.text} obstacles={[figureObstacle(fig, figureNode)]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the overlay: editable page + the same toolbar as the docs editor     */
/* ------------------------------------------------------------------ */

export function LandingEditOverlay({ draft, onDone }: { draft: LandingDraft; onDone: () => void }) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const published = draft.status.startsWith('Published') || draft.status.startsWith('Live');

  // Commit any in-progress field edit before a lifecycle action (some
  // browsers don't move focus to buttons on click, so blur wouldn't fire).
  const commitFocused = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el?.isContentEditable) el.blur();
  };

  const showPreview = useCallback(() => {
    commitFocused();
    setMode('preview');
  }, []);

  const onDiscard = useCallback(() => {
    if (!window.confirm('Discard your layout draft and return to the published version?')) return;
    void draft.discard();
    setMode('edit');
  }, [draft]);

  const seg = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
    borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? 'var(--color-fd-primary)' : 'transparent',
    color: active ? 'var(--color-fd-primary-foreground)' : 'var(--color-fd-muted-foreground)',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  });
  const ghost: CSSProperties = {
    height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-fd-border)',
    background: 'transparent', color: 'var(--color-fd-muted-foreground)', fontSize: 13, cursor: 'pointer',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  };

  return (
    <>
      {mode === 'edit' ? (
        <LandingEditable key={draft.revision} initial={draft.copy} onChange={draft.onChange} />
      ) : (
        <LandingView copy={draft.getCurrent()} />
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
        {draft.status && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-fd-muted-foreground)', maxWidth: 340 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flex: 'none',
                background: draft.conflict ? 'var(--color-fd-error, #dc2626)' : published ? 'var(--color-fd-success, #16a34a)' : ACCENT,
              }}
            />
            {draft.status}
          </span>
        )}
        {draft.conflict && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void draft.adoptConflict()} style={{ ...ghost, height: 26, fontSize: 12 }}>
              Load theirs
            </button>
            <button onClick={() => void draft.overwriteConflict()} style={{ ...ghost, height: 26, fontSize: 12 }}>
              Keep mine
            </button>
          </span>
        )}
        <button onClick={onDiscard} style={ghost}>Discard</button>
        <button
          onClick={() => {
            commitFocused();
            void draft.publish();
          }}
          disabled={draft.publishing}
          style={{
            height: 30, padding: '0 14px', borderRadius: 8, border: 'none',
            background: ACCENT, color: '#fff', fontWeight: 600, fontSize: 13,
            cursor: draft.publishing ? 'default' : 'pointer', opacity: draft.publishing ? 0.7 : 1,
            fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          }}
        >
          {draft.publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button
          onClick={() => {
            commitFocused();
            onDone();
          }}
          style={ghost}
        >
          Done
        </button>
      </div>
    </>
  );
}
