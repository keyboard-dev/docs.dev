'use client';

import { createOpenAPIPage } from 'fumadocs-openapi/ui';

/**
 * The interactive API reference page (endpoint docs + playground). Created in
 * a client module because its options (codegen, shiki) are functions; the
 * server page passes it the bundled schema via `preloaded`, so no fetching
 * happens at runtime.
 */
export const OpenAPIPage = createOpenAPIPage();
