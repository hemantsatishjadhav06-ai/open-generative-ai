#!/usr/bin/env node
// Test-only production-mode app with no production keys or durable data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startMockUpstream } from './mock-upstream.mjs';

const port = Number(process.env.E2E_PORT || 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local E2E port.');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-e2e-'));
const mock = await startMockUpstream({ port: 4017, pollsToComplete: 1 });
const env = {
  ...process.env,
  ...mock.env,
  NODE_ENV: 'production',
  FAL_KEY: 'mock-fal-key',
  FAL_ADMIN_KEY: '',
  OPENROUTER_API_KEY: 'mock-openrouter-key',
  AQUORA_PUBLIC_ACCESS: 'false',
  AQUORA_ACCESS_CODES: 'qa-workspace-alpha-2026,qa-workspace-bravo-2026',
  AQUORA_SESSION_SECRET: 'local-e2e-secret-never-for-production-2026',
  AQUORA_DATA_DIR: dataDir,
  AQUORA_DAILY_BUDGET_USD: '1000',
  AQUORA_SESSION_DAILY_BUDGET_USD: '500',
  AQUORA_ALLOWED_ORIGINS: '',
  AQUORA_CLIENT_IP_HEADER: '',
  AQUORA_TRUSTED_PROXY_HOPS: '1',
  AQUORA_LOG_LEVEL: 'silent',
  FAL_POLL_INTERVAL_MS: '25',
  NEXT_TELEMETRY_DISABLED: '1',
};
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  env,
  stdio: 'inherit',
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  await mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}
child.once('error', (error) => { process.stderr.write(`${error.message}\n`); stop(1); });
child.once('exit', (code) => { if (!stopping) stop(code || 0); });
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
