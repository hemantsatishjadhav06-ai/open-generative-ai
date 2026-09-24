const path = require('path');

const LOCAL_AI_DIR_ENV = 'AQUORA_LOCAL_AI_DIR';
// Pre-rebrand names, still honored (in this order) when the new one is unset.
const LEGACY_LOCAL_AI_DIR_ENVS = ['CREATOR_AGENCY_LOCAL_AI_DIR', 'OPEN_GENERATIVE_AI_LOCAL_AI_DIR'];
// Kept for callers that imported the single legacy name.
const LEGACY_LOCAL_AI_DIR_ENV = LEGACY_LOCAL_AI_DIR_ENVS[LEGACY_LOCAL_AI_DIR_ENVS.length - 1];

function normalizeDirOverride(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveLocalAiPaths({ userDataPath, env = process.env } = {}) {
    const customDir = [LOCAL_AI_DIR_ENV, ...LEGACY_LOCAL_AI_DIR_ENVS]
        .map((name) => normalizeDirOverride(env[name]))
        .find(Boolean) || '';

    if (!customDir && !userDataPath) {
        throw new Error(`userDataPath is required when ${LOCAL_AI_DIR_ENV} is not set`);
    }

    const dataDir = path.resolve(customDir || path.join(userDataPath, 'local-ai'));

    return {
        dataDir,
        binDir: path.join(dataDir, 'bin'),
        modelsDir: path.join(dataDir, 'models'),
        tmpDir: path.join(dataDir, 'tmp'),
    };
}

module.exports = {
    LOCAL_AI_DIR_ENV,
    LEGACY_LOCAL_AI_DIR_ENV,
    LEGACY_LOCAL_AI_DIR_ENVS,
    resolveLocalAiPaths,
};
