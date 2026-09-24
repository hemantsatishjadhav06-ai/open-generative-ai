export default function manifest() {
  return {
    name: 'Creator Agency',
    short_name: 'Creator Agency',
    description: 'Make images, video, audio, avatars and edits with 400+ AI models in one studio.',
    start_url: '/studio',
    scope: '/',
    display: 'standalone',
    background_color: '#08060f',
    theme_color: '#08060f',
    // Not 'maskable': the spark has no safe-zone padding and would be cropped.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
