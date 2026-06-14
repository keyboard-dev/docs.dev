'use client';

/**
 * On-page entry to the editor. Mounted on every docs page; renders nothing
 * unless the visitor has an admin session. When signed in, a single "Edit page"
 * button opens the one cohesive editor (DocEditor) as a full overlay — replacing
 * the old inline/drawer/layout split with a single way to edit.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DocEditor } from './doc-editor';

const ACCENT = 'var(--docsdev-accent, #c2571f)';

function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/docs')) return null;
  return pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
}

export function InlineEditor() {
  const pathname = usePathname();
  const slug = slugFromPath(pathname);
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => !cancelled && setAdmin(!!d.admin))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!admin || slug == null) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '12px 18px',
            borderRadius: 999,
            border: 'none',
            background: ACCENT,
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            cursor: 'pointer',
          }}
        >
          ✎ Edit page
        </button>
      )}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#FAF8F4', overflow: 'auto' }}>
          <DocEditor slug={slug} onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
