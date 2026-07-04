import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { aiAvailable, generateDoc, generateImage } from '@/lib/ai';

/**
 * AI generation for the editor.
 *
 *   POST { kind: 'doc', prompt, pageTitle?, pageContext?, useSearch? }
 *     → { ok, markdown, sources }
 *   POST { kind: 'image', prompt }
 *     → { ok, dataUrl, contentType }
 *   GET → { ok, available }   (does this deployment have an AI provider?)
 */

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, available: await aiAvailable() });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    prompt?: string;
    pageTitle?: string;
    pageContext?: string;
    useSearch?: boolean;
  };
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return NextResponse.json({ ok: false, error: 'A prompt is required.' }, { status: 400 });
  }
  try {
    if (body.kind === 'image') {
      const image = await generateImage(body.prompt.slice(0, 1000));
      return NextResponse.json({ ok: true, ...image });
    }
    const doc = await generateDoc({
      prompt: body.prompt.slice(0, 2000),
      pageTitle: body.pageTitle?.slice(0, 200),
      pageContext: body.pageContext,
      useSearch: !!body.useSearch,
    });
    return NextResponse.json({ ok: true, ...doc });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
