import { redirect } from 'next/navigation';
import { localizeStudioPath } from '@/lib/locales';

// /zh/agents has no index of its own; the agent gallery lives in the studio.
export default function ZhAgentsIndex() {
  redirect(localizeStudioPath('zh', 'agents'));
}
