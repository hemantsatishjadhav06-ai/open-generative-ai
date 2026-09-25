const SUCCESS_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILURE_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

// Turns a raw upstream/proxy error body into one short, human-readable line.
// JSON bodies surface their message/detail/error; HTML error pages (502s,
// maintenance pages) never reach the UI verbatim.
export function describeApiError(errText) {
  const text = String(errText || "").trim();
  if (!text) return "No details from the AI service.";
  try {
    const j = JSON.parse(text);
    const m = j?.message || j?.detail || j?.error;
    if (typeof m === "string") return m.slice(0, 160);
    if (m) return JSON.stringify(m).slice(0, 160);
  } catch {
    // not JSON
  }
  if (/^\s*</.test(text)) return "The AI service returned an unexpected response. Try again in a moment.";
  return text.slice(0, 100);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function getGenerationErrorDetail(result) {
  if (typeof result?.error === "string") return result.error;
  if (typeof result?.error?.message === "string") return result.error.message;
  if (typeof result?.message === "string") return result.message;
  return "Unknown error";
}

function createGenerationError(result, requestId) {
  const error = new Error(`Generation failed: ${getGenerationErrorDetail(result)}`);
  error.requestId = requestId;
  error.generationResult = result;
  return error;
}

// The gateway returns a failed job's estimated cost to today's budget and
// says so with `refunded: true` (top level, or under `cost`).
export function appendGenerationRefundNotice(message, error) {
  const result = error?.generationResult;
  if (result?.refunded !== true && result?.cost?.refunded !== true) return message;
  return `${message} It wasn't counted against today's budget.`;
}

// Polls the gateway's GET {baseUrl}/api/v1/predictions/<token>/result until
// the job completes or fails. The gateway answers 200 {status:'processing'}
// while a job is queued or running. Auth is the same-origin session cookie;
// `credentials` is only for a caller on another origin (the desktop app).
export async function pollForGenerationResult({
  baseUrl = "",
  requestId,
  maxAttempts = 900,
  interval = 2000,
  onAuthRequired,
  credentials = "same-origin",
  fetchImpl = fetch,
}) {
  const pollUrl = `${baseUrl}/api/v1/predictions/${encodeURIComponent(requestId)}/result`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await wait(interval);

    let response;
    try {
      response = await fetchImpl(pollUrl, {
        headers: { Accept: "application/json" },
        credentials,
        cache: "no-store",
      });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      continue;
    }

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Poll Failed: ${response.status} - ${describeApiError(detail)}`);
      error.requestId = requestId;
      error.status = response.status;

      // 5xx and 429 (poll throttle) are transient: keep polling.
      if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts) continue;
      onAuthRequired?.(response.status, detail);
      throw error;
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      continue;
    }

    const status = result.status?.toLowerCase();
    if (SUCCESS_STATUSES.has(status)) return result;
    if (FAILURE_STATUSES.has(status)) throw createGenerationError(result, requestId);
  }

  const error = new Error(`Generation timed out after polling. Request ID: ${requestId}`);
  error.requestId = requestId;
  throw error;
}
