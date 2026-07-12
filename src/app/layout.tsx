import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

// Every page carries the brand in the tab; pages with their own metadata
// slot into the template ("Getting started · docs.dev").
export const metadata: Metadata = {
  title: { default: 'docs.dev', template: '%s · docs.dev' },
};

/**
 * Brand type is self-hosted from public/fonts (declared in global.css):
 * Geist Pixel for headings, Geist for body, Geist Mono for the meta layer.
 * The latin subsets are preloaded so pretext measures against the real
 * fonts on first paint.
 */
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist-pixel-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="flex flex-col min-h-screen">
        {/* Dark-first: the brand scheme is deep navy + indigo (see
            global.css); readers can still flip to light from the theme
            toggle. */}
        <RootProvider theme={{ defaultTheme: 'dark' }}>{children}</RootProvider>
      </body>
    </html>
  );
}
