/**
 * Client side of the shared draft store: push/pull helpers plus the editor's
 * display name (shown to teammates on drafts they didn't write). The name
 * comes from the signed-in session — every editor is authenticated, so
 * nobody is ever prompted to type one.
 */

export type RemoteDraft = { slug: string; content: string; updatedAt: number; author: string };
export type RemoteDraftMeta = Pick<RemoteDraft, 'slug' | 'updatedAt' | 'author'>;

const NAME_KEY = 'docsdev-editor-name';

/** Verified identity from the session (GitHub sign-in), set by whichever
 *  component fetches /api/admin/session first. Beats the self-reported name
 *  and suppresses the name prompt entirely. */
let sessionName: string | null = null;
export function primeEditorName(name: string | null | undefined): void {
  if (name) sessionName = name;
}

let selfPrimeStarted = false;

export function editorName(): string {
  if (sessionName) return sessionName;
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    // storage unavailable — fall through
  }
  // Session fetch hasn't primed us yet (first edit races it) — prime for the
  // next save rather than interrupting this one with a prompt.
  if (!selfPrimeStarted && typeof window !== 'undefined') {
    selfPrimeStarted = true;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => primeEditorName(d?.user?.name || d?.user?.login))
      .catch(() => {});
  }
  return 'Editor';
}

export async function fetchServerDraft(slug: string): Promise<RemoteDraft | null> {
  try {
    const res = await fetch(`/api/admin/drafts?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return ((await res.json()) as { draft?: RemoteDraft | null }).draft ?? null;
  } catch {
    return null;
  }
}

export async function listServerDrafts(): Promise<RemoteDraftMeta[]> {
  try {
    const res = await fetch('/api/admin/drafts');
    if (!res.ok) return [];
    return ((await res.json()) as { drafts?: RemoteDraftMeta[] }).drafts ?? [];
  } catch {
    return [];
  }
}

export type PushResult =
  | { ok: true; updatedAt: number }
  | { ok: false; conflict: RemoteDraft }
  | { ok: false; error: string };

export async function pushServerDraft(
  slug: string,
  content: string,
  baseUpdatedAt: number,
  author: string,
): Promise<PushResult> {
  try {
    const res = await fetch('/api/admin/drafts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, content, baseUpdatedAt, author }),
    });
    const data = (await res.json().catch(() => ({}))) as { updatedAt?: number; conflict?: RemoteDraft; error?: string };
    if (res.status === 409 && data.conflict) return { ok: false, conflict: data.conflict };
    if (!res.ok) return { ok: false, error: data.error ?? `Sync failed (${res.status})` };
    return { ok: true, updatedAt: data.updatedAt ?? Date.now() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteServerDraft(slug: string): Promise<void> {
  try {
    await fetch(`/api/admin/drafts?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
}
