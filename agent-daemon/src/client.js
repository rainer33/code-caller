'use strict';

const { io } = require('socket.io-client');
const { TaskRunner } = require('./runner');

/**
 * Socket.io connection to the Hub's `/daemon` namespace.
 *
 * - Authenticates with `auth: { apiKey }` (Hub: daemon.gateway.ts).
 * - Emits `daemon:heartbeat` on an interval. Heartbeats go through the same
 *   offline buffer, so the Hub keeps seeing a fresh timestamp after reconnect.
 * - Buffers every daemon-originated event while disconnected and replays it,
 *   in order, on reconnect.
 */
class DaemonClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.socket = null;
    this.buffer = [];
    this.runners = new Map();
    this.heartbeatTimer = null;
  }

  connect() {
    const url = `${this.config.hubUrl}/daemon`;
    const socket = io(url, {
      auth: { apiKey: this.config.apiKey },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling'],
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.logger.info(`connected to Hub at ${url} (server=${this.config.serverId})`);
      this.flushBuffer();
    });

    socket.on('disconnect', (reason) => {
      this.logger.warn(`disconnected from Hub (reason=${reason})`);
      if (reason === 'io server disconnect') {
        // The Hub intentionally dropped us — almost always a bad/unknown API key.
        this.logger.error(
          `Hub disconnected us (reason=${reason}). Check API_KEY. Exiting.`,
        );
        process.exit(1);
      }
    });

    socket.on('connect_error', (err) => {
      this.logger.warn(`connection error: ${err.message}`);
    });

    socket.on('task:submit', (payload) => this.onTaskSubmit(payload));
    socket.on('task:cancel', (payload) => this.onTaskCancel(payload));
    socket.on('approval:decision', (payload) => this.onApprovalDecision(payload));

    this.heartbeatTimer = setInterval(() => {
      this.emit('daemon:heartbeat', {});
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Send/queue a daemon->Hub event. While disconnected the event is buffered
   * in memory and replayed in order on the next reconnect.
   */
  emit(event, payload) {
    if (this.config.debugSocket) {
      this.logger.debug(`emit ${event} ${JSON.stringify(payload)}`);
    }
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, payload);
    } else {
      this.buffer.push({ event, payload });
      this.logger.debug(`buffered ${event} (${this.buffer.length} queued)`);
    }
  }

  flushBuffer() {
    if (this.buffer.length === 0) return;
    const queued = this.buffer;
    this.buffer = [];
    this.logger.info(`reconnected - flushing ${queued.length} buffered event(s)`);
    for (const { event, payload } of queued) {
      this.socket.emit(event, payload);
    }
  }

  onTaskSubmit(payload = {}) {
    const { taskId, input } = payload;
    if (!taskId) {
      this.logger.warn('received task:submit without taskId, ignoring');
      return;
    }
    if (this.runners.has(taskId)) {
      this.logger.warn(`task ${taskId} already running, ignoring duplicate submit`);
      return;
    }
    this.logger.info(`task:submit received (taskId=${taskId})`);
    const runner = new TaskRunner(taskId, input, this, this.config, this.logger);
    this.runners.set(taskId, runner);
    runner.start();
  }

  onTaskCancel(payload = {}) {
    const { taskId } = payload;
    const runner = this.runners.get(taskId);
    if (!runner) {
      this.logger.info(`task:cancel for unknown task ${taskId}, ignoring`);
      return;
    }
    runner.kill('cancel');
  }

  onApprovalDecision(payload = {}) {
    const { taskId, approved } = payload;
    const runner = this.runners.get(taskId);
    if (!runner) {
      this.logger.info(`approval:decision for unknown task ${taskId}, ignoring`);
      return;
    }
    this.logger.info(
      `approval:decision received (taskId=${taskId}, approved=${approved})`,
    );
    runner.decide({ approved: Boolean(approved) });
  }

  dropTask(taskId) {
    this.runners.delete(taskId);
  }

  shutdown() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const runner of this.runners.values()) runner.dispose();
    this.runners.clear();
    if (this.socket) this.socket.disconnect();
  }
}

module.exports = { DaemonClient };