import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  filterAvailableModels,
  firstAvailableModel,
  getModelAvailability,
  isModelAvailable,
  loadModelAvailability,
  subscribeModelAvailability,
} from "./modelAvailability.js";

const getServerSnapshot = () => null;

/**
 * Starts the once-per-page GET /api/v1/models/available and re-renders when
 * it arrives. Returns the availability snapshot, or null while it is unknown
 * (then every model counts as available).
 */
export default function useModelAvailability() {
  const snapshot = useSyncExternalStore(subscribeModelAvailability, getModelAvailability, getServerSnapshot);
  useEffect(() => {
    loadModelAvailability();
  }, []);
  return snapshot;
}

/**
 * For a studio with a flat model list: returns the models the gateway can
 * run, and calls `onFallback(model)` with the first runnable one whenever the
 * selected model id can't run (e.g. the default, or a restored draft).
 */
export function useAvailableModels(models, selectedId, onFallback, preferredIds = []) {
  const snapshot = useModelAvailability();
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const preferredKey = preferredIds.join("\u0000");
  const visible = useMemo(
    () => (snapshot ? filterAvailableModels(models) : models),
    [models, snapshot],
  );
  useEffect(() => {
    if (!snapshot || !selectedId || isModelAvailable(selectedId)) return;
    const first = firstAvailableModel(models, preferredKey ? preferredKey.split("\u0000") : []);
    if (first && first.id !== selectedId && isModelAvailable(first)) fallbackRef.current?.(first);
  }, [snapshot, selectedId, models, preferredKey]);
  return visible;
}
