// Custom Worker entrypoint (wrangler.jsonc `main`) wrapping the OpenNext
// handler — the documented @opennextjs/cloudflare pattern for running code
// before Next.js sees the request.
//
// It exists for ONE job: honor HOME_REDIRECT_TO_DOCS at request time. The
// landing page is statically prerendered, so nothing inside Next can check a
// runtime var for `/` (and OpenNext can't bundle Next 16's proxy.ts yet).
// Reading env here means the toggle works however it was set — the Deploy to
// Cloudflare first-deploy option, wrangler.jsonc `vars`, or a dashboard edit
// — with no rebuild required.
//
// Plain .js on purpose: tsconfig typechecks **/*.ts, and ./.open-next/ only
// exists after `opennextjs-cloudflare build`, so a .ts entry would break
// `pnpm types:check` on a clean checkout.

import handler from './.open-next/worker.js';

const TRUTHY = /^(1|true|yes)$/i;

const worker = {
  async fetch(request, env, ctx) {
    if (TRUTHY.test(env.HOME_REDIRECT_TO_DOCS ?? '')) {
      const url = new URL(request.url);
      if (url.pathname === '/') {
        // Keep the query string so client-side (RSC) fetches to `/` land on
        // the /docs payload instead of an HTML document.
        url.pathname = '/docs';
        // 307, not 308: turning the landing page back on must not fight
        // redirects cached by browsers.
        return Response.redirect(url.toString(), 307);
      }
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
