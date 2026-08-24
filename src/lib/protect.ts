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
 * Readers unlock one of two ways:
 *   - the site-wide reading PIN (the READER_PIN secret — distinct from
 *     ADMIN_PIN, so you can hand it to users without handing out edit
 *     access). A successful unlock sets a long-lived HMAC cookie derived
 *     from ADMIN_SECRET + READER_PIN; rotating either invalidates every
 *     issued cookie at once;
 *   - an *invite link*: a signed hash minted by an editor (POST
 *     /api/admin/invite) and appended to the page URL as ?invite=… — see
 *     the invite section below. Invites unlock a single page, carry their
 *     own expiry, and need only ADMIN_SECRET, so they work on sites that
 *     never configured a reading PIN.
 *
 * Signed-in admins/editors always see protected pages.
 *
 * Fail-closed: with READER_PIN unset, protected pages stay locked for
 * everyone except signed-in team members and invite-link holders.
 */

import { cookies } from 'next/headers';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

/** Whether the current request may read the protected page at `slug`: a
 *  valid reader cookie, a redeemed invite for this page, or any signed-in
 *  admin/editor session. */
export async function hasReaderAccess(slug: string): Promise<boolean> {
  const store = await cookies();
  const value = store.get(READER_COOKIE)?.value;
  if (value && readerAuthConfigured() && safeEqual(value, readerToken())) return true;
  if (checkInvite(store.get(inviteCookieName(slug))?.value, slug)) return true;
  return (await readSession()) != null;
}

/* ------------------------- Invitation links -------------------------
 *
 * An invite is a compact signed token — `inv1.<exp>.<sig>` — that an editor
 * appends to a protected page's URL (?invite=…) and shares. The signature
 * covers the page slug and the expiry, so the token is bound to the link it
 * rides on: it unlocks that one page and nothing else, and can't be
 * tampered into a longer life. The slug itself never appears in the token,
 * which keeps the hash short and means a token found in the wild says
 * nothing about what it opens.
 *
 * Stateless by design: nothing is stored server-side. Expiry limits a
 * leaked link's blast radius; rotating ADMIN_SECRET revokes every issued
 * invite (and PIN cookie) at once.
 */

export const INVITE_PARAM = 'invite';

/** Whether invite links can be minted/validated. Only ADMIN_SECRET is
 *  needed — invites work on sites that never set a reading PIN. */
export function inviteAuthConfigured(): boolean {
  return ADMIN_SECRET !== null;
}

function normalizeSlug(slug: string): string {
  return slug.replace(/^\/+|\/+$/g, '');
}

/** exp is unix seconds (0 = no expiry); the signature binds slug + expiry. */
function inviteSignature(slug: string, exp: number): string {
  if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET must be set to mint invite links.');
  return createHmac('sha256', ADMIN_SECRET)
    .update(`invite-v1:${normalizeSlug(slug)}:${exp}`)
    .digest('hex')
    .slice(0, 32);
}

/** Mint the invite token for one page. `expiresAt` is unix seconds, 0 for
 *  a link that lasts until ADMIN_SECRET rotates. */
export function mintInvite(slug: string, expiresAt: number): string {
  return `inv1.${expiresAt}.${inviteSignature(slug, expiresAt)}`;
}

/** Validate an invite token against the page it's being used on. */
export function checkInvite(token: string | null | undefined, slug: string): boolean {
  if (!token || !ADMIN_SECRET) return false; // fail closed
  const m = token.match(/^inv1\.(\d{1,15})\.([0-9a-f]{32})$/);
  if (!m) return false;
  const exp = Number(m[1]!);
  if (!safeEqual(m[2]!, inviteSignature(slug, exp))) return false;
  return exp === 0 || exp * 1000 > Date.now();
}

/** Per-page cookie holding a redeemed invite, so refreshes and in-site
 *  navigation stay unlocked once someone has arrived through the link. */
export function inviteCookieName(slug: string): string {
  return `docsdev_invite_${createHash('sha256').update(normalizeSlug(slug)).digest('hex').slice(0, 12)}`;
}

/** How long to keep a redeemed invite's cookie: until the invite expires,
 *  bounded to a year; no-expiry invites get the reader-cookie lifetime (the
 *  link itself keeps working — re-visiting it re-arms the cookie). */
export function inviteCookieMaxAge(token: string): number {
  const exp = Number(token.match(/^inv1\.(\d{1,15})\./)?.[1] ?? 0);
  if (exp === 0) return READER_MAX_AGE_S;
  return Math.max(60, Math.min(exp - Math.floor(Date.now() / 1000), READER_MAX_AGE_S * 12));
}
