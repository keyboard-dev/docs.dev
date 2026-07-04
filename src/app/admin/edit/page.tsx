'use client';

import { useEffect, useState } from 'react';
import { DocEditor } from '@/components/admin/doc-editor';

export default function EditPage() {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSlug(new URLSearchParams(window.location.search).get('slug') ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (slug == null) return null;
  return <DocEditor slug={slug} />;
}
