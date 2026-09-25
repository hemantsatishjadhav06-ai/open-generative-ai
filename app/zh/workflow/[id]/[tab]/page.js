import StandaloneShell from '@/components/StandaloneShell';
import { pageTitle } from '@/lib/locales';

export const metadata = {
  title: pageTitle('zh', 'workflow'),
};

// Additive locale route wrapper for /workflow/[id]/[tab].
export default function ZhWorkflowTabPage() {
  return <StandaloneShell locale="zh" />;
}
