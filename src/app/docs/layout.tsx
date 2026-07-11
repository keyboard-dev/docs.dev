import { Suspense } from 'react';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { InlineEditor } from '@/components/admin/inline-editor';
import { SidebarAdmin } from '@/components/admin/sidebar-admin';
import { AssistantDialog } from '@/components/ai/assistant-dialog';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
      <Suspense>
        <InlineEditor />
        <SidebarAdmin />
        <AssistantDialog />
      </Suspense>
    </DocsLayout>
  );
}
