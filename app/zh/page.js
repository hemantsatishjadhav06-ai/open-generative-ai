import Landing from '@/components/Landing';
import { buildLandingMetadata } from '@/lib/seo';

export const metadata = buildLandingMetadata('zh');

export default function ZhHome() {
  return <Landing locale="zh" />;
}
