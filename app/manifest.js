export default function manifest() {
  return {
    name: 'Aquora',
    short_name: 'Aquora',
    description: 'Create images, video and audio, and connect your process with AI agents and workflows.',
    start_url: '/studio',
    scope: '/',
    display: 'standalone',
    background_color: '#0b141c',
    theme_color: '#0b141c',
    // Standard icon purpose; OS masks must not crop the wordmark.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
