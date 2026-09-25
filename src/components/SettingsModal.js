import { LocalModelManager } from './LocalModelManager.js';
import { openAccessCodeModal } from './AccessCodeModal.js';
import { isLocalAIAvailable } from '../lib/localInferenceClient.js';
import { describeBudget, getSessionStatus, signOut } from '../lib/gateway.js';
import { t, tf } from '../lib/i18n.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function row(label, value) {
    const wrap = el('div', 'flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3');
    wrap.appendChild(el('dt', 'text-[11px] font-bold uppercase tracking-widest text-secondary', label));
    wrap.appendChild(el('dd', 'min-w-0 truncate text-right text-sm font-semibold text-white', value));
    return wrap;
}

function gatewayHost() {
    const origin = typeof window !== 'undefined' ? window.aquoraDesktop?.gatewayOrigin : null;
    if (!origin) return null;
    try {
        return new URL(origin).host;
    } catch {
        return null;
    }
}

// Account tab: the Aquora session (workspace, today's budget, sign in/out).
// There is no key to paste any more: cloud models authenticate with the
// access-code session, and provider keys live only on the server.
function AccountPanel(close) {
    const panel = el('div', 'flex flex-col gap-4');
    panel.appendChild(el('p', 'text-[12px] leading-relaxed text-secondary', t('settings.accountNote')));

    const status = el('dl', 'flex flex-col gap-2');
    status.setAttribute('aria-live', 'polite');
    panel.appendChild(status);

    const actions = el('div', 'flex justify-end gap-2 pt-1');
    panel.appendChild(actions);

    const button = (label, primary) => {
        const btn = el('button', primary
            ? 'rounded-lg bg-brand px-4 py-2 text-xs font-bold text-on-brand transition-all hover:bg-brand-hover hover:shadow-glow disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'
            : 'rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40', label);
        btn.type = 'button';
        return btn;
    };

    const note = (text) => el('p', 'text-sm text-secondary', text);

    const render = (session, failed) => {
        status.innerHTML = '';
        actions.innerHTML = '';
        const host = gatewayHost();
        if (host) status.appendChild(row(t('settings.server'), host));

        if (failed) {
            status.appendChild(note(t('settings.offline')));
            const retry = button(t('common.retry'), false);
            retry.onclick = () => load();
            actions.appendChild(retry);
            return;
        }
        if (!session) {
            status.appendChild(note(t('settings.checking')));
            return;
        }
        if (session.gate === 'setup_required') {
            status.appendChild(note(t('settings.setupRequired')));
            return;
        }
        if (!session.authenticated) {
            status.appendChild(note(t('settings.signedOut')));
            const signInBtn = button(t('settings.signIn'), true);
            signInBtn.onclick = () => {
                close();
                openAccessCodeModal({ gate: session.gate });
            };
            actions.appendChild(signInBtn);
            return;
        }

        if (session.workspace) status.appendChild(row(t('settings.workspace'), session.workspace));
        const budget = describeBudget(session.budget);
        status.appendChild(row(t('settings.budgetToday'), budget ? tf('budget.pill', budget.spent, budget.cap) : t('settings.noBudgetCap')));
        if (session.gate === 'open') {
            status.appendChild(el('p', 'text-[12px] text-secondary', t('settings.openAccess')));
            return;
        }
        const out = button(t('settings.signOut'), false);
        out.onclick = async () => {
            out.disabled = true;
            out.textContent = t('settings.signingOut');
            try {
                await signOut();
            } catch {
                // local state is cleared either way
            }
            load();
        };
        actions.appendChild(out);
    };

    const load = () => {
        render(null, false);
        getSessionStatus({ force: true }).then((session) => render(session, false), () => render(null, true));
    };
    load();
    return panel;
}

export function SettingsModal(onClose) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'settings-title');

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card,#111);border-radius:1rem;border:1px solid rgba(255,255,255,0.08);width:min(90vw,36rem);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    header.innerHTML = `
        <h2 id="settings-title" class="font-display" style="font-size:1rem;font-weight:800;color:#fff;margin:0;">${t('settings.title')}</h2>
        <button id="settings-close-btn" type="button" aria-label="${t('settings.close')}" style="color:rgba(255,255,255,0.4);background:none;border:none;cursor:pointer;padding:4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    modal.appendChild(header);

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const TABS = [
        { id: 'account', label: t('settings.account') },
        ...(isLocalAIAvailable() ? [{ id: 'local', label: t('settings.localModels') }] : []),
    ];

    const tabBar = document.createElement('div');
    tabBar.setAttribute('role', 'tablist');
    tabBar.style.cssText = 'display:flex;gap:0.25rem;padding:0.75rem 1.5rem 0;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';

    const tabBtns = {};
    TABS.forEach(({ id, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `settings-tab-${id}`;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', 'settings-tabpanel');
        btn.textContent = label;
        btn.style.cssText = 'padding:0.4rem 0.75rem;border-radius:0.5rem 0.5rem 0 0;font-size:0.75rem;font-weight:700;border:none;cursor:pointer;transition:all 0.15s;';
        btn.onclick = () => switchTab(id);
        tabBtns[id] = btn;
        tabBar.appendChild(btn);
    });
    modal.appendChild(tabBar);

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.id = 'settings-tabpanel';
    body.setAttribute('role', 'tabpanel');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:1.5rem;';
    modal.appendChild(body);

    // Esc closes settings, unless the access-code dialog is on top of it.
    const onKeydown = (e) => {
        if (e.key === 'Escape' && !document.getElementById('aquora-access-title')) close();
    };

    function close() {
        document.removeEventListener('keydown', onKeydown);
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
        if (onClose) onClose();
    }

    const panels = {};
    const panelFor = (id) => {
        if (!panels[id]) panels[id] = id === 'account' ? AccountPanel(close) : LocalModelManager();
        return panels[id];
    };

    // ── Tab switching ─────────────────────────────────────────────────────────
    const switchTab = (id) => {
        body.innerHTML = '';
        TABS.forEach(({ id: tid }) => {
            const btn = tabBtns[tid];
            const active = tid === id;
            btn.setAttribute('aria-selected', String(active));
            btn.style.background = active ? 'rgba(255,255,255,0.08)' : 'transparent';
            btn.style.color = active ? '#fff' : 'rgba(255,255,255,0.4)';
        });
        body.setAttribute('aria-labelledby', `settings-tab-${id}`);
        body.appendChild(panelFor(id));
    };

    switchTab('account');

    header.querySelector('#settings-close-btn').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);

    overlay.appendChild(modal);
    setTimeout(() => header.querySelector('#settings-close-btn')?.focus(), 0);
    return overlay;
}
