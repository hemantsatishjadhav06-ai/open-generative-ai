import axios from "axios";

// Same-origin gateway endpoints. Auth is the HttpOnly session cookie that
// the browser sends automatically; no key ever lives in this code.
export const AGENTS_API = "/api/agents";
export const UPLOAD_URL = "/api/v1/upload_file";
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// The access-code dialog lives in the studio shell; on 401 the agent pages
// tell the user to sign in there.
export function isSessionError(err) {
  return err?.response?.status === 401;
}

// Friendly text from a gateway error ({error, message} or {detail:{error}}).
export function errorMessage(err, copy, fallback) {
  if (isSessionError(err)) return copy.errors.sessionEnded;
  const data = err?.response?.data;
  const detail = data?.detail;
  const candidates = [
    data?.message,
    typeof detail === "string" ? detail : detail?.error,
    typeof data?.error === "string" && data.error.includes(" ") ? data.error : null,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  if (found) return found;
  if (!err?.response && err?.request) return copy.errors.lostConnection;
  return fallback || copy.errors.generic;
}

// Uploads one image to the gateway (stored on the AI provider's CDN so it can
// be used as a model input) → its public URL.
export async function uploadImage(file, { copy, onProgress } = {}) {
  if (!file?.type?.startsWith("image/")) throw new Error(copy.errors.imagesOnly);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(copy.errors.imageTooLarge);
  const form = new FormData();
  form.append("file", file);
  try {
    const { data } = await axios.post(UPLOAD_URL, form, {
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.min(99, Math.round((event.loaded * 100) / event.total)));
      },
    });
    const url = data?.url || data?.file_url;
    if (!url) throw new Error(copy.errors.uploadFailed);
    onProgress?.(100);
    return url;
  } catch (err) {
    if (err?.response) throw new Error(errorMessage(err, copy, copy.errors.uploadFailed));
    throw new Error(err?.message && !err?.request ? err.message : copy.errors.uploadFailed);
  }
}

// RFC 4122 v4 id; crypto.randomUUID needs a secure context, so fall back to
// getRandomValues on plain-http dev hosts.
export function newConversationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
