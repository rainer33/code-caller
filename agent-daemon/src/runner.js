'use strict';

const { spawn } = require('child_process');
const { detect } = require('./approval-detector');

const RESUME_INPUT = 'y\n';

/**
 * Tokenize a command template into argv tokens, respecting double quotes.
 * `codex exec "{{prompt}}"` -> ['codex', 'exec', '"{{prompt}}"']
 */
function tokenize(template) {
  const tokens = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '\\' && i + 1 < template.length) {
      current += ch + template[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (/\s/.test(ch) && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripOuterQuotes(token) {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return token.replace(/"/g, '');
}

function shellEscape(value) {
  // Wrap in single quotes and escape embedded single quotes — safe for sh/cmd-ish shells.
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function substitute(token, placeholders) {
  let out = token;
  for (const [key, value] of Object.entries(placeholders)) {
    if (out.includes(`{{${key}}}`)) {
      out = out.split(`{{${key}}}`).join(value);
    }
  }
  return out;
}

/**
 * Runs one Codex CLI process for a single task under Hub control.
 *
 * Lifecycle:
 *   spawn -> RUNNING statusUpdate -> task:log per chunk
 *   approval prompt detected -> approval:request, hold stdin
 *   approval:decision(approved) -> write "y\n" to stdin
 *   approval:decision(rejected) | task:cancel -> kill child (no task:result)
 *   natural exit -> task:result COMPLETED | FAILED
 */
class TaskRunner {
  constructor(taskId, input, client, config, logger) {
    this.taskId = taskId;
    this.input = input;
    this.client = client;
    this.config = config;
    this.logger = logger;

    this.child = null;
    this.awaitingApproval = false;
    this.killedByHub = false;
    this.lastChunk = '';
    this.tail = '';
    this.TAIL_LIMIT = 8192;
    this.exitHandled = false;
  }

  buildSpawnPlan() {
    const prompt = this.input && this.input.prompt !== undefined ? String(this.input.prompt) : '';
    const placeholders = {
      prompt,
      input: JSON.stringify(this.input ?? {}),
      cwd: this.config.cwd,
    };

    if (this.config.useShell) {
      let command = this.config.commandTemplate;
      for (const [key, value] of Object.entries(placeholders)) {
        command = command.split(`{{${key}}}`).join(shellEscape(value));
      }
      return { shell: true, command, args: [] };
    }

    const tokens = tokenize(this.config.commandTemplate).map((t) =>
      stripOuterQuotes(substitute(t, placeholders)),
    );
    if (tokens.length === 0) {
      throw new Error(`Empty command template: ${this.config.commandTemplate}`);
    }
    return { shell: false, command: tokens[0], args: tokens.slice(1) };
  }

  start() {
    const plan = this.buildSpawnPlan();
    this.logger.info(
      `[task:${this.taskId}] spawning ${plan.shell ? 'via shell' : 'direct'}: ${plan.command} ${plan.args.join(' ')}`,
    );

    let child;
    try {
      child = spawn(plan.command, plan.args, {
        shell: plan.shell,
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.finishFailed(`spawn failed: ${err.message}`);
      return;
    }
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.on('data', (chunk) => this.onData(chunk));
    child.on('error', (err) => {
      // ENOENT etc. — the process never really started.
      this.logger.error(`[task:${this.taskId}] child error: ${err.message}`);
      if (!this.exitHandled) this.finishFailed(`child process error: ${err.message}`);
    });
    child.on('close', (code, signal) => this.onClose(code, signal));

    this.client.emit('task:statusUpdate', { taskId: this.taskId, status: 'RUNNING' });
  }

  onData(chunk) {
    this.lastChunk = chunk;
    this.tail = (this.tail + chunk).slice(-this.TAIL_LIMIT);
    this.client.emit('task:log', { taskId: this.taskId, chunk });

    if (this.awaitingApproval) return;

    const hit = detect(this.tail);
    if (!hit) return;

    this.awaitingApproval = true;
    this.logger.warn(
      `[task:${this.taskId}] approval prompt detected -> asking Hub. reason=${hit.reason}`,
    );
    this.client.emit('approval:request', { taskId: this.taskId, reason: hit.reason });
  }

  decide({ approved }) {
    if (approved) {
      if (this.awaitingApproval) this.resume();
      else this.logger.info(`[task:${this.taskId}] approval granted but child not blocked, skipping`);
      return;
    }
    this.kill('rejected');
  }

  resume() {
    this.awaitingApproval = false;
    this.tail = '';
    if (!this.child || this.child.exitCode !== null) return;
    if (!this.child.stdin || this.child.stdin.destroyed) return;
    this.logger.info(`[task:${this.taskId}] approved -> sending y to stdin`);
    try {
      this.child.stdin.write(RESUME_INPUT);
    } catch (err) {
      this.logger.warn(`[task:${this.taskId}] failed to write stdin: ${err.message}`);
    }
  }

  kill(reason) {
    this.killedByHub = true;
    if (!this.child || this.child.exitCode !== null) return;
    this.logger.warn(`[task:${this.taskId}] killing child (reason=${reason})`);
    try {
      this.child.kill('SIGTERM');
    } catch (err) {
      this.logger.warn(`[task:${this.taskId}] kill failed: ${err.message}`);
    }
  }

  onClose(code, signal) {
    if (this.exitHandled) return;
    this.exitHandled = true;
    this.logger.info(`[task:${this.taskId}] child closed code=${code} signal=${signal}`);

    // When the Hub already resolved this task (cancel or rejection), it owns
    // the final status (CANCELLED) — don't clobber it with a FAILED result.
    if (this.killedByHub) {
      this.client.dropTask(this.taskId);
      return;
    }

    const ok = code === 0 && !signal;
    this.client.emit('task:result', {
      taskId: this.taskId,
      status: ok ? 'COMPLETED' : 'FAILED',
      result: {
        exitCode: code,
        signal: signal || null,
        lastChunk: this.lastChunk,
      },
    });
    this.client.dropTask(this.taskId);
  }

  finishFailed(reason) {
    if (this.exitHandled) return;
    this.exitHandled = true;
    this.client.emit('task:result', {
      taskId: this.taskId,
      status: 'FAILED',
      result: { error: reason },
    });
    this.client.dropTask(this.taskId);
  }

  dispose() {
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { TaskRunner };