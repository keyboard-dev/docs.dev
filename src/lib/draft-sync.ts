/**
 * Client side of the shared draft store: push/pull helpers plus the editor's
 * self-reported display name (shown to teammates on drafts they didn't write).
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

export function editorName(interactive = false): string {
  if (sessionName) return sessionName;
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    if (interactive) {
      const name = window.prompt('Your name (shown to teammates on your drafts):')?.trim();
      if (name) {
        localStorage.setItem(NAME_KEY, name.slice(0, 60));
        return name.slice(0, 60);
      }
    }
  } catch {
    // storage unavailable — fall through
  }
  return 'Anonymous';
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
