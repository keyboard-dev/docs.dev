import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/admin';
import { SSO_JWT_COOKIE } from '@/lib/docsdev-sso';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(SSO_JWT_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
