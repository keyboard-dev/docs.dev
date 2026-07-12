'use client';

/**
 * Admin-only editing for the landing hero. The landing is application code,
 * not MDX — so instead of the page editor, signed-in admins get an "Edit
 * hero" pill that opens a small panel. Saving commits content/landing.json
 * to the repo (like Publish) and the copy goes live with the next build.
 */

import { useEffect, useState } from 'react';

type Landing = { eyebrow: string; headline1: string; headline2: string; subhead: string };

export function EditHero({ initial }: { initial: Landing }) {
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Landing>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d.admin))
      .catch(() => {});
  }, []);

  if (!canEdit) return null;

  const field: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-fd-border, #ccc)',
    background: 'var(--color-fd-background, transparent)',
    color: 'inherit',
    fontSize: 14,
  };

  async function save() {
    setSaving(true);
    setNotice('');
    try {
      const res = await fetch('/api/admin/landing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setNotice(data.ok ? 'Committed — live after the next build (~2 min).' : (data.error ?? 'Save failed.'));
      if (data.ok) setTimeout(() => setOpen(false), 2500);
    } catch {
      setNotice('Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 rounded-full border border-fd-border bg-fd-card px-4 py-2 text-[13px] font-semibold shadow-lg transition-colors hover:bg-fd-accent"
      >
        {open ? 'Close' : '✏️ Edit hero'}
      </button>
      {open && (
        <div className="fixed bottom-16 right-5 z-50 w-[380px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-fd-border bg-fd-card p-4 shadow-2xl">
          <p className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fd-muted-foreground">
            Landing hero — saving commits to your repo
          </p>
          {(
            [
              ['eyebrow', 'Eyebrow'],
              ['headline1', 'Headline line 1'],
              ['headline2', 'Headline line 2'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="mb-2 block text-[12px] text-fd-muted-foreground">
              {label}
              <input
                style={field}
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="mb-3 block text-[12px] text-fd-muted-foreground">
            Subhead
            <textarea
              style={{ ...field, minHeight: 84, resize: 'vertical' }}
              value={values.subhead}
              onChange={(e) => setValues((v) => ({ ...v, subhead: e.target.value }))}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-full bg-[#6366f1] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Committing…' : 'Save'}
            </button>
            {notice && <span className="text-[12px] text-fd-muted-foreground">{notice}</span>}
          </div>
        </div>
      )}
    </>
  );
}
