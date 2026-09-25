import StandaloneShell from '@/components/StandaloneShell';
import { pageTitle } from '@/lib/locales';

export const metadata = {
  title: pageTitle('en', 'workflow'),
};

export default function WorkflowPage() {
  return <StandaloneShell />;
}
