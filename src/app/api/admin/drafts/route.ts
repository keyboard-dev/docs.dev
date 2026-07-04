import { NextResponse } from 'next/server';
import { isAdmin, readSession } from '@/lib/admin';
import { getDraftStore } from '@/lib/draft-store';

/**
 * Shared drafts API. Drafts are visible to every admin, so editing works
 * across browsers and teammates.
 *
 *   GET    ?slug=x   → { draft: ServerDraft | null }
 *   GET               → { drafts: DraftMeta[] }        (all drafts)
 *   PUT    { slug, content, author, baseUpdatedAt }
 *            → { ok, updatedAt } | 409 { conflict: ServerDraft }
 *   DELETE ?slug=x   → { ok }
 *
 * Conflict rule (last-writer guard): a PUT carries the `updatedAt` of the
 * server version it was based on; if someone else saved since, the write is
 * rejected with their draft so the client can surface it instead of silently
 * clobbering a teammate.
 */

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  const store = getDraftStore();
  try {
    if (slug == null) {
      return NextResponse.json({ ok: true, drafts: await store.list() });
    }
    return NextResponse.json({ ok: true, draft: await store.get(slug) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    content?: string;
    author?: string;
    baseUpdatedAt?: number;
  };
  if (typeof body.slug !== 'string' || typeof body.content !== 'string') {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  const store = getDraftStore();
  try {
    const existing = await store.get(body.slug);
    const base = body.baseUpdatedAt ?? 0;
    // GitHub and docs.dev sessions carry a verified identity; PIN sessions
    // fall back to the client's self-reported display name.
    const author =
      session.method === 'github' || session.method === 'docsdev'
        ? (session.name || session.login).slice(0, 60)
        : (body.author ?? 'Anonymous').slice(0, 60);
    if (existing && existing.updatedAt > base && existing.author !== author) {
      return NextResponse.json({ ok: false, conflict: existing }, { status: 409 });
    }
    const updatedAt = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
    await store.put({ slug: body.slug, content: body.content, updatedAt, author });
    return NextResponse.json({ ok: true, updatedAt });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (slug == null) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  try {
    await getDraftStore().delete(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
