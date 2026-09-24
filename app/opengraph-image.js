import { ImageResponse } from 'next/og';

// Default social card for every route (og:image + twitter:image, made
// absolute via metadataBase in app/layout.js). English-only on purpose:
// next/og's bundled font is Latin, and no font fetch is attempted.
export const alt = 'Aquora — AI studio for creators';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: '#050b14',
          color: '#eef6ff',
          fontSize: 64,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', width: 84, height: 84, borderRadius: 20, background: 'linear-gradient(135deg, #2ee6d6 0%, #3b82f6 100%)', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="56" height="56" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="#04121a" />
            </svg>
          </div>
          <div style={{ fontWeight: 700 }}>Aquora</div>
        </div>
        <div style={{ fontSize: 36, color: '#2ee6d6', marginTop: 24 }}>Make anything. Ship everything.</div>
        <div style={{ fontSize: 28, color: '#9fb3c8', marginTop: 12 }}>AI studio for creators. Images, video, audio, avatars — 400+ models.</div>
      </div>
    ),
    size,
  );
}
