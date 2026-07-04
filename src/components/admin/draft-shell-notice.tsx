'use client';

/**
 * Body of the unknown-slug shell. Unknown docs URLs render statically (the
 * docs route is SSG + fill-in, where server cookies aren't available), so the
 * admin gate lives here on the client:
 *   - admins see a draft hint — the InlineEditor takeover then replaces the
 *     article with the shared draft (or the editor itself via ?edit=1)
 *   - everyone else sees a not-found notice (soft 404; the page is noindexed)
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function DraftShellNotice() {
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => !cancelled && setAdmin(!!d.admin))
      .catch(() => !cancelled && setAdmin(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (admin === null) return null;
  if (admin) {
    return <p>This page only exists as a draft — it hasn&apos;t been published yet.</p>;
  }
  return (
    <p>
      This page could not be found. <Link href="/docs">Back to the docs</Link>.
    </p>
  );
}
