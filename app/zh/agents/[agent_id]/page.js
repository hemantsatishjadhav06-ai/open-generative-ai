// Additive locale route: the same page as /agents/[agent_id]; its locale
// comes from the /zh path (middleware x-locale header).
export { default, generateMetadata } from '../../../agents/[agent_id]/page';

export const dynamic = 'force-dynamic';
