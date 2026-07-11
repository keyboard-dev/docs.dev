import { NextResponse } from 'next/server';
import { aiMocked } from '@/lib/ai';
import { workersAI } from '@/lib/ai';
import { CHAT_LIMITS, streamAssistantAnswer, type ChatMessage } from '@/lib/assistant';

/**
 * Public "Ask AI" endpoint.
 *
 *   GET  → { ok, available }              (does this deployment have AI?)
 *   POST { messages: [{role, content}] }  → SSE stream (see lib/assistant.ts)
 *
 * Best-effort rate limit: per-IP sliding window, held in isolate memory.
 * Workers isolates are ephemeral and per-PoP so this is not a hard quota —
 * it exists to stop casual loops, not determined abuse.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory cap
  return false;
}

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CHAT_LIMITS.maxMessages) return null;
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    if (content.length === 0 || content.length > CHAT_LIMITS.maxMessageChars) return null;
    messages.push({ role, content });
  }
  if (messages.at(-1)?.role !== 'user') return null;
  return messages;
}

export async function GET() {
  return NextResponse.json({ ok: true, available: aiMocked() || (await workersAI()) != null });
}

export async function POST(request: Request) {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many requests — try again in a minute.' }, { status: 429 });
  }

  const messages = parseMessages(await request.json().catch(() => null));
  if (!messages) {
    return NextResponse.json({ ok: false, error: 'Invalid messages payload.' }, { status: 400 });
  }

  // Page context for anonymous insights — same-origin referer path only,
  // never the reader's identity.
  let page = '';
  try {
    const ref = new URL(request.headers.get('referer') ?? '');
    if (ref.origin === new URL(request.url).origin) page = ref.pathname;
  } catch {
    // no/invalid referer — log without page context
  }

  try {
    const stream = await streamAssistantAnswer(messages, { page });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
