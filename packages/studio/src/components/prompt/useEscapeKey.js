"use client";

import { useEffect, useRef } from "react";

export function isEscape(event) {
  return Boolean(event) && (event.key === "Escape" || event.key === "Esc");
}

// Calls onEscape when Escape is pressed while `active` is true. Skips events
// another handler already consumed (defaultPrevented) so nested layers close
// one at a time.
export default function useEscapeKey(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (event) => {
      if (!isEscape(event) || event.defaultPrevented) return;
      event.preventDefault();
      onEscape?.(event);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

// Remembers what had focus when a dialog opened and puts focus back there
// when it closes.
export function useFocusReturn(active) {
  const previousRef = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    previousRef.current = typeof document !== "undefined" ? document.activeElement : null;
    return () => {
      const el = previousRef.current;
      previousRef.current = null;
      if (el && typeof el.focus === "function") {
        try { el.focus(); } catch { /* element may be gone */ }
      }
    };
  }, [active]);
}
