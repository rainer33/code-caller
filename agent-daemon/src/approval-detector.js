'use strict';

/**
 * Heuristic detection of "the agent is asking for confirmation before a
 * sensitive/destructive action" in a child process's output.
 *
 * This is deliberately conservative and regex-based. It looks for an
 * interactive confirmation prompt (`(y/n)`, `yes/no`, `allow?`, ...) in the
 * *trailing* output. A match means: hold stdin, ask the Hub for approval, and
 * only continue when the Hub says so.
 *
 * Limitations (see agent-daemon/README.md):
 *  - It cannot catch a prompt the model emits in a form the regexes don't
 *    cover, or one written to a TTY in a way that never reaches our pipe.
 *  - It may produce false positives if ordinary model output merely contains
 *    `(y/n)` or the sensitive keywords. In practice this surfaces as an
 *    approval request that a human can approve immediately.
 *  - Detection is only as good as the data Codex emits on stdout/stderr.
 *  - Verified 2026-08-09: `codex exec` itself never blocks on stdin for a
 *    sandboxed run (it runs with `approval: never` and just succeeds/fails
 *    inside its workspace sandbox). runner.js closes the child's stdin right
 *    after spawn for that reason, so `resume()`'s stdin write is a no-op for
 *    the CODEX adapter today. This module is kept for worker types whose CLI
 *    genuinely prompts on stdin.
 */

const CONFIRM_MARKERS = [
  /\by\s*\/\s*n\b/i,
  /\byes\s*\/\s*no\b/i,
  /\byes\/n\b/i,
  /\by\/n(?:es)?\b/i,
  /\b(?:approve|allow|permit|confirm)\b.*\?\s*$/i,
  /\b(?:proceed|continue)\b.*\?\s*$/i,
  /\?\s*(?:\(y\/n\)|\[y\/n\]|y\/n)\s*$/i,
  /\bdo you want (?:to )?(?:to )?(?:continue|proceed|run|execute)\b.*\?/i,
  /\bare you sure\b.*\?/i,
  /\bsuggested (?:shell )?command\b.*\?/i,
];

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
}

function excerpt(text, max = 240) {
  const clean = stripAnsi(text)
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .join(' ');
  const trimmed = clean.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

/**
 * Inspect a chunk (a string of freshly arrived child output) and return
 * { approved: boolean, reason: string } when it looks like the child is
 * blocked waiting on a confirmation prompt. Returns null otherwise.
 *
 * @param {string} chunk  raw chunk from stdout/stderr
 */
function detect(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;

  const clean = stripAnsi(chunk);
  if (!clean.trim()) return null;

  // Check line by line so a prompt isn't missed inside a large dump.
  const lines = clean.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const hasMarker = CONFIRM_MARKERS.some((re) => re.test(line));
    if (!hasMarker) continue;

    const windowStart = Math.max(0, i - 2);
    const window = lines.slice(windowStart, i + 1).join('\n');
    return {
      reason: excerpt(window),
    };
  }

  return null;
}

module.exports = { detect };