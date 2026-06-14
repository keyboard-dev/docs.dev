import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';

// Lightweight check the client uses to decide whether to show in-app editing.
// Keeping this client-driven means docs pages stay static (no cookie read at
// render time).
export async function GET() {
  return NextResponse.json({ admin: await isAdmin() });
}
