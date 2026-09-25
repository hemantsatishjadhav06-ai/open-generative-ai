export default function manifest() {
  return {
    name: 'Aquora',
    short_name: 'Aquora',
    description: 'Make images, video, audio, avatars and edits with 300+ AI models in one studio.',
    start_url: '/studio',
    scope: '/',
    display: 'standalone',
    background_color: '#050b14',
    theme_color: '#050b14',
    // Not 'maskable': the spark has no safe-zone padding and would be cropped.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
