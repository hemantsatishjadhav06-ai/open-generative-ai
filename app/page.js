import Landing from '@/components/Landing';
import { buildLandingMetadata } from '@/lib/seo';

export const metadata = buildLandingMetadata('en');

export default function Home() {
  return <Landing locale="en" />;
}
