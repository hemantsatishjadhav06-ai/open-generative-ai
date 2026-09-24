// In-app notices for the studio components (validation hints, upload errors,
// "done" messages) instead of the browser's blocking window.alert().
//
// The studio dispatches a cancelable `studio:notify` window event; the host
// app shell listens, renders the notice in its toast stack and calls
// preventDefault() to claim it. With no host listening (e.g. a bare embed),
// we fall back to window.alert so the message is never lost.
import { formatErrorMessage } from "./formatError.js";

export const STUDIO_NOTIFY_EVENT = "studio:notify";

function toText(message) {
  if (typeof message === "string") return message;
  if (message && typeof message.message === "string") return message.message;
  return message == null ? "" : String(message);
}

export function notify(message, { type = "info" } = {}) {
  const text = toText(message).trim();
  if (!text || typeof window === "undefined") return;
  const event = new CustomEvent(STUDIO_NOTIFY_EVENT, {
    detail: { message: text, type: type === "error" ? "error" : type === "success" ? "success" : "info" },
    cancelable: true,
  });
  const claimed = !window.dispatchEvent(event);
  if (!claimed && typeof window.alert === "function") window.alert(text);
}

export function notifyError(message) {
  notify(message, { type: "error" });
}

// For upload/network failures: keeps the caller's friendly prefix but never
// shows raw status codes, proxy envelopes or JSON bodies.
export function friendlyError(err, fallback = "Something went wrong. Try again.") {
  return formatErrorMessage(err, fallback);
}

export function notifySuccess(message) {
  notify(message, { type: "success" });
}
