import { RootProvider } from 'fumadocs-ui/provider/next';
import { resolveSiteId } from '@/lib/docsdev-sso';
import './global.css';

/**
 * Brand type is self-hosted from public/fonts (declared in global.css):
 * Geist Pixel for headings, Geist for body, Geist Mono for the meta layer.
 * The latin subsets are preloaded so pretext measures against the real
 * fonts on first paint.
 */
export default async function Layout({ children }: LayoutProps<'/'>) {
  // docs.dev-first onboarding: with a setup token deployed, the first page
  // view redeems it (binding this hostname to the dashboard-created site)
  // so the dashboard card flips without anyone visiting /admin. Cached per
  // isolate; a no-op for every deployment without the token.
  if (process.env.DOCSDEV_SITE_TOKEN) await resolveSiteId();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist-pixel-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
