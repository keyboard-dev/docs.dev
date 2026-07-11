import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { insightsAvailable, insightsStats, listQuestions } from '@/lib/insights';

/**
 * Ask AI insights for admins.
 *
 *   GET ?unanswered=1&limit=50 →
 *     { available, stats: { total7d, unanswered7d }, questions: [...] }
 *
 * `available: false` means the INSIGHTS D1 binding isn't configured — nothing
 * is being logged (see wrangler.jsonc).
 */

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });

  if (!(await insightsAvailable())) {
    return NextResponse.json({ ok: true, available: false, stats: { total7d: 0, unanswered7d: 0 }, questions: [] });
  }

  const url = new URL(request.url);
  const unansweredOnly = url.searchParams.get('unanswered') === '1';
  const limit = Number(url.searchParams.get('limit')) || 50;

  try {
    const [stats, questions] = await Promise.all([insightsStats(), listQuestions({ unansweredOnly, limit })]);
    return NextResponse.json({ ok: true, available: true, stats, questions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
