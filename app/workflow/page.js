import { redirect } from 'next/navigation';

// /workflow on its own (the builder's back link, old bookmarks) → the
// Workflows tab of the studio.
export default function WorkflowIndexPage() {
  redirect('/studio/workflows');
}
