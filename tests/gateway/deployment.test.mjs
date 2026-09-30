import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GET as health } from '../../app/api/health/route.js';

const SHA = '7e8a10a8a6c478d1d36435a1d292b0873a005eb3';
const OTHER_SHA = 'a'.repeat(40);

async function withEnv(values, fn) {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('public health identifies the built release without exposing configuration values', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquora-deployment-'));
    try {
        await withEnv({
            AQUORA_DATA_DIR: dir,
            AQUORA_BUILD_SHA: SHA.toUpperCase(),
            RAILWAY_GIT_COMMIT_SHA: OTHER_SHA,
            FAL_KEY: 'test-fal-key-do-not-expose',
            OPENROUTER_API_KEY: 'test-openrouter-key-do-not-expose',
            AQUORA_SESSION_SECRET: 'test-session-secret-do-not-expose-12345678',
        }, async () => {
            const response = await health();
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            const body = await response.json();
            assert.equal(body.commit, SHA, 'image SHA must take precedence over a runtime Git SHA');
            assert.equal(body.fal, true);
            assert.equal(body.openrouter, true);
            assert.doesNotMatch(JSON.stringify(body), /test-fal-key|test-openrouter-key|test-session-secret/);
        });
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('health reports unavailable or malformed release identities as null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquora-deployment-'));
    try {
        await withEnv({ AQUORA_DATA_DIR: dir, AQUORA_BUILD_SHA: undefined, RAILWAY_GIT_COMMIT_SHA: SHA }, async () => {
            assert.equal((await (await health()).json()).commit, SHA);
        });
        for (const value of [undefined, 'main', 'secret-like-value', `${SHA}\n`, SHA.slice(0, 39)]) {
            await withEnv({ AQUORA_DATA_DIR: dir, AQUORA_BUILD_SHA: value, RAILWAY_GIT_COMMIT_SHA: undefined }, async () => {
                assert.equal((await (await health()).json()).commit, null);
            });
        }
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
