// Aquora gateway access for the workflow builder. Every request goes to this
// site's own API with the HttpOnly session cookie (same origin); the builder
// never holds a key.
//   401 → `aquora:session-required` (the app shell shows the access-code dialog)
//   402 → `aquora:budget-exceeded` (the shell refreshes today's budget)
// Pass `{ silent: true }` in a request config for background calls (cost
// badges) that must not open the dialog on their own.
import axios from "axios";
import { t } from "./i18n";

export const SESSION_REQUIRED_EVENT = "aquora:session-required";
export const BUDGET_EXCEEDED_EVENT = "aquora:budget-exceeded";

function dispatch(name, detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function notifyBudgetExceeded(detail = {}) {
  const { scope, spentUsd, capUsd } = detail || {};
  dispatch(BUDGET_EXCEEDED_EVENT, { scope, spentUsd, capUsd });
}

export const api = axios.create({
  withCredentials: true,
  headers: { Accept: "application/json" },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    if (!error?.config?.silent) {
      if (status === 401) dispatch(SESSION_REQUIRED_EVENT, { status, message: data?.message });
      if (status === 402 || data?.error === "budget_exceeded") notifyBudgetExceeded(data || {});
    }
    return Promise.reject(error);
  },
);

// The gateway's friendly message for a failed request, else `fallback`.
export function errorMessage(error, fallback) {
  const data = error?.response?.data;
  const message = [data?.message, typeof data?.detail === "string" ? data.detail : null, data?.detail?.error]
    .find((value) => typeof value === "string" && value.trim());
  if (message) return message;
  if (!error?.response && error?.message === "Network Error") return t("networkError");
  return fallback;
}

export function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// POST /api/v1/upload_file (multipart field `file`) → the stored file's URL.
export async function uploadFile(file, onProgress) {
  const form = new FormData();
  form.append("file", file);
  const response = await api.post("/api/v1/upload_file", form, {
    timeout: 300000,
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(Math.min(99, Math.round((event.loaded * 100) / event.total)));
    },
  });
  const url = response?.data?.url || response?.data?.file_url;
  if (!isHttpUrl(url)) throw new Error(t("uploadNoUrl"));
  onProgress?.(100);
  return url;
}

// Hosts the page may fetch() (the CSP's connect-src): this site and fal's
// media CDN. Other links are only shown or opened, never fetched.
export function isFetchableMedia(value) {
  if (!isHttpUrl(value) || typeof window === "undefined") return false;
  const url = new URL(value);
  if (url.origin === window.location.origin) return true;
  return url.protocol === "https:" && /(^|\.)fal\.media$/i.test(url.hostname);
}

// Saves a result. Generated files are public links on fal's CDN, so the
// browser fetches them directly; anything else opens in a new tab.
export async function downloadFile(fileUrl, filename = "download") {
  if (!isHttpUrl(fileUrl)) return false;
  if (!isFetchableMedia(fileUrl)) {
    window.open(fileUrl, "_blank", "noopener,noreferrer");
    return false;
  }
  try {
    const response = await fetch(fileUrl, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const href = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(href);
    return true;
  } catch {
    window.open(fileUrl, "_blank", "noopener,noreferrer");
    return false;
  }
}
