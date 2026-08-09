'use strict';

const ts = () => new Date().toISOString();

function makeLogger(serverId) {
  const log = (level, ...args) => {
    console[level === 'error' ? 'error' : 'log'](
      `[${ts()}] [${level.toUpperCase()}] [daemon:${serverId}]`,
      ...args,
    );
  };
  return {
    info: (...a) => log('info', ...a),
    warn: (...a) => log('warn', ...a),
    error: (...a) => log('error', ...a),
    debug: (...a) => log('debug', ...a),
  };
}

module.exports = { makeLogger };