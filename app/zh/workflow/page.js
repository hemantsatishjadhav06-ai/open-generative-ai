import { redirect } from 'next/navigation';
import { localizeStudioPath } from '@/lib/locales';

// /zh/workflow on its own → the Workflows tab of the Chinese studio.
export default function ZhWorkflowIndexPage() {
  redirect(localizeStudioPath('zh', 'workflows'));
}
