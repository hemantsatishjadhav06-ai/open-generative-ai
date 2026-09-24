import { ImageResponse } from 'next/og';

// Default social card for every route (og:image + twitter:image, made
// absolute via metadataBase in app/layout.js). English-only on purpose:
// next/og's bundled font is Latin, and no font fetch is attempted.
export const alt = 'Creator Agency — AI studio for creators';
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
          background: '#08060f',
          color: '#ffffff',
          fontSize: 64,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', width: 84, height: 84, borderRadius: 20, background: '#c6f135', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="56" height="56" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="#08060f" />
            </svg>
          </div>
          <div style={{ fontWeight: 700 }}>Creator Agency</div>
        </div>
        <div style={{ fontSize: 36, color: '#c6f135', marginTop: 24 }}>AI studio for creators</div>
        <div style={{ fontSize: 28, color: '#a9a3b8', marginTop: 12 }}>Images, video, audio, avatars — 400+ models, one studio.</div>
      </div>
    ),
    size,
  );
}
