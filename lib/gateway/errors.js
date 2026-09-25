// Typed errors for the gateway. Route handlers turn a GatewayError into a JSON
// response `{ error: <code>, message: <friendly copy>, ...extra }` with the
// right status. The `code` values double as the tokens the studio's
// formatErrorMessage keys off (402, 429, upstream_unavailable, ...), so keep
// them stable.

export class GatewayError extends Error {
    constructor(status, code, message, { field, retryAfter, retryable, extra, cause } = {}) {
        super(message || code);
        this.name = 'GatewayError';
        this.status = status;
        this.code = code;
        if (field) this.field = field;
        if (Number.isFinite(retryAfter)) this.retryAfter = Math.max(1, Math.ceil(retryAfter));
        if (retryable !== undefined) this.retryable = Boolean(retryable);
        if (extra && typeof extra === 'object') this.extra = extra;
        if (cause) this.cause = cause;
    }

    toBody() {
        const body = { error: this.code, message: this.message };
        if (this.field) body.field = this.field;
        if (this.retryAfter) body.retry_after = this.retryAfter;
        if (this.extra) Object.assign(body, this.extra);
        return body;
    }
}

export function isGatewayError(error) {
    return Boolean(error && error.name === 'GatewayError' && Number.isInteger(error.status));
}

export const errors = {
    badRequest: (message, field) => new GatewayError(400, 'invalid_input', message || 'The request is invalid.', { field }),
    invalidJson: () => new GatewayError(400, 'invalid_json', 'The request body must be JSON.'),
    unauthorized: () => new GatewayError(401, 'session_required', 'Enter your access code to continue.'),
    forbiddenOrigin: () => new GatewayError(403, 'cross_origin', 'Cross-site requests are not allowed.'),
    notFound: (message) => new GatewayError(404, 'not_found', message || 'Not found.'),
    tooLarge: (message) => new GatewayError(413, 'payload_too_large', message || 'The request is too large.'),
    rateLimited: (retryAfter, message) =>
        new GatewayError(429, 'rate_limited', message || 'Too many requests. Wait a moment and try again.', { retryAfter }),
    setupRequired: () =>
        new GatewayError(503, 'setup_required', 'This Aquora deployment is not set up yet. The site owner needs to add access codes and a session secret.'),
    notConfigured: (what = 'The AI service') =>
        new GatewayError(503, 'not_configured', `${what} isn't configured. Ask the site owner to check the server keys.`),
};

// Converts anything thrown inside a route into a GatewayError. Unknown errors
// become a generic 500 whose message never includes internal detail.
export function toGatewayError(error) {
    if (isGatewayError(error)) return error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return new GatewayError(504, 'upstream_timeout', 'The AI service took too long to respond. Try again.', { retryable: true });
    }
    // Errors thrown by the catalog transform engine carry .status/.field.
    if (error && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        return new GatewayError(error.status, error.code || 'invalid_input', String(error.message || 'The request is invalid.').slice(0, 300), {
            field: typeof error.field === 'string' ? error.field : undefined,
        });
    }
    return new GatewayError(500, 'internal_error', 'Something went wrong on our side. Try again.', { cause: error });
}
