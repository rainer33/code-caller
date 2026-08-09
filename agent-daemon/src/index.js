'use strict';

const { DaemonClient } = require('./client');
const { makeLogger } = require('./log');

let config;
try {
  config = require('./config');
} catch (err) {
  process.stderr.write(`\nConfig error: ${err.message}\n\n`);
  process.exit(1);
}

const logger = makeLogger(config.serverId);

const client = new DaemonClient(config, logger);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.warn(`received ${sig}, shutting down`);
    client.shutdown();
    process.exit(0);
  });
}

client.connect();
logger.info(
  `Agent Daemon starting (server=${config.serverId}, hub=${config.hubUrl}/daemon)`,
);