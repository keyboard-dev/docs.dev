import { getLLMText, source } from '@/lib/source';
import { isProtectedSlug } from '@/lib/protect';

export const revalidate = false;

export async function GET() {
  // Reading-PIN-protected pages never appear in the public full-text dump.
  const scan = source
    .getPages()
    .filter((page) => !isProtectedSlug(page.slugs))
    .map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response(scanned.join('\n\n'));
}
