"use client";

import { useEffect, useRef, useState } from "react";

// Decorative four-card collage shown above every studio's empty state.
// Each card always paints an on-brand gradient + spark underneath; the stock
// image sits on top only while it actually loads, so a blocked or moved CDN
// never shows alt text or broken-image icons.

const SPARK_PATH = "M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z";
const CDN = "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels";

const CARDS = [
  { src: `${CDN}/sdxl-image.avif`, rotate: "-rotate-[12deg]", round: false, first: true },
  { src: `${CDN}/chroma-image.avif`, rotate: "-rotate-[4deg]", round: false },
  { src: `${CDN}/neta-lumina.avif`, rotate: "rotate-[6deg]", round: true },
  { src: `${CDN}/perfect-pony-xl.avif`, rotate: "rotate-[12deg]", round: false },
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

function CollageCard({ src, rotate, round, first, size }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);

  // Catch errors that fired before React attached onError (SSR/cached).
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  const dims = round ? size.round : size.card;
  const shape = round ? "rounded-full" : "rounded-2xl";
  const overlap = first ? "" : size.overlap;

  return (
    <div
      className={`relative ${dims} ${shape} ${rotate} ${overlap} border border-white/10 shadow-2xl transform hover:rotate-0 hover:scale-110 hover:z-20 transition-all duration-300 overflow-hidden flex-shrink-0 bg-gradient-to-br from-brand/25 via-pop/20 to-surface-card`}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70"
        aria-hidden="true"
        focusable="false"
      >
        <path d={SPARK_PATH} fill="#2ee6d6" />
      </svg>
      {!failed && (
        <img
          ref={imgRef}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
}

export default function HeroCollage({ bare = false, size = "md" }) {
  const sizing = SIZES[size] || SIZES.md;
  const cards = CARDS.map((card) => (
    <CollageCard key={card.src} {...card} size={sizing} />
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
