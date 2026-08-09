'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (err) {
  // dotenv is optional for one-shot registration.
}

const DEFAULT_HUB_URL = 'http://172.30.1.83:3000';
const DEFAULT_OWNER_EMAIL = 'admin@example.com';
const POLL_INTERVAL_MS = 2500;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--help' || item === '-h') {
      args.help = true;
    } else if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = '1';
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  npm run register -- --hub http://172.30.1.83:3000 --owner-email admin@example.com

Options:
  --hub             Hub API URL. Default: HUB_URL or ${DEFAULT_HUB_URL}
  --owner-email     Mobile login email that should approve this server.
                    Default: OWNER_EMAIL or ${DEFAULT_OWNER_EMAIL}
  --name            Server name. Default: hostname
  --os-type         UBUNTU, MACOS, or WINDOWS. Default: detected from platform
  --tailscale-ip    Tailscale/private IP shown in the mobile app.
                    Default: TAILSCALE_IP or first non-internal IPv4
`);
}

function detectOsType() {
  if (process.platform === 'darwin') return 'MACOS';
  if (process.platform === 'win32') return 'WINDOWS';
  return 'UBUNTU';
}

function detectIp() {
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) {
        return item.address;
      }
    }
  }
  return '127.0.0.1';
}

function fingerprintFor(input) {
  return crypto
    .createHash('sha256')
    .update([input.name, input.osType, input.tailscaleIp, os.arch(), os.platform()].join('|'))
    .digest('hex');
}

async function readJson(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function createRequest(input) {
  const response = await fetch(`${input.hubUrl}/server-registration-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerEmail: input.ownerEmail,
      name: input.name,
      osType: input.osType,
      tailscaleIp: input.tailscaleIp,
      fingerprint: input.fingerprint,
    }),
  });
  return readJson(response);
}

async function pollResult(hubUrl, requestId, requestSecret, expiresAt) {
  while (Date.now() < new Date(expiresAt).getTime()) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    const url = new URL(`${hubUrl}/server-registration-requests/${requestId}/result`);
    url.searchParams.set('secret', requestSecret);
    const result = await readJson(await fetch(url));
    if (result.status === 'APPROVED' && result.apiKey) {
      return result;
    }
    if (['REJECTED', 'EXPIRED', 'CREDENTIAL_DELIVERED'].includes(result.status)) {
      throw new Error(`registration ended with status ${result.status}`);
    }
    process.stdout.write('.');
  }
  throw new Error('registration timed out before mobile approval');
}

function upsertEnv(filePath, updates) {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    : [];
  const seen = new Set();
  const lines = existing.map(line => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !(match[1] in updates)) {
      return line;
    }
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  fs.writeFileSync(filePath, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const input = {
    hubUrl: args.hub || process.env.HUB_URL || DEFAULT_HUB_URL,
    ownerEmail: args['owner-email'] || process.env.OWNER_EMAIL || DEFAULT_OWNER_EMAIL,
    name: args.name || process.env.SERVER_NAME || os.hostname(),
    osType: args['os-type'] || process.env.OS_TYPE || detectOsType(),
    tailscaleIp: args['tailscale-ip'] || process.env.TAILSCALE_IP || detectIp(),
  };
  input.fingerprint = fingerprintFor(input);

  console.log(`Registering ${input.name} (${input.osType} / ${input.tailscaleIp})`);
  console.log(`Hub: ${input.hubUrl}`);
  console.log(`Approver: ${input.ownerEmail}`);

  const request = await createRequest(input);
  console.log(`\nMobile approval code: ${request.verificationCode}`);
  console.log('Open the Code Caller app, approve the matching server request, then wait here.');

  const result = await pollResult(
    input.hubUrl,
    request.id,
    request.requestSecret,
    request.expiresAt,
  );
  const envPath = path.join(__dirname, '..', '.env');
  upsertEnv(envPath, {
    HUB_URL: input.hubUrl,
    API_KEY: result.apiKey,
    SERVER_ID: result.serverId,
  });
  console.log('\nRegistration approved. agent-daemon/.env has been updated.');
  console.log('Start the daemon with: npm start');
}

main().catch(err => {
  console.error(`\nRegistration failed: ${err.message}`);
  process.exitCode = 1;
});
