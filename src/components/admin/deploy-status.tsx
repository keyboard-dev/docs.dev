'use client';

/**
 * Post-publish deploy status — the editor's window into what happened to a
 * publish after the commit landed.
 *
 * Polls /api/admin/deploy-status (GitHub commit checks + the serving build's
 * own commit/version metadata) and renders a small card: the commit, each
 * build check with its state, the currently served deployment, and whether
 * the published commit is live. Polling stops on live, on build failure, or
 * after a timeout.
 *
 * The last publish is remembered in sessionStorage so the card survives
 * closing the editor overlay — the "PUBLISHED ✓" pill stage shows the same
 * live status without re-publishing state through React.
 */

import { useEffect, useRef, useState } from 'react';

export type PublishRef = {
  slug: string;
  sha: string;
  url: string;
  repo: string;
  branch: string;
  at: number;
};

export type DeployStatus = {
  ok: boolean;
  commit: string;
  repo: string;
  buildState: 'failure' | 'running' | 'success' | 'none';
  checks: Array<{ name: string; status: string; conclusion: string | null; url: string | null }>;
  live: 'yes' | 'no' | 'unknown';
  served: {
    commit: string | null;
    branch: string | null;
    builtAt: string | null;
    worker: { versionId: string; versionTag: string; deployedAt: string } | null;
  };
};

const STORE_KEY = 'docsdev:last-publish';
const POLL_MS = 6000;
const POLL_MAX_MS = 15 * 60 * 1000;
/** How long a remembered publish stays interesting after the fact. */
const RECALL_MAX_MS = 30 * 60 * 1000;

export function rememberPublish(ref: PublishRef): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(ref));
  } catch {}
}

export function recallPublish(slug: string): PublishRef | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as PublishRef;
    if (ref.slug !== slug || Date.now() - ref.at > RECALL_MAX_MS) return null;
    return ref;
  } catch {
    return null;
  }
}

export function forgetPublish(): void {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {}
}

/** Poll deploy status for a published commit until it's live, failed, or stale. */
export function useDeployStatus(sha: string | null, startedAt: number | null) {
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    if (!sha) return;
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      if (stopped.current) return;
      setStatus(null);
      setTimedOut(false);
    });

    const tick = async () => {
      if (stopped.current) return;
      if (startedAt != null && Date.now() - startedAt > POLL_MAX_MS) {
        setTimedOut(true);
        return;
      }
      const data = await fetch(`/api/admin/deploy-status?sha=${encodeURIComponent(sha)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<DeployStatus>) : null))
        .catch(() => null);
      if (stopped.current) return;
      if (data) setStatus(data);
      const settled = data != null && (data.live === 'yes' || data.buildState === 'failure');
      if (!settled) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();

    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sha, startedAt]);

  return { status, timedOut };
}

export function phaseOf(status: DeployStatus | null, timedOut: boolean): {
  label: string;
  tone: 'ok' | 'busy' | 'bad';
} {
  if (status?.buildState === 'failure') return { label: 'Build failed', tone: 'bad' };
  if (status?.live === 'yes') return { label: 'Live', tone: 'ok' };
  if (timedOut) return { label: 'Still deploying — taking longer than usual', tone: 'busy' };
  if (status?.buildState === 'success') return { label: 'Built — activating deployment…', tone: 'busy' };
  if (status?.buildState === 'running') return { label: 'Building on Cloudflare…', tone: 'busy' };
  return { label: 'Waiting for the build to start…', tone: 'busy' };
}

const TONE_COLOR: Record<'ok' | 'busy' | 'bad', string> = {
  ok: 'var(--color-fd-success, #16a34a)',
  bad: 'var(--color-fd-error, #dc2626)',
  busy: 'var(--color-fd-muted-foreground)',
};

function checkIcon(c: { status: string; conclusion: string | null }): string {
  if (c.status !== 'completed') return '…';
  if (c.conclusion === 'success') return '✓';
  if (c.conclusion === 'neutral' || c.conclusion === 'skipped') return '–';
  return '✗';
}

function timeShort(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12,
  color: 'var(--color-fd-muted-foreground)', lineHeight: 1.7,
};
const label: React.CSSProperties = { flex: 'none', width: 62, fontWeight: 600, fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', opacity: 0.75 };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' };
const link: React.CSSProperties = { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 };

/** The deploy status card. Rendered under the editor toolbar right after a
 *  publish, and next to the "PUBLISHED ✓" pill after the overlay closes. */
export function DeployStatusCard({ publish, onDismiss, style }: {
  publish: PublishRef;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}) {
  const { status, timedOut } = useDeployStatus(publish.sha, publish.at);
  const phase = phaseOf(status, timedOut);
  const short = publish.sha.slice(0, 7);
  const served = status?.served;

  return (
    <div
      className="dd-pop"
      style={{
        padding: '10px 14px', minWidth: 300, maxWidth: 420,
        fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: TONE_COLOR[phase.tone] }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: phase.tone === 'bad' ? TONE_COLOR.bad : 'inherit' }}>
          {phase.label}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss deploy status"
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-fd-muted-foreground)', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      <div style={row}>
        <span style={label}>Commit</span>
        <span>
          <a href={publish.url} target="_blank" rel="noreferrer" style={{ ...link, ...mono }}>{short}</a>
          {' '}on <span style={mono}>{publish.branch}</span>
        </span>
      </div>

      <div style={row}>
        <span style={label}>Build</span>
        {status == null ? (
          <span>checking…</span>
        ) : status.checks.length === 0 ? (
          <span>no checks reported yet</span>
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {status.checks.map((c) => (
              <span key={c.name}>
                <span style={{ color: c.status === 'completed' && c.conclusion !== 'success' && c.conclusion !== 'neutral' && c.conclusion !== 'skipped' ? TONE_COLOR.bad : undefined }}>
                  {checkIcon(c)} {c.name}
                </span>
                {c.url && (
                  <>
                    {' '}
                    <a href={c.url} target="_blank" rel="noreferrer" style={link}>details</a>
                  </>
                )}
              </span>
            ))}
          </span>
        )}
      </div>

      {served && (
        <div style={row}>
          <span style={label}>Serving</span>
          <span>
            {served.commit ? (
              <span style={mono}>{served.commit.slice(0, 7)}</span>
            ) : (
              'unknown build'
            )}
            {served.worker && (
              <>
                {' '}· v<span style={mono}>{served.worker.versionTag || served.worker.versionId.slice(0, 8)}</span>
                {served.worker.deployedAt && ` · deployed ${timeShort(served.worker.deployedAt)}`}
              </>
            )}
          </span>
        </div>
      )}

      {phase.tone === 'bad' && (
        <div style={{ ...row, color: TONE_COLOR.bad }}>
          <span style={label} />
          <span>
            The site is still serving the previous version. Fix the page and publish again
            {publish.url && (
              <>
                , or <a href={publish.url} target="_blank" rel="noreferrer" style={link}>review the commit</a>
              </>
            )}
            .
          </span>
        </div>
      )}
    </div>
  );
}
