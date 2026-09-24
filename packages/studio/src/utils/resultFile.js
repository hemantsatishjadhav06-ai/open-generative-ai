// Helpers for naming, fetching and sharing generated results. Pure and
// SSR-safe: nothing touches window/navigator at import time.
import { getImageDownloadFilename } from "./downloadImage.js";

// "A cat in a hat!" -> "a-cat-in-a-hat". Non-Latin prompts (e.g. zh) give ''.
export function slugifyPrompt(prompt, max = 40) {
  if (typeof prompt !== "string" || !prompt) return "";
  return prompt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function buildResultFilename({ prompt, id, idx, ext } = {}) {
  const base = slugifyPrompt(prompt) || (id != null && id !== "" ? String(id) : "") || String(idx ?? "result");
  return `creator-agency-${base}-${Date.now()}.${ext || "bin"}`;
}

export async function fetchResultFile(url, filename) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], getImageDownloadFilename(filename, blob.type), { type: blob.type });
}

// Web Share with the file when the browser supports it, else the link,
// else copy the link. Returns 'shared' | 'copied' | 'cancelled'.
export async function shareResult({ url, file, title } = {}) {
  try {
    if (file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ url, title });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
    throw error;
  }
}
