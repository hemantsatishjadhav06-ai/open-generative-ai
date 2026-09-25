"use client";

// Provider marks and model thumbnails for the Image/Video model pickers.
// Provider marks are text chips (no third-party logos); model thumbnails are
// fal's own model-card images (GET /api/v1/models/available → thumbnails),
// with a branded Aquora tile when a model has none or the image fails.

import { useState } from "react";
import useModelAvailability from "../useModelAvailability.js";
import { getModelServedBy, getModelThumbnail } from "../modelAvailability.js";

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

const THUMB_SIZES = {
  xs: "w-4 h-4 rounded text-[7px]",
  md: "w-8 h-8 rounded-lg text-[10px]",
};

function variantModels(entryOrModel) {
  if (!entryOrModel) return [];
  if (entryOrModel.defaultVariant || entryOrModel.variantsByMode) {
    const variants = [entryOrModel.defaultVariant, ...Object.values(entryOrModel.variantsByMode || {})];
    return variants.map((variant) => variant?.model).filter(Boolean);
  }
  return [entryOrModel];
}

/** fal thumbnail for a picker entry (first variant that has one) or a studio model. */
export function thumbnailFor(entryOrModel) {
  for (const model of variantModels(entryOrModel)) {
    const url = getModelThumbnail(model);
    if (url) return url;
  }
  return null;
}

/** "Runs on …" name when the picker model is served by another fal model. */
export function servedByFor(entryOrModel) {
  const [model] = variantModels(entryOrModel);
  return model ? getModelServedBy(model) : null;
}

// Branded placeholder: Aquora gradient tile with the provider's initials.
function ThumbPlaceholder({ provider, size }) {
  const style = getProviderStyle(provider);
  return (
    <span
      aria-hidden="true"
      data-model-thumb="placeholder"
      className={`${THUMB_SIZES[size] || THUMB_SIZES.md} shrink-0 flex items-center justify-center font-black uppercase tracking-tight text-white/90 border border-white/10 bg-gradient-to-br from-brand/40 via-primary/25 to-sky-500/30`}
    >
      {style.text}
    </span>
  );
}

// Decorative thumbnail (the model name is always rendered next to it).
export function ModelThumb({ entry, model, provider, size = "md", className = "" }) {
  useModelAvailability();
  const url = thumbnailFor(entry || model);
  const [failed, setFailed] = useState(null);
  if (!url || failed === url) return <ThumbPlaceholder provider={provider} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden="true"
      data-model-thumb="fal"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(url)}
      className={`${THUMB_SIZES[size] || THUMB_SIZES.md} shrink-0 object-cover border border-white/10 bg-white/[0.04] ${className}`}
    />
  );
}
