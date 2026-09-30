// Pending media jobs are saved separately from drafts, immediately when the
// gateway returns its signed token. Refreshing must poll it, never resubmit it.
import { useCallback, useEffect, useRef, useState } from "react";
import { pollForGenerationResult } from "./utils/generationLifecycle.js";
import { notifySessionRequired } from "./session.js";

export function pendingJobsKey(persistKey) {
  return typeof persistKey === "string" && persistKey.includes(":ws-") ? `${persistKey}:pending-v1` : null;
}

export function readPendingJobs(persistKey, storage = globalThis.localStorage) {
  const key = pendingJobsKey(persistKey);
  if (!key || !storage) return [];
  try {
    const jobs = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(jobs) ? jobs.filter((job) => typeof job?.requestId === "string" && job.requestId && typeof job.model === "string").slice(0, 16) : [];
  } catch { return []; }
}

export function writePendingJobs(persistKey, jobs, storage = globalThis.localStorage) {
  const key = pendingJobsKey(persistKey);
  if (!key || !storage) return false;
  try {
    if (jobs.length) storage.setItem(key, JSON.stringify(jobs.slice(0, 16)));
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

export function isTerminalGenerationError(error) {
  const status = error?.generationResult?.status?.toLowerCase();
  return ["failed", "error", "cancelled", "canceled"].includes(status)
    || [400, 403, 404, 410, 422].includes(error?.status);
}

// Store completed output before removing its pending token. The existing
// component save is debounced; a second immediate refresh must keep results.
export function persistGenerationResult(persistKey, entry, historyField, extra = {}, storage = globalThis.localStorage) {
  if (!pendingJobsKey(persistKey) || !storage) return false;
  try {
    const state = JSON.parse(storage.getItem(persistKey) || "{}");
    const history = Array.isArray(state[historyField]) ? state[historyField] : [];
    storage.setItem(persistKey, JSON.stringify({ ...state, ...extra,
      [historyField]: [entry, ...history.filter((item) => item.id !== entry.id && item.url !== entry.url)].slice(0, 50),
    }));
    return true;
  } catch { return false; }
}

export default function usePendingGeneration({ persistKey, onStart, onEnd, onResult, onError }) {
  const callbacks = useRef({ onStart, onEnd, onResult, onError });
  callbacks.current = { onStart, onEnd, onResult, onError };
  const [hasPending, setHasPending] = useState(false);
  const keyRef = useRef(persistKey);
  keyRef.current = persistKey;
  const recoveryRef = useRef(null);

  const update = useCallback((transform) => {
    const jobs = transform(readPendingJobs(persistKey));
    writePendingJobs(persistKey, jobs);
    if (keyRef.current === persistKey) setHasPending(jobs.length > 0);
    return jobs;
  }, [persistKey]);

  const remember = useCallback((requestId, metadata) => {
    const job = { ...metadata, requestId, timestamp: metadata.timestamp || new Date().toISOString() };
    update((jobs) => [...jobs.filter((item) => item.requestId !== requestId), job]);
    return job;
  }, [update]);
  const complete = useCallback((requestId) => update((jobs) => jobs.filter((job) => job.requestId !== requestId)), [update]);
  const fail = useCallback((requestId, error) => {
    if (requestId && isTerminalGenerationError(error)) complete(requestId);
  }, [complete]);

  const resume = useCallback(async () => {
    if (recoveryRef.current || !persistKey) return;
    const jobs = readPendingJobs(persistKey);
    setHasPending(jobs.length > 0);
    if (!jobs.length) return;
    const controller = new AbortController();
    recoveryRef.current = controller;
    callbacks.current.onStart?.();
    try {
      await Promise.allSettled(jobs.map(async (job) => {
        try {
          const result = await pollForGenerationResult({ requestId: job.requestId, interval: 2000,
            maxAttempts: 900, onAuthRequired: notifySessionRequired, signal: controller.signal });
          if (controller.signal.aborted || keyRef.current !== persistKey) return;
          const url = result?.outputs?.[0] || result?.url || result?.output?.url;
          if (!url) throw new Error("The completed job did not return a media URL.");
          await callbacks.current.onResult?.({ ...result, url, request_id: job.requestId }, job);
          complete(job.requestId);
        } catch (error) {
          if (controller.signal.aborted || keyRef.current !== persistKey) return;
          fail(job.requestId, error);
          callbacks.current.onError?.(error);
        }
      }));
    } finally {
      if (recoveryRef.current === controller) recoveryRef.current = null;
      if (!controller.signal.aborted && keyRef.current === persistKey) callbacks.current.onEnd?.();
    }
  }, [persistKey, complete, fail]);

  useEffect(() => {
    void resume();
    return () => {
      recoveryRef.current?.abort();
      recoveryRef.current = null;
    };
  }, [resume]);

  return { remember, complete, fail, hasPending, resume };
}
