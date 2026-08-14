'use strict';

/**
 * LOCAL-ONLY end-to-end harness for agent-daemon. NOT part of the product —
 * a throwaway Socket.io server that mimics the Hub's `/daemon` namespace
 * contract (see hub-api/src/realtime/daemon.gateway.ts + events.ts), driving a
 * real daemon instance the way the Hub would, and asserting on the
 * daemon-originated events it receives. Uses fake-codex.js as the child.
 *
 * Usage:  node dev-scripts/mock-hub.js
 * Exit code 0 = all scenarios passed; non-zero = failed.
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Server } = require('socket.io');

const HOST = '127.0.0.1';
const VALID_API_KEY = 'test-api-key-123';
const DAEMON_DIR = path.join(__dirname, '..');
const FAKE_CODEX = path.join(__dirname, 'fake-codex.js');

// ---------------------------------------------------------------------------
// Mock Hub (/daemon namespace)
// ---------------------------------------------------------------------------

class MockHub {
  constructor(port, { autoStart = false } = {}) {
    this.port = port;
    this.portStarted = false;
    this.server = http.createServer();
    this.io = new Server(this.server, { cors: { origin: '*' } });
    this.daemonSocket = null;
    this.heartbeats = 0;
    this.statuses = [];
    this.logs = [];
    this.approvalRequests = [];
    this.results = [];
    this.connectedCount = 0;

    this.io.of('/daemon').on('connection', (socket) => {
      const apiKey = socket.handshake.auth?.apiKey;
      if (apiKey !== VALID_API_KEY) {
        socket.disconnect(true);
        return;
      }
      this.daemonSocket = socket;
      this.connectedCount += 1;

      socket.on('daemon:heartbeat', () => {
        this.heartbeats += 1;
      });
      socket.on('task:statusUpdate', (p) => this.statuses.push(p));
      socket.on('task:log', (p) => this.logs.push(p));
      socket.on('task:result', (p) => this.results.push(p));
      socket.on('approval:request', (p) => this.approvalRequests.push(p));
    });

    if (autoStart) this.start();
  }

  start() {
    if (this.portStarted) return Promise.resolve();
    this.portStarted = true;
    return new Promise((resolve) => this.server.listen(this.port, HOST, resolve));
  }

  close() {
    return new Promise((resolve) => this.io.close(() => this.server.close(() => resolve())));
  }

  emitSubmit(payload) {
    this.daemonSocket?.emit('task:submit', payload);
  }

  emitDecision(payload) {
    this.daemonSocket?.emit('approval:decision', payload);
  }

  emitCancel(payload) {
    this.daemonSocket?.emit('task:cancel', payload);
  }

  logsFor(taskId) {
    return this.logs.filter((l) => l.taskId === taskId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, timeoutMs = 10000, interval = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function scenario(name) {
  console.log(`\n===== ${name} =====`);
}

function check(name, cond, extra = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

let daemonProc = null;
let dumpDaemonLog = () => '';

function spawnDaemon(envOverrides) {
  const proc = spawn(process.execPath, [path.join(DAEMON_DIR, 'src', 'index.js')], {
    cwd: DAEMON_DIR,
    env: {
      ...process.env,
      HUB_URL: `http://${HOST}:9999`,
      API_KEY: VALID_API_KEY,
      SERVER_ID: 'e2e-harness',
      CODEX_COMMAND_TEMPLATE: `node "${FAKE_CODEX}" "{{prompt}}"`,
      CODEX_EXEC_CWD: DAEMON_DIR,
      HEARTBEAT_INTERVAL_MS: '250',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  proc.stdout.on('data', (d) => (buf += d));
  proc.stderr.on('data', (d) => (buf += d));
  proc.on('exit', (code) => (buf += `\n[daemon exited code=${code}]\n`));
  dumpDaemonLog = () => (buf.length ? buf.replace(/\n{2,}/g, '\n').trim() : '(no daemon output yet)');
  return proc;
}

async function stopDaemon() {
  if (daemonProc && daemonProc.exitCode === null) {
    daemonProc.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => daemonProc.once('exit', resolve)),
      sleep(2000),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioA(hub) {
  scenario('A: connect + submit -> RUNNING -> logs -> COMPLETED');

  await waitFor('daemon connect', () => hub.connectedCount >= 1);
  await waitFor('first heartbeat', () => hub.heartbeats >= 1);
  check('A1 daemon connected with valid apiKey', hub.connectedCount >= 1);
  check('A2 daemon emits heartbeat', hub.heartbeats >= 1);

  hub.emitSubmit({ taskId: 't-success', input: { prompt: 'refactor the utils' } });

  await waitFor('RUNNING status', () =>
    hub.statuses.some((s) => s.taskId === 't-success' && s.status === 'RUNNING'),
  );
  check('A3 emits task:statusUpdate RUNNING on start', true);

  await waitFor(
    'task logs',
    () => hub.logsFor('t-success').length >= 1,
  );
  check('A4 streams task:log chunks', hub.logsFor('t-success').length >= 1);

  await waitFor('COMPLETED result', () =>
    hub.results.some((r) => r.taskId === 't-success' && r.status === 'COMPLETED'),
  );
  const completed = hub.results.find((r) => r.taskId === 't-success');
  check('A5 emits task:result COMPLETED', completed?.status === 'COMPLETED');
  check(
    'A5b result carries last chunk',
    typeof completed?.result?.lastChunk === 'string' && completed.result.lastChunk.length > 0,
    JSON.stringify(completed?.result),
  );
}

async function scenarioB(hub) {
  scenario('B. cancel -> child killed, NO task:result');
  hub.emitSubmit({ taskId: 't-cancel', input: { prompt: 'slow cancellable task' } });

  await waitFor('B task logs', () => hub.logsFor('t-cancel').length >= 1);

  hub.emitCancel({ taskId: 't-cancel' });

  await sleep(1500);
  const cancelResult = hub.results.find((r) => r.taskId === 't-cancel');
  check('B1 cancelled task emits NO task:result', !cancelResult);
}

async function scenarioCapacity(hub) {
  scenario('C. capacity exhaustion -> structured retryable FAILED result');
  hub.emitSubmit({ taskId: 't-capacity', input: { prompt: 'trigger capacity exhaustion' } });

  await waitFor('capacity FAILED result', () =>
    hub.results.some((r) => r.taskId === 't-capacity' && r.status === 'FAILED'),
  );
  const result = hub.results.find((r) => r.taskId === 't-capacity');
  check('C1 emits task:result FAILED', result?.status === 'FAILED');
  check(
    'C2 result carries retryable CAPACITY_EXHAUSTED failure',
    result?.failure?.category === 'CAPACITY_EXHAUSTED' &&
      result?.failure?.retryable === true &&
      result?.result?.failure?.category === 'CAPACITY_EXHAUSTED',
    JSON.stringify(result),
  );
}

async function scenarioD() {
  scenario('D. offline buffering -> flush on reconnect');

  // Hub is deliberately NOT started yet: the daemon should retry connecting and
  // buffer its 250ms heartbeat in memory rather than dropping it.
  const hub = new MockHub(4122, { autoStart: false });
  daemonProc = spawnDaemon({ HUB_URL: `http://${HOST}:4122` });

  await sleep(800);
  check('D1 daemon stays alive while Hub is offline', daemonProc.exitCode === null);

  await hub.start();
  await waitFor('reconnect to Hub', () => hub.connectedCount >= 1, 15000);
  // Right after connect, buffered heartbeats should arrive all at once — far
  // more than a single new-interval heartbeat.
  await sleep(100);
  check(
    'D2 buffered events flushed in order upon reconnect (>=3 heartbeats)',
    hub.heartbeats >= 3,
    `${hub.heartbeats} heartbeats`,
  );

  await hub.close();
  await stopDaemon();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const hubA = new MockHub(4121, { autoStart: true });
  await hubA.start();

  daemonProc = spawnDaemon({ HUB_URL: `http://${HOST}:4121` });

  await scenarioA(hubA);
  await scenarioB(hubA);
  await scenarioCapacity(hubA);

  await stopDaemon();
  await hubA.close();

  await scenarioD();

  console.log('\n================ RESULT ================');
  if (process.exitCode) {
    console.log('ONE OR MORE SCENARIOS FAILED');
  } else {
    console.log('ALL SCENARIOS PASSED');
  }
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error('\nHARNESS ERROR:', err);
  console.error('--- daemon output ---\n', dumpDaemonLog());
  console.log('\n================ RESULT ================');
  console.log('HARNESS CRASHED');
  process.exit(1);
});
