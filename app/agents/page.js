import { redirect } from 'next/navigation';

// /agents has no index of its own; the agent gallery lives in the studio.
export default function AgentsIndex() {
  redirect('/studio/agents');
}
