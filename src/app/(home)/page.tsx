import type { Metadata } from 'next';
import { landingCopy } from '@/lib/landing';
import { Landing } from '@/components/landing/landing';

// The landing ("layout") page. All copy lives in content/landing.json —
// admins edit it on the page itself via the "Edit layout" panel, which
// publishes by committing that file (see /api/admin/layout).

export const metadata: Metadata = {
  title: landingCopy.meta.title,
  description: landingCopy.meta.description,
};

export default function HomePage() {
  return <Landing published={landingCopy} />;
}
