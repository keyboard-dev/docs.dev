'use client';

import { useState } from 'react';

const PROMPT =
  'Read https://app.docs.dev/auth.md and set up a docs.dev documentation site for this repo. When it is live, give me the claim link.';

/**
 * The agent-native call to action: a prompt you paste into Claude Code (or
 * any agent that can read auth.md). The agent registers, provisions the
 * site, deploys it, and hands back one claim link — the user appears
 * exactly once, to claim what it built.
 */
export function AgentPrompt() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the text is selectable either way
    }
  }

  return (
    <div className="mt-6 max-w-[640px]">
      <p className="mb-2 font-mono text-[12px] uppercase tracking-[0.12em] text-fd-muted-foreground">
        Or paste this into Claude Code
      </p>
      <div className="flex items-start gap-2 rounded-2xl border border-[#6366f1]/40 bg-fd-card p-4 shadow-[0_0_24px_rgba(99,102,241,0.1)]">
        <code className="min-w-0 flex-1 break-words font-mono text-[13px] leading-relaxed text-fd-muted-foreground">
          {PROMPT}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 cursor-pointer rounded-full border border-fd-border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-fd-accent"
          aria-label="Copy prompt"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
