import { NextResponse } from 'next/server';
import { isAdmin, readDoc } from '@/lib/admin';

// Returns the baseline (published) source for a page. Edits are persisted via
// /api/admin/publish (GitHub), not by writing files — so this is read-only.
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
