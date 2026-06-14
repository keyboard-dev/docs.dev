'use client';

/**
 * Image component that prefers a locally-uploaded draft asset.
 *
 * For `/uploads/*` sources it checks IndexedDB: in the admin's browser a freshly
 * uploaded image shows instantly from its local data URL, before anything is
 * committed. For every other reader (and once published) the asset isn't in
 * IndexedDB, so it falls back to the real URL the published site serves.
 */

import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { getAsset } from '@/lib/drafts';

export function DraftImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === 'string' ? props.src : '';
  const [resolved, setResolved] = useState<string>(src);

  useEffect(() => {
    let active = true;
    if (src.startsWith('/uploads/')) {
      getAsset(src)
        .then((a) => {
          if (active && a) setResolved(a.dataUrl);
        })
        .catch(() => {});
    } else {
      setResolved(src);
    }
    return () => {
      active = false;
    };
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={resolved} alt={props.alt ?? ''} />;
}
