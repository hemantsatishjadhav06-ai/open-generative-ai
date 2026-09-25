"use client";

import { useId } from "react";

// Decorative four-card collage shown above every studio's empty state.
// The art is drawn inline in the Aquora palette (turquoise brand, electric
// blue pop, deep-navy surfaces), so the collage needs no network request and
// always renders the same.

const BRAND = "#2ee6d6";
const BRAND_SOFT = "#57f0dc";
const POP = "#3b82f6";
const POP_SOFT = "#93c5fd";
const NAVY = "#0f1c2e";

function ImageArt({ uid }) {
  const sky = `${uid}-sky`;
  return (
    <svg viewBox="0 0 96 112" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={POP} stopOpacity="0.55" />
          <stop offset="1" stopColor={NAVY} />
        </linearGradient>
      </defs>
      <rect width="96" height="112" fill={`url(#${sky})`} />
      <circle cx="68" cy="30" r="11" fill={BRAND_SOFT} opacity="0.9" />
      <path d="M0 88 L28 54 L46 74 L62 58 L96 92 L96 112 L0 112 Z" fill={BRAND} opacity="0.55" />
      <path d="M0 98 L22 80 L44 96 L70 76 L96 100 L96 112 L0 112 Z" fill={NAVY} opacity="0.85" />
    </svg>
  );
}

const SPROCKETS = [28, 44, 60, 76];

function VideoArt({ uid }) {
  const film = `${uid}-film`;
  return (
    <svg viewBox="0 0 96 112" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={film} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND} stopOpacity="0.45" />
          <stop offset="1" stopColor={POP} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect width="96" height="112" fill={NAVY} />
      <rect x="10" y="22" width="76" height="68" rx="10" fill={`url(#${film})`} />
      {SPROCKETS.map((y) => (
        <rect key={`l${y}`} x="4" y={y} width="4" height="8" rx="1.5" fill={POP_SOFT} opacity="0.5" />
      ))}
      {SPROCKETS.map((y) => (
        <rect key={`r${y}`} x="88" y={y} width="4" height="8" rx="1.5" fill={POP_SOFT} opacity="0.5" />
      ))}
      <path d="M41 43 L61 56 L41 69 Z" fill="#ffffff" opacity="0.92" />
    </svg>
  );
}

function SparkArt({ uid }) {
  const glow = `${uid}-glow`;
  return (
    <svg viewBox="0 0 96 96" className="w-full h-full" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor={BRAND} stopOpacity="0.55" />
          <stop offset="1" stopColor={NAVY} />
        </radialGradient>
      </defs>
      <rect width="96" height="96" fill={`url(#${glow})`} />
      <path d="M48 18 l7.2 22.8 L78 48 l-22.8 7.2 L48 78 l-7.2 -22.8 L18 48 l22.8 -7.2 z" fill={BRAND} />
      <circle cx="72" cy="24" r="4" fill={POP_SOFT} opacity="0.8" />
    </svg>
  );
}

const WAVE_BARS = [18, 34, 52, 28, 60, 40, 22, 46, 30];

function AudioArt({ uid }) {
  const wave = `${uid}-wave`;
  return (
    <svg viewBox="0 0 96 112" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={wave} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={POP} />
          <stop offset="1" stopColor={BRAND_SOFT} />
        </linearGradient>
      </defs>
      <rect width="96" height="112" fill={NAVY} />
      <rect width="96" height="112" fill={POP} opacity="0.12" />
      {WAVE_BARS.map((height, i) => (
        <rect key={i} x={10 + i * 8.6} y={56 - height / 2} width="5" height={height} rx="2.5" fill={`url(#${wave})`} />
      ))}
    </svg>
  );
}

const CARDS = [
  { id: "image", Art: ImageArt, rotate: "-rotate-[12deg]", round: false, first: true },
  { id: "video", Art: VideoArt, rotate: "-rotate-[4deg]", round: false },
  { id: "spark", Art: SparkArt, rotate: "rotate-[6deg]", round: true },
  { id: "audio", Art: AudioArt, rotate: "rotate-[12deg]", round: false },
];

const SIZES = {
  md: {
    card: "w-18 h-22 sm:w-24 sm:h-28",
    round: "w-18 h-18 sm:w-24 sm:h-24",
    overlap: "-ml-3 sm:-ml-4",
  },
  lg: {
    card: "w-20 h-24 sm:w-26 sm:h-32",
    round: "w-20 h-20 sm:w-26 sm:h-26",
    overlap: "-ml-4",
  },
};

function CollageCard({ Art, uid, rotate, round, first, size }) {
  const dims = round ? size.round : size.card;
  const shape = round ? "rounded-full" : "rounded-2xl";
  const overlap = first ? "" : size.overlap;

  return (
    <div
      className={`relative ${dims} ${shape} ${rotate} ${overlap} border border-white/10 shadow-2xl transform hover:rotate-0 hover:scale-110 hover:z-20 transition-all duration-300 overflow-hidden flex-shrink-0 bg-surface-card`}
    >
      <Art uid={uid} />
    </div>
  );
}

export default function HeroCollage({ bare = false, size = "md" }) {
  // SVG gradient ids must be unique per page, and a studio can render more
  // than one collage.
  const uid = `hero${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const sizing = SIZES[size] || SIZES.md;
  const cards = CARDS.map(({ id, ...card }) => (
    <CollageCard key={id} uid={`${uid}-${id}`} {...card} size={sizing} />
  ));
  if (bare) return <>{cards}</>;
  return (
    <div
      className="flex items-center justify-center gap-1.5 md:gap-3 mb-10 select-none scale-90 sm:scale-100"
      aria-hidden="true"
    >
      {cards}
    </div>
  );
}
