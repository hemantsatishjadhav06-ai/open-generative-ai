import { notFound } from 'next/navigation';
import StandaloneShell from '@/components/StandaloneShell';
import { buildStudioMetadata } from '@/lib/seo';
import { isValidStudioSlug } from '@/lib/studioTabs';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return buildStudioMetadata('zh', slug);
}

// Additive locale route wrapper: reuses the exact same shell component as
// app/studio/[[...slug]]/page.js, only passing `locale="zh"`. A future
// locale repeats this file under app/<locale>/studio/[[...slug]]/page.js.
export default async function ZhStudioPage({ params }) {
  const { slug } = await params;
  if (!isValidStudioSlug(slug)) notFound();
  return <StandaloneShell locale="zh" />;
}
