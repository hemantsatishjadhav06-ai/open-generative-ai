import './globals.css';
import { Inter, Space_Grotesk } from 'next/font/google';
import { headers } from 'next/headers';
import { getLocaleConfig } from '@/lib/locales';

// Body face. Exposed as --font-inter and consumed by tailwind `font-sans`
// and the body rule in globals.css.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// Display face for the wordmark and h1/h2. Exposed as --font-display.
const spaceGrotesk = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const SITE_TITLE = 'Creator Agency — AI studio for creators';
const SITE_DESCRIPTION = 'Make images, video, audio, avatars and edits with 400+ AI models in one studio. No gatekeeping, no fluff.';

export const metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: 'Creator Agency',
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: 'Creator Agency',
    type: 'website',
  },
};

export const viewport = {
  themeColor: '#08060f',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }) {
  // Locale is derived from the URL path by middleware.js and passed
  // through as a plain response header — the root layout is shared by
  // every locale's route tree, so it can't take a `locale` prop directly.
  const headerList = await headers();
  const { htmlLang } = getLocaleConfig(headerList.get('x-locale'));

  return (
    <html lang={htmlLang}>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans`}>{children}</body>
    </html>
  );
}
