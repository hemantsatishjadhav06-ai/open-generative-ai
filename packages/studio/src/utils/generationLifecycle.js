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

export function appendGenerationRefundNotice(message, error) {
  const cost = error?.generationResult?.cost;
  if (cost?.refunded !== true) return message;

  const credits = cost.amount_credits;
  const notice = Number.isFinite(credits)
    ? `Refunded ${credits} credit${credits === 1 ? "" : "s"}.`
    : "The generation cost was refunded.";
  return `${message} ${notice}`;
}

export async function pollForGenerationResult({
  baseUrl,
  requestId,
  apiKey,
  maxAttempts = 900,
  interval = 2000,
  onAuthRequired,
  fetchImpl = fetch,
}) {
  const pollUrl = `${baseUrl}/api/v1/predictions/${requestId}/result`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await wait(interval);

    let response;
    try {
      response = await fetchImpl(pollUrl, {
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      continue;
    }

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Poll Failed: ${response.status} - ${describeApiError(detail)}`);
      error.requestId = requestId;

      if (response.status >= 500 && attempt < maxAttempts) continue;
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
