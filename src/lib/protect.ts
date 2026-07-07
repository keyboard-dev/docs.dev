/**
 * Reading-PIN protection for individual docs pages.
 *
 * A page opts in with `protected: true` in its frontmatter (the editor's
 * lock toggle writes it). Protected pages are:
 *   - prerendered as a *lock shell* — title, description, and an unlock form,
 *     never the content. The content is only obtainable from
 *     /api/reader/content, which checks the reader cookie server-side, so the
 *     gate is enforced on the Worker even though the shell is static;
 *   - hidden from the search index, llms-full.txt, and the /llms.mdx markdown
 *     mirror, so their content can't leak around the gate.
 *
 * Readers unlock with the site-wide reading PIN (the READER_PIN secret —
 * distinct from ADMIN_PIN, so you can hand it to users without handing out
 * edit access). A successful unlock sets a long-lived HMAC cookie derived
 * from ADMIN_SECRET + READER_PIN; rotating either invalidates every issued
 * cookie at once. Signed-in admins/editors always see protected pages.
 *
 * Fail-closed: with READER_PIN unset, protected pages stay locked for
 * everyone except signed-in team members.
 */

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readSession } from './admin';
import { getDocSource, listDocSlugs } from './content';

const READER_PIN = process.env.READER_PIN || null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

export const READER_COOKIE = 'docsdev_reader';
export const READER_MAX_AGE_S = 60 * 60 * 24 * 30;

/** Whether the `protected: true` frontmatter flag is set in a page source. */
export function sourceIsProtected(source: string): boolean {
  const fm = source.match(/^---\n([\s\S]*?)\n---/);
  return fm != null && /^protected:\s*true\s*$/m.test(fm[1]!);
}

/** Whether the built page at `slug` (string or slug segments) is protected. */
export function isProtectedSlug(slug: string | string[] | undefined): boolean {
  const clean = Array.isArray(slug) ? slug.join('/') : (slug ?? '');
  const source = getDocSource(clean);
  return source != null && sourceIsProtected(source);
}

export function listProtectedSlugs(): string[] {
  return listDocSlugs().filter((slug) => isProtectedSlug(slug));
}

/** Whether reading-PIN unlock is usable at all — both secrets must be set. */
export function readerAuthConfigured(): boolean {
  return READER_PIN !== null && ADMIN_SECRET !== null;
}

/** The value a valid reader cookie carries. Binding it to both the secret and
 *  the PIN means changing either one revokes every unlocked browser. */
export function readerToken(): string {
  if (!READER_PIN || !ADMIN_SECRET) {
    throw new Error('READER_PIN and ADMIN_SECRET must both be set to use reading-PIN unlock.');
  }
  return createHmac('sha256', ADMIN_SECRET).update(`reader-v1:${READER_PIN}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkReaderPin(pin: string): boolean {
  if (!READER_PIN) return false; // fail closed — no default to fall back to
  return safeEqual(pin, READER_PIN);
}

/** Whether the current request may read protected pages: a valid reader
 *  cookie, or any signed-in admin/editor session. */
export async function hasReaderAccess(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(READER_COOKIE)?.value;
  if (value && readerAuthConfigured() && safeEqual(value, readerToken())) return true;
  return (await readSession()) != null;
}
