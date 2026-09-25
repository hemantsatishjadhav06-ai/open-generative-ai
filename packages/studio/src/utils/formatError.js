function probeText(raw, message) {
  return `${raw} ${message}`;
}

/**
 * Format API and studio error messages into clean, user-friendly strings.
 *
 * `strings` lets a caller (e.g. the app shell) pass localized copy for the
 * canned messages; anything not passed falls back to English.
 */
export function formatErrorMessage(err, fallback = "Generation failed", strings = {}) {
  const s = {
    unreachable: "Couldn't reach the AI service. Try again in a sec.",
    auth: "Authentication failed. Enter your access code to continue.",
    credits: "Today's AI budget is used up. It resets at 00:00 UTC.",
    rateLimited: "Too many requests. Please wait a moment and try again.",
    ...strings,
  };

  if (!err) return fallback;
  let message = typeof err === 'string' ? err : (err.message || fallback);
  if (typeof message !== 'string') message = String(message);
  const raw = message;

  // If message contains JSON payload (e.g. `API Request Failed: 402 Payment Required - {...}`)
  if (message.includes('{') && message.includes('}')) {
    try {
      const jsonStart = message.indexOf('{');
      const jsonStr = message.slice(jsonStart);
      const data = JSON.parse(jsonStr);
      if (data.detail && typeof data.detail === 'string') {
        return data.detail;
      }
      if (data.error?.message && typeof data.error.message === 'string') {
        return data.error.message;
      }
      if (data.message && typeof data.message === 'string') {
        return data.message;
      }
      if (typeof data.error === 'string' && data.error) {
        // Keep going so the status-code mapping below still applies.
        message = data.error;
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  // The gateway's envelopes for unreachable/non-JSON upstreams: the status
  // code there (e.g. a 403 block page) says nothing about the session or budget.
  if (/upstream_unavailable|upstream_unreachable|returned an unexpected response|Couldn't reach the AI service/i.test(probeText(raw, message))) {
    return s.unreachable;
  }

  // Handle common HTTP error codes (checked on the original text so a status
  // code in the prefix still counts after the JSON body was unwrapped).
  const probe = `${raw} ${message}`;
  if (probe.includes('402') || probe.includes('budget_exceeded') || probe.includes('INSUFFICIENT_CREDITS') || probe.toLowerCase().includes('insufficient credits')) {
    return s.credits;
  }
  if (probe.includes('401') || probe.includes('403') || /\bunauthori[sz]ed\b/i.test(message)) {
    return s.auth;
  }
  if (probe.includes('429')) {
    return s.rateLimited;
  }

  // Strip technical prefix like "API Request Failed: 500 Internal Server Error -"
  message = message.replace(/^(API Request Failed|Failed to [a-z ]+|Cost estimate failed): \d+( [^-]+)? - /i, '');

  // Safety net: never show raw payloads, parser errors or network internals.
  if (/[{}]|Unexpected token|is not valid JSON|Failed to fetch|NetworkError|Load failed|ECONNREFUSED|fetch failed/i.test(message)) {
    return s.unreachable;
  }

  return message.length > 150 ? message.slice(0, 147) + '...' : message;
}

/**
 * True for gateway errors the app already handles on its own: 401 (the shell
 * shows the access-code overlay) and 402 (the budget message + header pill).
 */
export function isHandledGatewayError(err) {
  return Boolean(err) && typeof err === 'object' && (err.status === 401 || err.status === 402 || err.code === 'budget_exceeded');
}

/**
 * console.error for studio failures, minus the handled 401/402 cases above
 * (they are expected, already shown to the user, and not bugs).
 */
export function logStudioError(...args) {
  if (args.some(isHandledGatewayError)) return;
  console.error(...args);
}
