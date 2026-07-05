'use client';

/**
 * Image component that prefers a locally-uploaded draft asset.
 *
 * For `/uploads/*` sources it checks IndexedDB: in the admin's browser a freshly
 * uploaded image shows instantly from its local data URL, before anything is
 * committed. For every other reader (and once published) the asset isn't in
 * IndexedDB, so it falls back to the real URL the published site serves.
 *
 * `src` can be a plain string (draft previews, raw HTML) or the static-import
 * object fumadocs-mdx produces for Markdown images in published pages
 * ({ src, width, height }) — both must render; coercing the object to '' is
 * how images silently lose their src in prerendered HTML.
 */

import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { getAsset } from '@/lib/drafts';

type StaticImport = { src: string; width?: number; height?: number };

type DraftImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | StaticImport;
};

export function DraftImage({ src: rawSrc, ...props }: DraftImageProps) {
  const src = typeof rawSrc === 'string' ? rawSrc : (rawSrc?.src ?? '');
  const imported = typeof rawSrc === 'object' ? rawSrc : undefined;
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
      queueMicrotask(() => {
        if (active) setResolved(src);
      });
    }
    return () => {
      active = false;
    };
  }, [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={resolved}
      width={props.width ?? imported?.width}
      height={props.height ?? imported?.height}
      alt={props.alt ?? ''}
    />
  );
}
