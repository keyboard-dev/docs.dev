import { NextResponse } from 'next/server';
import { isAdmin, listDocs } from '@/lib/admin';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, pages: await listDocs() });
}
