/**
 * Server-side draft store — the shared layer that makes editing multiplayer.
 *
 * Drafts written in one browser are visible to every admin: the editor pushes
 * (debounced) to this store and pulls on load, with the local IndexedDB copy
 * kept as the instant-feedback layer.
 *
 * Backend: the same GitHub repo the publish flow already uses, on a dedicated
 * `docsdev-drafts` branch (`drafts/<slug>.json`), so shared drafts need zero
 * new infrastructure — the server-held PAT is the only credential. When no
 * PAT is configured (local dev), an in-process memory store keeps the full
 * flow working (shared across tabs/browsers of one dev server, not across
 * deploy isolates).
 */

import { gitConfig } from './shared';

export type ServerDraft = {
  slug: string;
  content: string;
  /** Server clock, ms. Monotonic per store; used for last-writer conflicts. */
  updatedAt: number;
  /** Display name of the last editor (self-reported, informational). */
  author: string;
};

export type DraftMeta = Pick<ServerDraft, 'slug' | 'updatedAt' | 'author'>;

export interface DraftStore {
  get(slug: string): Promise<ServerDraft | null>;
  put(draft: ServerDraft): Promise<void>;
  delete(slug: string): Promise<void>;
  list(): Promise<DraftMeta[]>;
}

const DRAFTS_BRANCH = process.env.DRAFTS_BRANCH ?? 'docsdev-drafts';

function fileFor(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  return `drafts/${clean === '' ? 'index' : clean}.json`;
}

/* ------------------------------------------------------------------ */
/* GitHub backend                                                      */
/* ------------------------------------------------------------------ */

class GitHubDraftStore implements DraftStore {
  private headers: Record<string, string>;
  private owner: string;
  private repo: string;
  private baseBranch: string;
  private branchReady = false;

  constructor(pat: string) {
    this.owner = process.env.GITHUB_OWNER ?? gitConfig.user;
    this.repo = process.env.GITHUB_REPO ?? gitConfig.repo;
    this.baseBranch = process.env.GITHUB_BRANCH ?? gitConfig.branch;
    this.headers = {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'docs.dev-admin',
    };
  }

  private api(path: string): string {
    return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
  }

  /** The drafts branch is created lazily from the base branch HEAD. */
  private async ensureBranch(): Promise<void> {
    if (this.branchReady) return;
    const head = await fetch(this.api(`/git/ref/heads/${DRAFTS_BRANCH}`), { headers: this.headers });
    if (head.ok) {
      this.branchReady = true;
      return;
    }
    const base = await fetch(this.api(`/git/ref/heads/${this.baseBranch}`), { headers: this.headers });
    if (!base.ok) throw new Error(`Cannot read base branch (${base.status})`);
    const sha = ((await base.json()) as { object: { sha: string } }).object.sha;
    const created = await fetch(this.api('/git/refs'), {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${DRAFTS_BRANCH}`, sha }),
    });
    if (!created.ok && created.status !== 422) {
      throw new Error(`Cannot create drafts branch (${created.status})`);
    }
    this.branchReady = true;
  }

  private async read(path: string): Promise<{ json: ServerDraft; sha: string } | null> {
    const res = await fetch(this.api(`/contents/${path}?ref=${encodeURIComponent(DRAFTS_BRANCH)}`), {
      headers: this.headers,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Draft read failed (${res.status})`);
    const data = (await res.json()) as { content: string; sha: string };
    const json = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) as ServerDraft;
    return { json, sha: data.sha };
  }

  async get(slug: string): Promise<ServerDraft | null> {
    await this.ensureBranch();
    return (await this.read(fileFor(slug)))?.json ?? null;
  }

  async put(draft: ServerDraft): Promise<void> {
    await this.ensureBranch();
    const path = fileFor(draft.slug);
    const existing = await this.read(path);
    const res = await fetch(this.api(`/contents/${path}`), {
      method: 'PUT',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `draft: ${draft.slug || 'index'} by ${draft.author}`,
        branch: DRAFTS_BRANCH,
        content: Buffer.from(JSON.stringify(draft), 'utf8').toString('base64'),
        ...(existing ? { sha: existing.sha } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Draft write failed (${res.status})`);
  }

  async delete(slug: string): Promise<void> {
    await this.ensureBranch();
    const path = fileFor(slug);
    const existing = await this.read(path);
    if (!existing) return;
    const res = await fetch(this.api(`/contents/${path}`), {
      method: 'DELETE',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message: `draft: discard ${slug || 'index'}`, branch: DRAFTS_BRANCH, sha: existing.sha }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Draft delete failed (${res.status})`);
  }

  async list(): Promise<DraftMeta[]> {
    await this.ensureBranch();
    const res = await fetch(this.api(`/contents/drafts?ref=${encodeURIComponent(DRAFTS_BRANCH)}`), {
      headers: this.headers,
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Draft list failed (${res.status})`);
    const entries = (await res.json()) as Array<{ name: string; type: string }>;
    const metas: DraftMeta[] = [];
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
      const draft = (await this.read(`drafts/${entry.name}`))?.json;
      if (draft) metas.push({ slug: draft.slug, updatedAt: draft.updatedAt, author: draft.author });
    }
    return metas;
  }
}

/* ------------------------------------------------------------------ */
/* In-memory dev fallback                                              */
/* ------------------------------------------------------------------ */

const memoryKey = Symbol.for('docsdev.draftstore.memory');
type MemoryMap = Map<string, ServerDraft>;

class MemoryDraftStore implements DraftStore {
  private map(): MemoryMap {
    const g = globalThis as Record<symbol, unknown>;
    g[memoryKey] ??= new Map<string, ServerDraft>();
    return g[memoryKey] as MemoryMap;
  }

  async get(slug: string): Promise<ServerDraft | null> {
    return this.map().get(fileFor(slug)) ?? null;
  }
  async put(draft: ServerDraft): Promise<void> {
    this.map().set(fileFor(draft.slug), draft);
  }
  async delete(slug: string): Promise<void> {
    this.map().delete(fileFor(slug));
  }
  async list(): Promise<DraftMeta[]> {
    return Array.from(this.map().values()).map(({ slug, updatedAt, author }) => ({ slug, updatedAt, author }));
  }
}

/* ------------------------------------------------------------------ */
/* resilient wrapper                                                   */
/* ------------------------------------------------------------------ */

/** GitHub primary with in-process fallback: if GitHub is unreachable or the
 *  token is invalid, drafts keep working (memory) instead of blocking
 *  editing. The degradation is remembered per isolate and logged once. */
class FallbackDraftStore implements DraftStore {
  private degraded = false;
  constructor(
    private primary: DraftStore,
    private secondary: DraftStore,
  ) {}

  private async run<T>(fn: (s: DraftStore) => Promise<T>): Promise<T> {
    if (!this.degraded) {
      try {
        return await fn(this.primary);
      } catch (err) {
        console.warn('[drafts] GitHub store unavailable, falling back to memory:', (err as Error).message);
        this.degraded = true;
      }
    }
    return fn(this.secondary);
  }

  get(slug: string) {
    return this.run((s) => s.get(slug));
  }
  put(draft: ServerDraft) {
    return this.run((s) => s.put(draft));
  }
  delete(slug: string) {
    return this.run((s) => s.delete(slug));
  }
  list() {
    return this.run((s) => s.list());
  }
}

const storeKey = Symbol.for('docsdev.draftstore.instance');

export function getDraftStore(): DraftStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[storeKey]) {
    const pat = process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN;
    g[storeKey] = pat
      ? new FallbackDraftStore(new GitHubDraftStore(pat), new MemoryDraftStore())
      : new MemoryDraftStore();
  }
  return g[storeKey] as DraftStore;
}
