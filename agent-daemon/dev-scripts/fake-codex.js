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

const promptArg = process.argv[2] ?? '';

process.stdout.write('--- fake-codex: analyzing prompt ' + JSON.stringify(promptArg) + '\n');

if (/capacity/i.test(promptArg)) {
  process.stderr.write('Codex is temporarily unavailable: model capacity reached. Please try again later.\n');
  process.exit(1);
}

if (/slow/i.test(promptArg)) {
  process.stdout.write('Starting long-running task...\n');
  const timer = setInterval(() => {
    process.stdout.write('Still working...\n');
  }, 250);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.stdout.write('fake-codex: received SIGTERM, shutting down...\n');
    process.exit(143);
  });
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('fake-codex: received SIGINT, shutting down...\n');
    process.exit(130);
  });
  return;
}

process.stdout.write('Searching repository...\n');
process.stdout.write('Found 2 relevant files. processing.\n');
process.stdout.write('Plan: apply the suggested diff, then run the test suite.\n');
process.stdout.write('Command complete; output written.\n');
process.exit(0);

process.on('SIGTERM', () => {
  process.stdout.write('fake-codex: received SIGTERM, shutting down...\n');
  process.exit(143);
});

process.on('SIGINT', () => {
  process.stdout.write('fake-codex: received SIGINT, shutting down...\n');
  process.exit(130);
});
