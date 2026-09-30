"use client";

// Small, decorative previews keep the empty canvas useful without competing
// with the prompt composer. Inline art works offline and needs no asset load.
const INK = "#0B141C";
const PANEL = "#111E28";
const BRAND = "#7BD9C8";
const ACCENT = "#608FC8";

function ImageArt() {
  return (
    <svg viewBox="0 0 80 88" className="h-full w-full" aria-hidden="true" focusable="false">
      <rect width="80" height="88" fill={PANEL} />
      <rect x="12" y="14" width="56" height="45" rx="6" fill={INK} />
      <circle cx="51" cy="28" r="6" fill={BRAND} />
      <path d="m12 53 18-20 16 17 10-9 12 12v6H12Z" fill={ACCENT} opacity=".8" />
      <rect x="12" y="68" width="35" height="3" rx="1.5" fill={BRAND} opacity=".5" />
      <rect x="12" y="76" width="50" height="3" rx="1.5" fill="#ffffff" opacity=".15" />
    </svg>
  );
}

function VideoArt() {
  return (
    <svg viewBox="0 0 80 88" className="h-full w-full" aria-hidden="true" focusable="false">
      <rect width="80" height="88" fill={PANEL} />
      <rect x="12" y="14" width="56" height="45" rx="6" fill={INK} />
      <circle cx="40" cy="36.5" r="13" fill={ACCENT} opacity=".25" />
      <path d="m36 30 10 6.5L36 43Z" fill={BRAND} />
      <rect x="12" y="68" width="56" height="3" rx="1.5" fill="#ffffff" opacity=".15" />
      <rect x="12" y="68" width="24" height="3" rx="1.5" fill={ACCENT} />
      <rect x="12" y="76" width="36" height="3" rx="1.5" fill="#ffffff" opacity=".15" />
    </svg>
  );
}

const WAVE_BARS = [10, 18, 30, 22, 38, 24, 14];

function AudioArt() {
  return (
    <svg viewBox="0 0 80 88" className="h-full w-full" aria-hidden="true" focusable="false">
      <rect width="80" height="88" fill={PANEL} />
      <rect x="12" y="14" width="56" height="45" rx="6" fill={INK} />
      {WAVE_BARS.map((height, i) => (
        <rect key={i} x={18 + i * 7} y={36.5 - height / 2} width="3" height={height} rx="1.5" fill={i % 2 ? ACCENT : BRAND} />
      ))}
      <rect x="12" y="68" width="42" height="3" rx="1.5" fill={BRAND} opacity=".5" />
      <rect x="12" y="76" width="30" height="3" rx="1.5" fill="#ffffff" opacity=".15" />
    </svg>
  );
}

const PREVIEWS = [ImageArt, VideoArt, AudioArt];
const SIZES = {
  md: "h-[88px] w-20 sm:h-[105.6px] sm:w-24",
  lg: "h-[105.6px] w-24 sm:h-[123.2px] sm:w-28",
};

export default function HeroCollage({ bare = false, size = "md" }) {
  const previews = PREVIEWS.map((Art, index) => (
    <div
      key={index}
      className={`${SIZES[size] || SIZES.md} shrink-0 overflow-hidden rounded-xl border border-white/10 bg-surface-card`}
      aria-hidden="true"
    >
      <Art />
    </div>
  ));
  if (bare) return <>{previews}</>;
  return (
    <div className="mb-7 flex select-none items-center justify-center gap-3" aria-hidden="true">
      {previews}
    </div>
  );
}
