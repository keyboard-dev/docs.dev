/**
 * Admin session + content-file helpers (PROOF OF CONCEPT).
 *
 * Auth model: a 4-digit PIN (default 1234, override with ADMIN_PIN) unlocks an
 * httpOnly session cookie. The cookie stores an HMAC of a constant keyed by
 * ADMIN_SECRET — never the PIN — so it can't be forged just by guessing the
 * cookie name, and we can validate it statelessly (no session store needed,
 * which matters on serverless).
 *
 * This is intentionally minimal. A production build would use real auth and
 * persist edits through git or a database rather than writing files, since
 * serverless filesystems are read-only.
 */

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const COOKIE = 'docsdev_admin';
const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'docs-dev-poc-secret';

const CONTENT_ROOT = path.join(process.cwd(), 'content', 'docs');

export function sessionToken(): string {
  return createHmac('sha256', ADMIN_SECRET).update('admin-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPin(pin: string): boolean {
  return safeEqual(pin, ADMIN_PIN);
}

export const SESSION_COOKIE = COOKIE;

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return false;
  return safeEqual(value, sessionToken());
}

/**
 * Resolve a doc slug to an absolute .mdx path, refusing anything that escapes
 * the content directory. Empty slug maps to the index page.
 */
export function resolveDocPath(slug: string): string | null {
  const clean = slug.replace(/\.mdx$/, '').replace(/^\/+|\/+$/g, '');
  if (clean.length > 0 && !/^[a-z0-9][a-z0-9/-]*$/i.test(clean)) return null;
  const rel = clean.length === 0 ? 'index.mdx' : `${clean}.mdx`;
  const abs = path.join(CONTENT_ROOT, rel);
  const resolved = path.resolve(abs);
  if (resolved !== CONTENT_ROOT && !resolved.startsWith(CONTENT_ROOT + path.sep)) {
    return null;
  }
  return resolved;
}

export async function readDoc(slug: string): Promise<string | null> {
  const abs = resolveDocPath(slug);
  if (!abs) return null;
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export async function writeDoc(slug: string, content: string): Promise<boolean> {
  const abs = resolveDocPath(slug);
  if (!abs) return false;
  await fs.writeFile(abs, content, 'utf8');
  return true;
}

/** Repo-relative path for a slug, e.g. "reading-experience" → "content/docs/reading-experience.mdx". */
export function docRepoPath(slug: string): string | null {
  const clean = slug.replace(/\.mdx$/, '').replace(/^\/+|\/+$/g, '');
  if (clean.length > 0 && !/^[a-z0-9][a-z0-9/-]*$/i.test(clean)) return null;
  return `content/docs/${clean === '' ? 'index' : clean}.mdx`;
}

export async function listDocs(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.mdx')) {
        const base = entry.name.replace(/\.mdx$/, '');
        out.push(base === 'index' ? prefix.replace(/\/$/, '') : `${prefix}${base}`);
      }
    }
  }
  await walk(CONTENT_ROOT, '');
  return out.sort();
}
