import { useEffect, useState } from "react";
import { estimateCost } from "./gateway.js";

const cache = new Map();

/**
 * Estimated USD cost for one run of `model` with `payload`, from
 * POST /api/v1/estimate. Returns null while loading, when there is no
 * estimate, or when `enabled` is false. Results are cached per page.
 */
export default function useCostEstimate(model, payload = {}, { enabled = true } = {}) {
  const key = enabled && model ? `${model}\u0000${JSON.stringify(payload || {})}` : null;
  const [estimate, setEstimate] = useState(() => (key && cache.has(key) ? cache.get(key) : null));

  useEffect(() => {
    if (!key) {
      setEstimate(null);
      return undefined;
    }
    if (cache.has(key)) {
      setEstimate(cache.get(key));
      return undefined;
    }
    setEstimate(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      estimateCost(model, payload, { signal: controller.signal })
        .then((cost) => {
          cache.set(key, cost);
          setEstimate(cost);
        })
        .catch(() => {
          if (!controller.signal.aborted) setEstimate(null);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` already encodes model + payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return estimate;
}
