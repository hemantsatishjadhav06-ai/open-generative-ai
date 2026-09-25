import StandaloneShell from '@/components/StandaloneShell';
import { pageTitle } from '@/lib/locales';

export const metadata = {
  title: pageTitle('zh', 'workflow'),
};

// Additive locale route wrapper for /workflow/[id] (see app/zh/studio).
export default function ZhWorkflowPage() {
  return <StandaloneShell locale="zh" />;
}
