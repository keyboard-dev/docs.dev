'use client';

/**
 * Reader-facing "Ask AI" chat. A floating trigger opens a panel that streams
 * answers from /api/chat (SSE: one `sources` event, then Workers AI token
 * events). Rendering is a deliberately tiny markdown subset (links, inline
 * code, bold, fenced code, lists) built as React nodes — no HTML injection.
 *
 * The trigger only renders when the deployment reports AI availability, so
 * plain `next start` (no Workers AI binding, no AI_MOCK) shows nothing.
 */

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';

type Source = { title: string; url: string };
type Turn = { role: 'user' | 'assistant'; content: string; sources?: Source[] };

const SUGGESTIONS = [
  'How do I get started?',
  'How does publishing work?',
  'Can agents read these docs as markdown?',
];

/* ---------------- tiny markdown subset ---------------- */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      const href = m[2];
      out.push(
        href.startsWith('/') ? (
          <Link key={k++} href={href} className="text-fd-primary underline underline-offset-2">
            {m[1]}
          </Link>
        ) : (
          <a key={k++} href={href} rel="noreferrer noopener" target="_blank" className="text-fd-primary underline underline-offset-2">
            {m[1]}
          </a>
        ),
      );
    } else if (m[3]) {
      out.push(
        <code key={k++} className="rounded bg-fd-muted px-1 py-0.5 text-[0.85em]">
          {m[3]}
        </code>,
      );
    } else if (m[4]) {
      out.push(<strong key={k++}>{m[4]}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```(?:[a-z0-9-]*)\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(
        <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-fd-muted p-3 text-xs">
          <code>{part.replace(/\n$/, '')}</code>
        </pre>,
      );
      return;
    }
    for (const [j, para] of part.split(/\n{2,}/).entries()) {
      const lines = para.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
      if (isList) {
        blocks.push(
          <ul key={`${i}-${j}`} className="my-2 list-disc space-y-1 pl-5">
            {lines.map((l, n) => (
              <li key={n}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>
            ))}
          </ul>,
        );
      } else {
        blocks.push(
          <p key={`${i}-${j}`} className="my-2 first:mt-0 last:mb-0">
            {lines.map((l, n) => (
              <Fragment key={n}>
                {n > 0 ? ' ' : null}
                {inline(l.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>,
        );
      }
    }
  });
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

/* ---------------- chat panel ---------------- */

export function AssistantDialog() {
  const [available, setAvailable] = useState(false);
  // Admins get floating editor chrome (Edit page, deploy status) in the same
  // bottom-right corner at a higher z-index — shift the assistant above it.
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat')
      .then((r) => r.json())
      .then((d) => !cancelled && setAvailable(!!d.available))
      .catch(() => {});
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => !cancelled && setAdmin(!!d.admin))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput('');
    setBusy(true);
    const history = [...turns, { role: 'user' as const, content: q }];
    setTurns([...history, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `The assistant is unavailable (HTTP ${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let sources: Source[] | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const data = event
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { response?: string; sources?: Source[] };
            if (parsed.sources) sources = parsed.sources;
            if (parsed.response) answer += parsed.response;
          } catch {
            // ignore malformed keep-alive/meta events
          }
        }
        setTurns([...history, { role: 'assistant', content: answer, sources }]);
      }
      if (!answer) throw new Error('The assistant returned no answer.');
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError((err as Error).message);
        setTurns(history); // drop the empty assistant bubble
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!available) return null;

  const bottom = admin ? 'bottom-[7.5rem]' : 'bottom-5';

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`fixed ${bottom} right-5 z-40 flex items-center gap-2 rounded-full border border-fd-border bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground shadow-lg transition-transform hover:scale-105`}
          aria-label="Ask AI about these docs"
        >
          <MessageCircle className="size-4" />
          Ask AI
        </button>
      )}
      {open && (
        <div className={`fixed ${bottom} right-5 z-40 flex h-[min(560px,80dvh)] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-popover text-fd-popover-foreground shadow-2xl`}>
          <div className="flex items-center justify-between border-b border-fd-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4" />
              Ask AI
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-fd-muted-foreground hover:bg-fd-muted"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-fd-muted-foreground">
                  Answers come from these docs, with links to the pages used.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="block w-full rounded-lg border border-fd-border px-3 py-2 text-left text-sm hover:bg-fd-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="ml-8 rounded-lg bg-fd-primary px-3 py-2 text-sm text-fd-primary-foreground">
                  {turn.content}
                </div>
              ) : (
                <div key={i} className="mr-4">
                  {turn.content ? (
                    <Markdown text={turn.content} />
                  ) : (
                    <p className="text-sm text-fd-muted-foreground">Thinking…</p>
                  )}
                  {turn.sources && turn.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {turn.sources.map((s) => (
                        <Link
                          key={s.url}
                          href={s.url}
                          className="rounded-full border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground hover:bg-fd-muted"
                        >
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {error && <p className="text-sm text-fd-error">{error}</p>}
          </div>

          <form
            className="flex items-center gap-2 border-t border-fd-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about these docs…"
              className="min-w-0 flex-1 rounded-lg border border-fd-border bg-transparent px-3 py-2 text-base outline-none focus:border-fd-primary sm:text-sm"
              maxLength={4000}
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              className="rounded-lg bg-fd-primary p-2 text-fd-primary-foreground disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
