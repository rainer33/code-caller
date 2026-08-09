#!/usr/bin/env node
'use strict';

/**
 * LOCAL-ONLY fake Codex CLI used to exercise agent-daemon without a real
 * Codex instance. It mimics the behaviors agent-daemon cares about:
 *   - prints progress output on stdout,
 *   - hangs waiting for a `(y/n)` confirmation on stdin before a
 *     "sensitive" command,
 *   - answers y -> exit 0 (success), EOF/n -> exit 1,
 *   - SIGTERM -> aborts.
 *
 * NOT part of the product. See mock-hub.js.
 */

const readline = require('readline');

const promptArg = process.argv[2] ?? '';

process.stdout.write('--- fake-codex: analyzing prompt ' + JSON.stringify(promptArg) + '\n');
process.stdout.write('Searching repository...\n');
process.stdout.write('Found 2 relevant files. processing.\n');
process.stdout.write('Plan: apply the suggested diff, then run the test suite.\n');
process.stdout.write('--- Sensitive command pending: rm -rf /tmp/codex-orphan-output\n');
process.stdout.write('WARNING: this will delete files outside the workspace.\n');
process.stdout.write('Do you want to run this command? (y/n)\n');

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const answer = String(line).trim().toLowerCase();
  if (answer.startsWith('y')) {
    process.stdout.write('Approved by operator: executing sensitive command...\n');
    process.stdout.write('Command complete; output written.\n');
    process.exit(0);
  } else if (answer.startsWith('n')) {
    process.stdout.write('Rejected by operator; skipping sensitive command.\n');
    process.exit(1);
  } else {
    process.stdout.write('Please answer y or n\n');
  }
});

process.stdin.on('end', () => {
  process.stdout.write('stdin closed before a decision was made.\n');
  process.exit(1);
});

process.on('SIGTERM', () => {
  process.stdout.write('fake-codex: received SIGTERM, shutting down...\n');
  process.exit(143);
});

process.on('SIGINT', () => {
  process.stdout.write('fake-codex: received SIGINT, shutting down...\n');
  process.exit(130);
});