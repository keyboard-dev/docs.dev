'use client';

/**
 * The landing page's editor — the same unified editing experience as docs
 * pages, applied to content/landing.json:
 *
 *   - "Edit layout" turns the *real* page into the editor: every heading,
 *     paragraph, button label, and card is a contentEditable field with the
 *     exact published classes (dd-field rings on hover/focus, placeholders).
 *   - The pretext Flow demos edit like Spread figures in the docs editor:
 *     click the prose to get a float-approximation with a normal caret; blur
 *     returns to the true measured flow.
 *   - Button/card link targets edit through hover chips (the code-language
 *     chip pattern), and buttons/cards can be added and removed in place.
 *   - Drafts behave exactly like page drafts: instant IndexedDB autosave,
 *     debounced sync to the shared drafts store under the reserved
 *     `_landing` slug (teammates see your draft, conflicts surface with
 *     "load theirs / keep mine"), and the same toolbar: Edit ↔ Preview,
 *     draft status, Discard, Publish with deploy detection, Done.
 *   - Publish commits content/landing.json via /api/admin/layout.
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
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { LANDING_DRAFT_SLUG, sanitizeLandingCopy, type LandingCopy, type LandingCta } from '@/lib/landing';
import { deleteDraft, getDraft, putDraft } from '@/lib/drafts';
import {
  deleteServerDraft,
  editorName,
  fetchServerDraft,
  pushServerDraft,
  type RemoteDraft,
} from '@/lib/draft-sync';
import { Flow, type Obstacle } from '@/components/pretext/flow';
import { CODE_BOX, LandingView, ORB_BOX, OrbNode, codeObstacle, codePreStyle, ctaClass, orbObstacle } from './landing';

const ACCENT = 'var(--docsdev-accent, #c2571f)';
const PUSH_DEBOUNCE_MS = 2500;
const LIVE_POLL_MS = 8000;
const LIVE_POLL_MAX_MS = 5 * 60 * 1000;

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
      // Snapshot the currently-built page so we can detect the redeploy.
      const before = await fetch('/', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);

      const res = await fetch('/api/admin/layout', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ copy: JSON.parse(draftRef.current) }),
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

/** Uncontrolled twin of LandingView: same sections, same classes, but every
 *  text node is a field and structure (buttons, cards) is editable. Emits
 *  the full LandingCopy on every change; never re-reads `initial` (the
 *  parent remounts it via the draft revision key on load/discard/adopt). */
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

  /** Structural change (add/remove button or card, link target, style). */
  const structural = useCallback(
    (next: LandingCopy) => {
      stateRef.current = next;
      setCopyState(next);
      emitNow();
    },
    [emitNow],
  );

  const ctaStyles: Array<{ v: LandingCta['style']; label: string }> = [
    { v: 'primary', label: 'Filled' },
    { v: 'outline', label: 'Outline' },
    { v: 'text', label: 'Text' },
  ];

  const ctaRow = (base: 'hero' | 'closing', ctas: LandingCta[], setCtas: (next: LandingCta[]) => void) => (
    <>
      {ctas.map((cta, i) => (
        <span key={`${base}${i}`} style={{ position: 'relative', display: 'inline-flex' }}>
          <F
            id={`${uid}:${base}.cta${i}`}
            tag="span"
            text={cta.label}
            className={ctaClass(cta.style)}
            placeholder="Label"
            style={{ cursor: 'text' }}
            {...bind(`${base}.cta${i}`, (c, t) => {
              const list = (base === 'hero' ? c.hero.ctas : c.closing.ctas).map((x, j) => (j === i ? { ...x, label: t } : x));
              return base === 'hero' ? { ...c, hero: { ...c.hero, ctas: list } } : { ...c, closing: { ...c.closing, ctas: list } };
            })}
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
              onChange={(e) => setCtas(ctas.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))}
              style={chipInput}
            />
            <select
              value={cta.style}
              onChange={(e) => setCtas(ctas.map((x, j) => (j === i ? { ...x, style: e.target.value as LandingCta['style'] } : x)))}
              style={chipSelect}
            >
              {ctaStyles.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setCtas(ctas.filter((_, j) => j !== i))}
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

  // The code sample edits in place inside the flowing demo; data-code-ui
  // stops clicks from opening the paragraph's text editing.
  const codeNode = (
    <pre style={codePreStyle} data-code-ui>
      <F
        id={`${uid}:demo.code`}
        tag="code"
        text={copy.demo.code}
        single={false}
        placeholder="Code…"
        style={{ display: 'block', minHeight: '100%' }}
        {...bind('demo.code', (c, t) => ({ ...c, demo: { ...c.demo, code: t } }))}
      />
    </pre>
  );

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 pb-28" style={{ paddingTop: 40 }}>
      {/* Search & social metadata — off-page for readers, edited here like
          the docs editor's title/description fields. */}
      <section
        style={{
          border: '1px dashed var(--color-fd-border)', borderRadius: 12, padding: '10px 14px',
          display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8,
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

      {/* Hero */}
      <section className="pt-10 pb-14">
        <F
          id={`${uid}:hero.eyebrow`}
          tag="p"
          text={copy.hero.eyebrow}
          className="mb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--docsdev-accent,#e8753b)]"
          placeholder="Eyebrow"
          {...bind('hero.eyebrow', (c, t) => ({ ...c, hero: { ...c.hero, eyebrow: t } }))}
        />
        <F
          id={`${uid}:hero.title`}
          tag="h1"
          text={copy.hero.titleLines.join('\n')}
          single={false}
          className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[56px]"
          placeholder="Page title"
          {...bind('hero.title', (c, t) => ({
            ...c,
            hero: { ...c.hero, titleLines: t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3) },
          }))}
        />
        <F
          id={`${uid}:hero.tagline`}
          tag="p"
          text={copy.hero.tagline}
          className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-fd-muted-foreground"
          placeholder="Tagline"
          {...bind('hero.tagline', (c, t) => ({ ...c, hero: { ...c.hero, tagline: t } }))}
        />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {/* The row factory closes over latest-value refs that are only ever
              read inside event handlers; the rule's interprocedural trace
              can't see that (same suppression as editable-doc). */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {ctaRow('hero', copy.hero.ctas, (ctas) => structural({ ...copy, hero: { ...copy.hero, ctas } }))}
        </div>
      </section>

      {/* Live pretext demo — click a paragraph to edit it; the figure keeps
          its place via a float approximation while the caret is active, and
          blur returns to the true measured flow (the EditorSpread pattern). */}
      <section aria-label="Live layout demo">
        <EditFlowPara
          id={`${uid}:demo.intro`}
          text={copy.demo.intro}
          obstacle={orbObstacle(<OrbNode />)}
          box={ORB_BOX}
          side="right"
          {...bind('demo.intro', (c, t) => ({ ...c, demo: { ...c.demo, intro: t } }))}
        />
        <div className="h-14" />
        <EditFlowPara
          id={`${uid}:demo.body`}
          text={copy.demo.body}
          obstacle={codeObstacle(copy.demo.code, codeNode)}
          box={CODE_BOX}
          side="left"
          {...bind('demo.body', (c, t) => ({ ...c, demo: { ...c.demo, body: t } }))}
        />
      </section>

      {/* Features */}
      <section className="mt-24">
        <F
          id={`${uid}:features.heading`}
          tag="h2"
          text={copy.features.heading}
          className="mb-8 text-[26px] font-bold tracking-[-0.01em]"
          placeholder="Section heading"
          {...bind('features.heading', (c, t) => ({ ...c, features: { ...c.features, heading: t } }))}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.items.map((f, i) => (
            <div key={i} className="rounded-2xl border border-fd-border p-5" style={{ position: 'relative' }}>
              <F
                id={`${uid}:feature${i}.title`}
                tag="h3"
                text={f.title}
                className="mb-2 text-[15px] font-semibold"
                placeholder="Feature title"
                {...bind(`feature${i}.title`, (c, t) => ({
                  ...c,
                  features: { ...c.features, items: c.features.items.map((x, j) => (j === i ? { ...x, title: t } : x)) },
                }))}
              />
              <F
                id={`${uid}:feature${i}.body`}
                tag="p"
                text={f.body}
                className="m-0 text-[14px] leading-relaxed text-fd-muted-foreground"
                placeholder="What it does and why it matters."
                {...bind(`feature${i}.body`, (c, t) => ({
                  ...c,
                  features: { ...c.features, items: c.features.items.map((x, j) => (j === i ? { ...x, body: t } : x)) },
                }))}
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
                    structural({
                      ...copy,
                      features: { ...copy.features, items: copy.features.items.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) },
                    })
                  }
                  style={chipInput}
                />
                <button
                  onClick={() => structural({ ...copy, features: { ...copy.features, items: copy.features.items.filter((_, j) => j !== i) } })}
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
          {copy.features.items.length < 12 && (
            <button
              onClick={() =>
                structural({
                  ...copy,
                  features: {
                    ...copy.features,
                    items: [...copy.features.items, { title: 'New feature', body: 'What it does and why it matters.', href: '/docs' }],
                  },
                })
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
      </section>

      {/* Closing CTA */}
      <section className="mt-24 rounded-3xl border border-fd-border p-10 text-center">
        <F
          id={`${uid}:closing.title`}
          tag="h2"
          text={copy.closing.title}
          className="m-0 text-[24px] font-bold"
          placeholder="Closing title"
          {...bind('closing.title', (c, t) => ({ ...c, closing: { ...c.closing, title: t } }))}
        />
        <F
          id={`${uid}:closing.body`}
          tag="p"
          text={copy.closing.body}
          className="mx-auto mt-3 max-w-[440px] text-[15px] text-fd-muted-foreground"
          placeholder="Closing body"
          {...bind('closing.body', (c, t) => ({ ...c, closing: { ...c.closing, body: t } }))}
        />
        <div className="mt-6 flex justify-center gap-3">
          {/* eslint-disable-next-line react-hooks/refs */}
          {ctaRow('closing', copy.closing.ctas, (ctas) => structural({ ...copy, closing: { ...copy.closing, ctas } }))}
        </div>
      </section>
    </main>
  );
}

/** A pretext Flow paragraph in the editor. At rest it's the true measured
 *  flow; click the prose and it swaps to a float approximation so the caret
 *  behaves like normal text (exactly how the docs editor edits Spread
 *  blocks); blur returns to the real flow. */
function EditFlowPara({
  id,
  text,
  obstacle,
  box,
  side,
  onLive,
  onCommit,
}: {
  id: string;
  text: string;
  obstacle: Obstacle;
  box: { width: number; height: number; gap: number };
  side: 'left' | 'right';
} & FieldHandlers) {
  const [textEditing, setTextEditing] = useState(false);

  if (textEditing) {
    return (
      <div style={{ display: 'flow-root' }}>
        <div
          style={{
            width: box.width,
            height: box.height,
            float: side,
            margin: side === 'left' ? `4px ${box.gap}px 12px 0` : `4px 0 12px ${box.gap}px`,
          }}
        >
          {obstacle.node}
        </div>
        <p
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className="dd-field"
          data-placeholder="Write the prose that flows around the figure…"
          ref={focusEnd}
          onInput={(e) => onLive(readText(e.currentTarget, true))}
          onBlur={(e) => {
            onCommit(readText(e.currentTarget, true));
            setTextEditing(false);
          }}
          style={{
            margin: 0,
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
            fontSize: 19,
            fontWeight: 400,
            lineHeight: '32px',
          }}
          dangerouslySetInnerHTML={stableHtml(id, escapeHtml(text))}
        />
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-code-ui], a')) return;
        setTextEditing(true);
      }}
      style={{ cursor: 'text' }}
      title="Click the prose to edit it"
    >
      <Flow text={text} obstacles={[obstacle]} />
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
