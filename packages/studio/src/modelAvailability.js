// Which studio models Aquora's backend can run right now.
//
// GET /api/v1/models/available → {enabled:[keys], disabled:[keys],
// disabled_models:[studio model ids], thumbnails:{key:url}, served_by:{key:name},
// configured}. A key is the endpoint id a
// studio posts to /api/v1/<key> (model.endpoint || model.id). The list is
// fetched once per page load and shared by every picker.
//
// Until the list arrives (or when it can't be fetched) everything counts as
// available, so the pickers never render empty; the gateway still rejects a
// disabled model on submit. Node tests import this file: nothing runs at
// import time, and there is no React here (the hook lives in
// useModelAvailability.js).
import {
  audioModels,
  i2iModels,
  i2vModels,
  lipsyncModels,
  motionControlModels,
  recastModels,
  t2iModels,
  t2vModels,
  v2vModels,
} from "./models.js";

const AVAILABLE_URL = "/api/v1/models/available";

let snapshot = null; // {enabled:Set, disabled:Set, disabledModels:Set, thumbnails:Map, servedBy:Map, configured:boolean|null}
let inflight = null;
const listeners = new Set();
let modelIndex = null;

function emit() {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* keep notifying the rest */ }
  }
}

function toSet(value) {
  return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
}

// Thumbnails are drawn straight from fal's CDN: only https URLs are kept.
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

function toMap(value, accept = () => true) {
  const map = new Map();
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item && accept(item)) map.set(key, item);
  }
  return map;
}

/** Replace the availability list (the API body). `null` resets to "unknown". */
export function setModelAvailability(data) {
  snapshot = data && typeof data === "object"
    ? Object.freeze({
      enabled: toSet(data.enabled),
      disabled: toSet(data.disabled),
      disabledModels: toSet(data.disabled_models),
      thumbnails: toMap(data.thumbnails, (url) => HTTPS_URL.test(url)),
      servedBy: toMap(data.served_by, (name) => name.length <= 120),
      configured: typeof data.configured === "boolean" ? data.configured : null,
    })
    : null;
  emit();
  return snapshot;
}

export function getModelAvailability() {
  return snapshot;
}

export function subscribeModelAvailability(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fetches the list once per page load. Resolves to the snapshot, or null on failure. */
export function loadModelAvailability() {
  if (snapshot) return Promise.resolve(snapshot);
  if (inflight) return inflight;
  if (typeof window === "undefined" || typeof fetch !== "function") return Promise.resolve(null);
  inflight = fetch(AVAILABLE_URL, { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => (data && Array.isArray(data.enabled) ? setModelAvailability(data) : null))
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function lookupModel(id) {
  if (!modelIndex) {
    modelIndex = new Map();
    for (const list of [t2iModels, i2iModels, t2vModels, i2vModels, v2vModels, lipsyncModels, recastModels, motionControlModels, audioModels]) {
      for (const model of list) if (!modelIndex.has(model.id)) modelIndex.set(model.id, model);
    }
  }
  return modelIndex.get(id) || null;
}

/** True when the gateway has an enabled catalog entry for this endpoint key. */
export function isEndpointAvailable(endpoint) {
  if (!snapshot) return true;
  return typeof endpoint === "string" && snapshot.enabled.has(endpoint);
}

/** Accepts a studio model object or a model id. Unknown ids use the id as the key. */
export function isModelAvailable(modelOrId) {
  if (!snapshot) return true;
  const model = typeof modelOrId === "string" ? (lookupModel(modelOrId) || { id: modelOrId }) : modelOrId;
  if (!model?.id) return false;
  if (snapshot.disabledModels.has(model.id)) return false;
  return snapshot.enabled.has(model.endpoint || model.id);
}

export function filterAvailableModels(models) {
  if (!snapshot) return models;
  return models.filter((model) => isModelAvailable(model));
}

/** The first available model, trying `preferredIds` first; falls back to models[0]. */
export function firstAvailableModel(models, preferredIds = []) {
  for (const id of preferredIds) {
    const model = models.find((candidate) => candidate.id === id);
    if (model && isModelAvailable(model)) return model;
  }
  return models.find((model) => isModelAvailable(model)) || models[0] || null;
}

function keyOf(modelOrId) {
  const model = typeof modelOrId === "string" ? (lookupModel(modelOrId) || { id: modelOrId }) : modelOrId;
  return model?.endpoint || model?.id || null;
}

/** fal thumbnail URL for a studio model (object or id), or null. */
export function getModelThumbnail(modelOrId) {
  const key = snapshot ? keyOf(modelOrId) : null;
  return (key && snapshot.thumbnails?.get(key)) || null;
}

/** Name of the model that actually runs when it differs from the picker's ("Runs on …"), or null. */
export function getModelServedBy(modelOrId) {
  const key = snapshot ? keyOf(modelOrId) : null;
  return (key && snapshot.servedBy?.get(key)) || null;
}
