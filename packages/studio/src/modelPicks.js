// Curated "Picks" and search helpers for the Image/Video model pickers.
// Pure data + helpers (no React), so it can be unit-tested with node --test.
// Ids are picker entry ids from modelFamilies.js (imageModelPickerEntries /
// videoModelMenuEntries); ids that stop existing are silently dropped.

export const IMAGE_PICK_IDS = [
  { id: "nano-banana-pro:nano-banana-pro", hintKey: "pickHintAllRounder" },
  { id: "gpt-image-2:gpt-image-2", hintKey: "pickHintText" },
  { id: "ideogram-v3:ideogram-v3-t2i", hintKey: "pickHintTypography" },
  { id: "seedream-5.0:bytedance-seedream-v5.0", hintKey: "pickHintPhotoreal" },
  { id: "nano-banana:nano-banana", hintKey: "pickHintFast" },
];

export const VIDEO_PICK_IDS = [
  { id: "veo-3.1:grouped", hintKey: "pickHintCinematic" },
  { id: "kling-v3:grouped", hintKey: "pickHintMotion" },
  { id: "seedance-2:grouped", hintKey: "pickHintSocial" },
  { id: "sora-2:grouped", hintKey: "pickHintStory" },
];

// Internal/utility endpoints that should not appear in the picker. Matched
// against entry.defaultVariant.model.id. They stay in the catalog, so a
// previously selected one still resolves and shows as the current model.
export const HIDDEN_PICKER_MODEL_IDS = new Set([
  "Api Node",
  "image-passthrough",
  "flux-1-dev-style-lora-inference",
  "z-image-p",
]);

const TOOL_PATTERN = /upscal|watermark|background remover|passthrough/i;

// Utilities (upscalers, watermark tools, background removal) live in their
// own "Tools" tab instead of the main model list.
export function isToolEntry(entry) {
  return TOOL_PATTERN.test(entry?.name || "");
}

export function isHiddenEntry(entry) {
  return HIDDEN_PICKER_MODEL_IDS.has(entry?.defaultVariant?.model?.id);
}

// Task words people actually type -> fragments of model search text.
export const SEARCH_SYNONYMS = {
  thumbnail: ["ideogram", "gpt-image", "nano-banana-pro"],
  logo: ["ideogram", "gpt-image", "recraft"],
  poster: ["ideogram", "gpt-image"],
  text: ["ideogram", "gpt-image"],
  photo: ["seedream", "imagen", "flux"],
  realistic: ["seedream", "imagen", "flux"],
  anime: ["niji", "midjourney"],
  cheap: ["nano-banana", "flux-2-klein", "z-image-turbo"],
  fast: ["turbo", "fast", "lite", "nano-banana"],
  upscale: ["upscal"],
  youtube: ["ideogram", "gpt-image"],
  reel: ["veo", "kling", "seedance"],
  tiktok: ["veo", "kling", "seedance"],
};

export function matchesSearch(entry, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return true;
  const text = String(entry?.searchText || "").toLowerCase();
  if (text.includes(q)) return true;
  for (const token of q.split(/\s+/)) {
    const synonyms = SEARCH_SYNONYMS[token];
    if (synonyms && synonyms.some((s) => text.includes(s))) return true;
  }
  return false;
}

export function resolvePicks(entries, picks) {
  const out = [];
  for (const pick of picks) {
    const entry = entries.find((e) => e.id === pick.id);
    if (entry) out.push({ entry, hintKey: pick.hintKey });
  }
  return out;
}
