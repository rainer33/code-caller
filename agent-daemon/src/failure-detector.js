'use strict';

const CAPACITY_PATTERNS = [
  /\bcapacity\b/i,
  /\bquota\b/i,
  /\brate[ -]?limit(?:ed|s)?\b/i,
  /\busage limit\b/i,
  /\blimit reached\b/i,
  /\btoo many requests\b/i,
  /\btry again later\b/i,
  /\btemporarily unavailable\b/i,
  /\bmodel is overloaded\b/i,
  /\bservice is overloaded\b/i,
];

function excerpt(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join('\n')
    .slice(-1200);
}

function detectStructuredFailure({ exitCode, signal, output }) {
  if (exitCode === 0 && !signal) return null;

  const tail = excerpt(output);
  if (tail && CAPACITY_PATTERNS.some((pattern) => pattern.test(tail))) {
    return {
      category: 'CAPACITY_EXHAUSTED',
      retryable: true,
      message: 'Worker capacity, quota, or rate-limit signal detected.',
      detail: tail,
    };
  }

  return null;
}

module.exports = { detectStructuredFailure };
