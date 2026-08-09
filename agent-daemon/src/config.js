'use strict';

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (err) {
  // dotenv is optional at require-time in edge environments; config still works.
}

const DEFAULT_COMMAND_TEMPLATE = 'codex exec "{{prompt}}"';

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required env var ${name} ` +
        `(see agent-daemon/.env.example). Set it in your .env or environment.`,
    );
  }
  return value.trim();
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  hubUrl: required('HUB_URL'),
  apiKey: required('API_KEY'),
  serverId: process.env.SERVER_ID || 'daemon',
  commandTemplate: process.env.CODEX_COMMAND_TEMPLATE || DEFAULT_COMMAND_TEMPLATE,
  cwd: process.env.CODEX_EXEC_CWD || process.cwd(),
  useShell: (process.env.CODEX_USE_SHELL || '0') === '1',
  heartbeatIntervalMs: int('HEARTBEAT_INTERVAL_MS', 30000),
  debugSocket: int('DEBUG_SOCKET', 0) === 1,
};