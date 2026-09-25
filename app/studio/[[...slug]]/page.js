import { notFound, redirect } from 'next/navigation';
import StandaloneShell from '@/components/StandaloneShell';
import { buildStudioMetadata } from '@/lib/seo';
import { isRetiredStudioSlug, isValidStudioSlug } from '@/lib/studioTabs';
import { localizeStudioPath } from '@/lib/locales';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return buildStudioMetadata('en', slug);
}

export default async function StudioPage({ params }) {
  const { slug } = await params;
  // Removed/hidden tabs (Explore Apps, Vibe Motion): old links open the
  // studio instead of a 404.
  if (isRetiredStudioSlug(slug)) redirect(localizeStudioPath('en'));
  // Unknown first segment (e.g. /studio/not-a-tab) is a real 404, not
  // Image Studio under the wrong URL.
  if (!isValidStudioSlug(slug)) notFound();
  return <StandaloneShell />;
}
