// Aquora gateway client for the desktop (Electron) and Vite app.
//
// Cloud generation goes to an Aquora deployment's own API — the same one the
// web app uses — with same-origin relative paths:
//   POST /api/v1/<model key>                  submit → {request_id, status}
//   GET  /api/v1/predictions/<token>/result   poll   → normalized result
//   POST /api/v1/upload_file                  multipart `file` → {url}
//   GET/POST/DELETE /api/session              access-code session
// In the desktop app, aquora://app/api/* is forwarded by the main process to
// AQUORA_API_BASE (electron/lib/gatewayBridge.js), which also keeps the
// HttpOnly session cookie. Under `vite` the dev server proxies /api to a
// local Aquora (vite.config.mjs). Either way this code never sees a cookie
// or a provider key, and never logs prompts.
//
// Payload building is shared with the web studios (packages/studio/src/
// gateway.js), so both send the gateway exactly the same fields.
import {
    generateImage as submitImage,
    generateI2I as submitI2I,
    generateVideo as submitVideo,
    generateI2V as submitI2V,
    processV2V as submitV2V,
    processLipSync as submitLipSync,
    uploadFile as submitUpload,
} from '../../packages/studio/src/gateway.js';
import { pollForGenerationResult } from '../../packages/studio/src/utils/generationLifecycle.js';
import { getSessionStatus, notifySessionRequired } from '../../packages/studio/src/session.js';
import {
    filterAvailableModels,
    firstAvailableModel,
    getModelAvailability,
    isModelAvailable,
    loadModelAvailability,
    subscribeModelAvailability,
} from '../../packages/studio/src/modelAvailability.js';
import { t } from './i18n.js';

export {
    BUDGET_EXCEEDED_EVENT,
    SESSION_CHANGED_EVENT,
    SESSION_REQUIRED_EVENT,
    describeBudget,
    getSessionSnapshot,
    getSessionStatus,
    signIn,
    signOut,
    subscribeSession,
} from '../../packages/studio/src/session.js';

// ─── model availability ───────────────────────────────────────────────────────

// Local (sd.cpp / Wan2GP) entries run on this machine, not on the gateway.
const isLocalEntry = (model) => model?.provider === 'wan2gp' || model?.provider === 'local';

/** The models a picker should offer: gateway-enabled cloud models plus local ones. */
export function pickableModels(models) {
    const cloud = filterAvailableModels(models.filter((model) => !isLocalEntry(model)));
    return models.filter((model) => isLocalEntry(model) || cloud.includes(model));
}

/** The picker default: the first runnable cloud model (models[0] until the list is known). */
export function defaultModel(models) {
    return firstAvailableModel(models.filter((model) => !isLocalEntry(model))) || models[0] || null;
}

export function isCloudModelAvailable(modelId) {
    return isModelAvailable(modelId);
}

/**
 * Calls `listener` once the gateway's model list is known (right away if it
 * already is), and again whenever it changes. Returns an unsubscribe.
 */
export function onModelAvailability(listener) {
    const unsubscribe = subscribeModelAvailability(listener);
    if (getModelAvailability()) listener();
    else loadModelAvailability();
    return unsubscribe;
}

/**
 * Silent check for background work (e.g. resuming jobs on launch): true when
 * signed in, or when the status can't be read (the request reports why).
 */
export async function hasSession() {
    try {
        const session = await getSessionStatus();
        return Boolean(session?.authenticated);
    } catch {
        return true;
    }
}

// ─── generation ───────────────────────────────────────────────────────────────

function assertAvailable(modelId) {
    if (isModelAvailable(modelId)) return;
    const error = new Error(t('gateway.modelUnavailable'));
    error.code = 'model_unavailable';
    throw error;
}

// Keeps the header's "Today: $x of $y" pill current after anything that
// may have spent budget.
function refreshBudget() {
    getSessionStatus({ force: true }).catch(() => {});
}

function run(submit) {
    return async (params) => {
        assertAvailable(params.model);
        try {
            return await submit(null, params);
        } finally {
            refreshBudget();
        }
    };
}

export const gateway = {
    generateImage: run(submitImage),
    generateI2I: run(submitI2I),
    generateVideo: run(submitVideo),
    generateI2V: run(submitI2V),
    processV2V: run(submitV2V),
    processLipSync: run(submitLipSync),

    /** Uploads a file to the gateway's storage and resolves to its hosted URL. */
    uploadFile(file, onProgress) {
        return submitUpload(null, file, onProgress);
    },

    /**
     * Resumes polling a job submitted earlier (e.g. before the app was
     * closed). Resolves to the normalized result, with `url` set.
     */
    async pollForResult(requestId, maxAttempts = 60, interval = 2000) {
        try {
            const result = await pollForGenerationResult({
                requestId,
                maxAttempts,
                interval,
                onAuthRequired: notifySessionRequired,
            });
            return { ...result, url: result.outputs?.[0] || result.url || result.output?.url };
        } finally {
            refreshBudget();
        }
    },
};
