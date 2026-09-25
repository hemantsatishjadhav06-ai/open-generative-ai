"use client";

// Provider marks for the Image/Video model pickers, drawn as text chips so the
// studio loads no third-party logo images.

const PROVIDER_STYLES = {
  grok: { text: "xI", bg: "bg-orange-500/10 text-orange-400 border-orange-500/25" },
  openai: { text: "O", bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
  google: { text: "G", bg: "bg-blue-500/10 text-blue-400 border-blue-500/25" },
  blackforest: { text: "BF", bg: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
  bytedance: { text: "BD", bg: "bg-pop-500/10 text-pop-400 border-pop-500/25" },
  midjourney: { text: "MJ", bg: "bg-pop-500/10 text-pop-400 border-pop-500/25" },
  kling: { text: "KL", bg: "bg-rose-500/10 text-rose-400 border-rose-500/25" },
  vidu: { text: "VD", bg: "bg-brand-500/10 text-brand-400 border-brand-500/25" },
  minimax: { text: "MX", bg: "bg-pink-500/10 text-pink-400 border-pink-500/25" },
  ideogram: { text: "ID", bg: "bg-yellow-500/10 text-yellow-400 border-yellow-500/25" },
  luma: { text: "LM", bg: "bg-teal-500/10 text-teal-400 border-teal-500/25" },
  alibaba: { text: "AL", bg: "bg-sky-500/10 text-sky-400 border-sky-500/25" },
  leonardoai: { text: "LE", bg: "bg-violet-500/10 text-violet-400 border-violet-500/25" },
  stability: { text: "SD", bg: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/25" },
  runway: { text: "RW", bg: "bg-slate-500/10 text-slate-300 border-slate-500/25" },
  pixverse: { text: "PX", bg: "bg-indigo-500/10 text-indigo-300 border-indigo-500/25" },
  lightricks: { text: "LT", bg: "bg-lime-500/10 text-lime-300 border-lime-500/25" },
  aquora: { text: "AQ", bg: "bg-brand/10 text-brand border-brand/25" },
};

export function getProviderStyle(provider) {
  if (PROVIDER_STYLES[provider]) return PROVIDER_STYLES[provider];
  const name = provider ? String(provider).toUpperCase() : "AI";
  return { text: name.substring(0, 2), bg: "bg-primary/10 text-primary border-primary/25" };
}

const SIZE_CLASSES = {
  xs: "w-4 h-4 text-[7px] rounded",
  md: "w-8 h-8 text-[10px] rounded-full",
};

// Decorative: the provider's name is always rendered as text next to it.
export default function ProviderChip({ provider, size = "md", className = "" }) {
  const style = getProviderStyle(provider);
  return (
    <span
      aria-hidden="true"
      className={`${SIZE_CLASSES[size] || SIZE_CLASSES.md} shrink-0 border flex items-center justify-center font-black uppercase tracking-tight ${style.bg} ${className}`}
    >
      {style.text}
    </span>
  );
}
