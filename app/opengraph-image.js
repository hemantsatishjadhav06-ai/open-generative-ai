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
          background: '#f5f7f7',
          color: '#17272d',
          fontSize: 64,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', width: 84, height: 84, borderRadius: 20, background: '#b6e6d9', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="56" height="56" viewBox="0 0 24 24">
              <path d="M5 18 12 4l7 14M8 13h8M4 21h16" fill="none" stroke="#173b32" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontWeight: 700 }}>Aquora</div>
        </div>
        <div style={{ fontSize: 36, color: '#44736b', marginTop: 24 }}>Your ideas. One creative workspace.</div>
        <div style={{ fontSize: 28, color: '#52666c', marginTop: 12 }}>Images, video, audio, agents and workflows.</div>
      </div>
    ),
    size,
  );
}
