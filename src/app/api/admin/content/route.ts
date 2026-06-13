import { NextResponse } from 'next/server';
import { isAdmin, readDoc, writeDoc } from '@/lib/admin';

export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  const content = await readDoc(slug);
  if (content === null) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, slug, content });
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { slug, content } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    content?: string;
  };
  if (typeof slug !== 'string' || typeof content !== 'string') {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  try {
    const ok = await writeDoc(slug, content);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Most likely a read-only filesystem (e.g. serverless). Surface it clearly.
    return NextResponse.json(
      { ok: false, error: `Write failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
