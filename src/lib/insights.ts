/**
 * Ask AI insights — what readers ask, and what the docs couldn't answer.
 *
 * Storage is a Cloudflare D1 database via the optional `INSIGHTS` binding
 * (see wrangler.jsonc). Logging is deliberately anonymous: question text,
 * the page it was asked from, a timestamp, and whether retrieval found
 * sources. No IPs, no session identifiers, no fingerprints — and rows are
 * pruned after RETENTION_DAYS. Without the binding the whole feature is
 * off: nothing is logged and the admin panel reports unavailable.
 *
 * `answered` is a heuristic: retrieval found at least one source. A model
 * answer that still said "the docs don't cover this" is not detected (the
 * answer streams through without being buffered server-side).
 *
 * INSIGHTS_MOCK=1 (dev/tests) swaps in an in-memory store.
 */

export type LoggedQuestion = {
  id: number;
  /** Epoch ms. */
  ts: number;
  /** Site-relative page path the question was asked from ('' if unknown). */
  page: string;
  question: string;
  answered: boolean;
  /** How many pages retrieval matched. */
  sources: number;
};

export type InsightsStats = {
  /** Totals over the last 7 days. */
  total7d: number;
  unanswered7d: number;
};

const RETENTION_DAYS = 90;
const MAX_QUESTION_CHARS = 500;
const MAX_PAGE_CHARS = 200;

/* Minimal D1 surface — hand-rolled like WorkersAI in ai.ts, so we don't
   depend on @cloudflare/workers-types. */
type D1Result<T> = { results: T[] };
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
};
export type D1Database = { prepare(sql: string): D1PreparedStatement };

export function insightsMocked(): boolean {
  return process.env.INSIGHTS_MOCK === '1';
}

const mockRows: LoggedQuestion[] = [];
let mockId = 0;

async function insightsDB(): Promise<D1Database | null> {
  if (insightsMocked()) return null;
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    return ((ctx.env as Record<string, unknown>).INSIGHTS as D1Database | undefined) ?? null;
  } catch {
    return null; // not running on Cloudflare (plain `next start`)
  }
}

export async function insightsAvailable(): Promise<boolean> {
  return insightsMocked() || (await insightsDB()) != null;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  answered INTEGER NOT NULL,
  sources INTEGER NOT NULL
)`;

async function withSchema(db: D1Database): Promise<void> {
  await db.prepare(SCHEMA).run();
}

/** Fire-and-forget from the chat route — never throws, never blocks a reader. */
export async function logQuestion(entry: { page: string; question: string; sources: number }): Promise<void> {
  const row = {
    ts: Date.now(),
    page: entry.page.slice(0, MAX_PAGE_CHARS),
    question: entry.question.slice(0, MAX_QUESTION_CHARS),
    answered: entry.sources > 0,
    sources: entry.sources,
  };
  if (insightsMocked()) {
    mockRows.unshift({ id: ++mockId, ...row });
    return;
  }
  try {
    const db = await insightsDB();
    if (!db) return;
    await withSchema(db);
    await db
      .prepare('INSERT INTO questions (ts, page, question, answered, sources) VALUES (?, ?, ?, ?, ?)')
      .bind(row.ts, row.page, row.question, row.answered ? 1 : 0, row.sources)
      .run();
    // Retention: prune on write — cheap, and keeps the table bounded.
    await db.prepare('DELETE FROM questions WHERE ts < ?').bind(Date.now() - RETENTION_DAYS * 86_400_000).run();
  } catch {
    // insights must never break the assistant
  }
}

export async function listQuestions(opts: { unansweredOnly?: boolean; limit?: number } = {}): Promise<LoggedQuestion[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (insightsMocked()) {
    return mockRows.filter((r) => !opts.unansweredOnly || !r.answered).slice(0, limit);
  }
  const db = await insightsDB();
  if (!db) return [];
  await withSchema(db);
  const where = opts.unansweredOnly ? 'WHERE answered = 0' : '';
  const { results } = await db
    .prepare(`SELECT id, ts, page, question, answered, sources FROM questions ${where} ORDER BY ts DESC LIMIT ?`)
    .bind(limit)
    .all<{ id: number; ts: number; page: string; question: string; answered: number; sources: number }>();
  return results.map((r) => ({ ...r, answered: r.answered === 1 }));
}

export async function insightsStats(): Promise<InsightsStats> {
  const since = Date.now() - 7 * 86_400_000;
  if (insightsMocked()) {
    const recent = mockRows.filter((r) => r.ts >= since);
    return { total7d: recent.length, unanswered7d: recent.filter((r) => !r.answered).length };
  }
  const db = await insightsDB();
  if (!db) return { total7d: 0, unanswered7d: 0 };
  await withSchema(db);
  const row = await db
    .prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN answered = 0 THEN 1 ELSE 0 END) AS unanswered FROM questions WHERE ts >= ?')
    .bind(since)
    .first<{ total: number; unanswered: number | null }>();
  return { total7d: row?.total ?? 0, unanswered7d: row?.unanswered ?? 0 };
}
