import { getSessionStatus, signIn } from '../lib/gateway.js';
import { t, tf } from '../lib/i18n.js';

// Access-code sign-in for Aquora's gateway (POST /api/session). The gateway
// answers with an HttpOnly session cookie that this code never sees: the
// browser (vite dev) or the desktop main process keeps it.

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

let openModal = null; // one dialog at a time

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Maps a signIn() failure to a friendly, translated line. */
export function describeSignInError(error) {
    const status = error?.status;
    if (status === 401 || error?.code === 'invalid_code') return t('auth.invalidCode');
    if (status === 429) return tf('auth.rateLimited', Math.max(1, Math.ceil(Number(error?.retryAfter) || 60)));
    if (error?.code === 'setup_required') return t('auth.setupRequired');
    if (!status || status === 502 || status === 504 || error?.code === 'upstream_unreachable') return t('auth.unavailable');
    return t('auth.genericError');
}

/**
 * Opens the access-code dialog.
 * @param {object} [options]
 * @param {'signin'|'expired'} [options.reason]
 * @param {string|null} [options.gate] the gateway's gate mode, when known
 * @param {function} [options.onSuccess] runs after a successful sign-in
 */
export function openAccessCodeModal({ reason = 'signin', gate = null, onSuccess } = {}) {
    if (openModal) {
        if (onSuccess) openModal.callbacks.push(onSuccess);
        openModal.focus();
        return openModal.overlay;
    }

    const previousFocus = document.activeElement;
    const callbacks = onSuccess ? [onSuccess] : [];
    const titleId = 'aquora-access-title';
    const descId = 'aquora-access-desc';

    const overlay = el('div', 'fixed inset-0 z-[200] flex items-center justify-center bg-surface-app/80 backdrop-blur-sm px-4');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.setAttribute('aria-describedby', descId);

    const card = el('div', 'relative w-full max-w-sm rounded-2xl border border-white/10 bg-surface-panel/95 p-8 shadow-3xl animate-fade-in-up');
    overlay.appendChild(card);

    const closeBtn = el('button', 'absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', t('auth.close'));
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    card.appendChild(closeBtn);

    const mark = el('div', 'mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow');
    mark.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${SPARK_PATH}" fill="#04121a"/></svg>`;
    card.appendChild(mark);

    const setup = gate === 'setup_required';
    const title = el('h2', 'font-display text-2xl font-bold tracking-tight text-white', setup ? t('auth.setupTitle') : (reason === 'expired' ? t('auth.sessionEndedTitle') : t('auth.title')));
    title.id = titleId;
    card.appendChild(title);

    const subtitle = el('p', 'mt-2 text-sm text-secondary', setup ? t('auth.setupRequired') : (reason === 'expired' ? t('auth.sessionEndedSubtitle') : t('auth.subtitle')));
    subtitle.id = descId;
    card.appendChild(subtitle);

    let input = null;
    if (!setup) {
        const form = el('form', 'mt-6 flex flex-col gap-3');
        form.noValidate = true;
        const label = el('label', 'text-[11px] font-bold uppercase tracking-widest text-secondary', t('auth.label'));
        label.htmlFor = 'aquora-access-code';
        form.appendChild(label);

        const field = el('div', 'relative');
        input = el('input', 'w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 pr-11 text-white placeholder:text-secondary focus:border-brand/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40');
        input.id = 'aquora-access-code';
        input.type = 'password';
        input.name = 'code';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = t('auth.placeholder');
        input.setAttribute('aria-describedby', 'aquora-access-error');
        field.appendChild(input);

        const toggle = el('button', 'absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40');
        toggle.type = 'button';
        const syncToggle = () => {
            const shown = input.type === 'text';
            toggle.innerHTML = shown ? EYE_CLOSED : EYE_OPEN;
            toggle.setAttribute('aria-label', shown ? t('auth.hideCode') : t('auth.showCode'));
            toggle.setAttribute('aria-pressed', String(shown));
        };
        toggle.onclick = () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            syncToggle();
            input.focus();
        };
        syncToggle();
        field.appendChild(toggle);
        form.appendChild(field);

        const errorLine = el('p', 'min-h-[1.25rem] text-[13px] text-red-300');
        errorLine.id = 'aquora-access-error';
        errorLine.setAttribute('role', 'alert');
        errorLine.setAttribute('aria-live', 'assertive');
        form.appendChild(errorLine);

        const submit = el('button', 'w-full rounded-xl bg-brand py-3 font-bold text-on-brand transition-all hover:bg-brand-hover hover:shadow-glow disabled:cursor-wait disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel', t('auth.submit'));
        submit.type = 'submit';
        form.appendChild(submit);

        const showError = (message) => {
            errorLine.textContent = message;
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        };

        form.onsubmit = async (event) => {
            event.preventDefault();
            const code = input.value.trim();
            if (!code) {
                showError(t('auth.missingCode'));
                input.focus();
                return;
            }
            showError('');
            submit.disabled = true;
            submit.textContent = t('auth.checking');
            try {
                await signIn(code);
                input.value = '';
                const pending = callbacks.splice(0);
                close();
                for (const callback of pending) {
                    try { callback(); } catch { /* one failing retry must not block the rest */ }
                }
            } catch (error) {
                showError(describeSignInError(error));
                submit.disabled = false;
                submit.textContent = t('auth.submit');
                input.focus();
                input.select();
            }
        };
        card.appendChild(form);

        const help = el('details', 'mt-5 text-[12px] text-secondary');
        const summary = el('summary', 'cursor-pointer rounded font-medium text-white/70 hover:text-pop-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40', t('auth.helpSummary'));
        help.appendChild(summary);
        help.appendChild(el('p', 'mt-2 leading-relaxed', t('auth.help')));
        help.appendChild(el('p', 'mt-2 leading-relaxed text-secondary', t('auth.note')));
        card.appendChild(help);
    }

    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = Array.from(card.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    function close() {
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        openModal = null;
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
            previousFocus.focus();
        }
    }

    closeBtn.onclick = close;
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);

    const focus = () => (input || closeBtn).focus();
    openModal = { overlay, callbacks, focus, close };
    focus();
    return overlay;
}

/**
 * Resolves true when cloud calls can go ahead (signed in, or a server that
 * needs no code). Otherwise opens the access-code dialog, which runs
 * `onReady` after sign-in, and resolves false. A failed status check
 * resolves true so the real request can report the actual error.
 */
export async function requireSession(onReady) {
    let session;
    try {
        session = await getSessionStatus();
    } catch {
        return true;
    }
    if (session?.authenticated) return true;
    openAccessCodeModal({ gate: session?.gate || null, onSuccess: onReady });
    return false;
}
