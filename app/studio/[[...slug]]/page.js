import { notFound } from 'next/navigation';
import StandaloneShell from '@/components/StandaloneShell';
import { buildStudioMetadata } from '@/lib/seo';
import { isValidStudioSlug } from '@/lib/studioTabs';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return buildStudioMetadata('en', slug);
}

export default async function StudioPage({ params }) {
  const { slug } = await params;
  // Unknown first segment (e.g. /studio/not-a-tab) is a real 404, not
  // Image Studio under the wrong URL.
  if (!isValidStudioSlug(slug)) notFound();
  return <StandaloneShell />;
}
