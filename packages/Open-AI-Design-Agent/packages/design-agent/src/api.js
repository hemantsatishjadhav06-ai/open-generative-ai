// Same-origin client for Aquora's design agent API (/api/v1/creative-agent/*)
// and the gateway upload endpoint. Auth is the HttpOnly session cookie set
// by the app shell; nothing here reads or stores a key.
//
// createApiClient({onAuthRequired, onBudgetExceeded}) → {get, post, patch, del}
//   401 → onAuthRequired(401, message)   (the shell shows the access-code dialog)
//   402 → onBudgetExceeded(detail)       (the shell refreshes its budget pill)
// Every failure throws an ApiError carrying {status, code, message}.

export const API = "/api/v1/creative-agent";
export const UPLOAD_URL = "/api/v1/upload_file";
const UPLOAD_TIMEOUT_MS = 300_000;

// Per-kind caps enforced by the gateway (checked here first for a quick answer).
export const UPLOAD_LIMITS_MB = { image: 25, audio: 50, video: 200 };

export class ApiError extends Error {
  constructor(status, body, fallback = "Request failed") {
    const message = typeof body?.message === "string" && body.message
      ? body.message
      : typeof body?.detail === "string" && body.detail
        ? body.detail
        : `${fallback} (${status || "network"})`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (typeof body?.error === "string") this.code = body.error;
    if (typeof body?.retry_after === "number") this.retryAfter = body.retry_after;
  }
}

function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function report(status, body, handlers) {
  if (status === 401) handlers.onAuthRequired?.(401, body?.message);
  if (status === 402 || body?.error === "budget_exceeded") handlers.onBudgetExceeded?.(body || {});
}

export function createApiClient(handlers = {}) {
  async function request(method, path, body, { signal } = {}) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ApiError(0, null, "Network error");
    }
    const data = parse(await response.text().catch(() => ""));
    if (!response.ok) {
      report(response.status, data, handlers);
      throw new ApiError(response.status, data);
    }
    return data;
  }
  return {
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body = {}, options) => request("POST", path, body, options),
    patch: (path, body = {}, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
  };
}

export function fileKind(file) {
  const type = String(file?.type || "");
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return null;
}

// Uploads a file to the gateway (fal storage) → its public URL.
export function uploadFile(file, { onProgress, ...handlers } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_URL);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      };
    }
    xhr.onload = () => {
      const data = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const url = data?.url || data?.file_url;
        if (typeof url === "string" && url) {
          onProgress?.(100);
          resolve(url);
        } else {
          reject(new ApiError(xhr.status, null, "Upload failed"));
        }
        return;
      }
      report(xhr.status, data, handlers);
      reject(new ApiError(xhr.status, data, "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, null, "Upload failed"));
    xhr.ontimeout = () => reject(new ApiError(0, null, "Upload timed out"));
    xhr.send(form);
  });
}
