# Agent Daemon (Phase 2)

A lightweight Node.js process that runs on each managed server, opens a
persistent Socket.io connection to the Hub's `/daemon` namespace, and drives a
local **Codex CLI** process under the Hub's control.

The daemon does not expose any ports and needs no database. It is the only
Hub↔daemon contract in this repo, mirroring `hub-api/src/realtime/events.ts` and
`hub-api/src/realtime/daemon.gateway.ts`.

## Event contract (matches the Hub)

| Direction | Event | Payload |
|---|---|---|
| Daemon → Hub | `daemon:heartbeat` | `{}` (Hub tags it with the socket's server) |
| Daemon → Hub | `task:statusUpdate` | `{ taskId, status: 'RUNNING' }` |
| Daemon → Hub | `task:log` | `{ taskId, chunk }` per stdout/stderr chunk |
| Daemon → Hub | `approval:request` | `{ taskId, reason }` |
| Daemon → Hub | `task:result` | `{ taskId, status: 'COMPLETED'\|'FAILED', result }` |
| Hub → Daemon | `task:submit` | `{ taskId, input }` |
| Hub → Daemon | `task:cancel` | `{ taskId }` |
| Hub → Daemon | `approval:decision` | `{ taskId, approved, reason }` |

Connection auth is `auth: { apiKey }` on the HTML5 WebSocket handshake to
`${HUB_URL}/daemon`, exactly as `DaemonGateway.handleConnection` expects.

## Setup & run

```bash
cd agent-daemon
cp .env.example .env        # then fill in HUB_URL, API_KEY, SERVER_ID
npm install
npm start                   # or: node src/index.js
```

Log in to the Hub and register the server once to get an API key:

```bash
# (Hub running, seed user from hub-api/README.md)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me-please"}' | jq -r .accessToken)
curl -s -X POST http://localhost:3000/servers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"ubuntu-01","osType":"UBUNTU","tailscaleIp":"100.x.y.z"}'
# -> {... "apiKey": "sk_..." }  <- put this in .env as API_KEY
```

The server shows `ONLINE` once the daemon connects and starts heartbeating.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `HUB_URL` | — (required) | Base URL of the Hub API, e.g. `http://localhost:3000` |
| `API_KEY` | — (required) | API key returned by `POST /servers` |
| `SERVER_ID` | `daemon` | Local label used in logs only |
| `CODEX_COMMAND_TEMPLATE` | `codex exec "{{prompt}}"` | How to spawn Codex (see below) |
| `CODEX_EXEC_CWD` | cwd | Work-tree directory for the child process |
| `CODEX_USE_SHELL` | `0` | `1` = run through the system shell (`spawn shell:true`) |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat interval |
| `DEBUG_OUTPUT=1` | `0` | Log every socket event the daemon emits |

### Command template placeholders

- `{{prompt}}` → `input.prompt` (raw text, passed as a single argument)
- `{{input}}` → full `input` object serialized as JSON
- `{{cwd}}` → the configured work directory

The default template spawns the CLI directly (`shell:false`), so a malicious
prompt can’t inject shell syntax. Set `CODEX_USE_SHELL=1` only if you need it
(e.g. a Windows `.cmd` shim); placeholder values are then single-quoted.

## Behavior

- On startup: connect to `${HUB_URL}/daemon` with `auth.apiKey`; heartbeats every 30s.
- `task:submit` spawns one Codex process per task and immediately emits
  `task:statusUpdate RUNNING`. Tasks run concurrently; each is tracked by taskId.
- stdout/stderr are sniffed: chunks are relayed as `task:log`.
- If a confirmation prompt is detected, the daemon emits `approval:request` and
  **holds stdin** so the child stays blocked. It never auto-answers.
- `approval:decision(approved: true)` → writes `y\n` to the child's stdin.
  `approval:decision(approved: false)` or `task:cancel` → **kills** the child.
- Child exits → `task:result` (COMPLETED if exit code 0, else FAILED).
  If the child was killed in response to a Hub cancel/rejection, the daemon
  does **not** emit `task:result` — the Hub already owns that task’s final
  state (CANCELLED).
- On disconnect the daemon buffers every daemon-originated event in memory and
  replays them in order on reconnect.

## Approval-detection heuristic

Implementation: `src/approval-detector.js`.

It looks at the trailing output of the child and flags a confirmation when a
line contains an interactive prompt marker — `(y/n)`, `y/n`, `yes/no`,
`allow`/`approve`/`permit`/`confirm …`, `proceed/continue …?`,
`do you want to [continue|proceed|run|execute]?`, `are you sure?`,
`suggested shell command?`. The `reason` sent in `approval:request` is a short
excerpt of the prompt window plus the 2 preceding lines (where vocabulary such
as `rm -`, delete, sudo, git push, deploy, ssh, curl|sh, shutdown … tends to
appear).

**Known limitations** (why this is a heuristic, not a guarantee):
- It can only see what the CLI prints to stdout/stderr. A prompt hidden in a
  raw TTY frame you never receive can’t be detected.
- Prompts phrased outside the regex set may be missed — the child would then
  proceed on its own input if Codex auto-accepts in your setup. Run Codex in a
  mode that requires stdin consent for destructive actions.
- False positives are possible (ordinary output containing “allow?”), which
  shows up as an approval request you can approve instantly.
- Regexes scan per-line; a request split across many lines at low volume is
  still caught because the detector looks at the rolled-up tail window, but
  extremely long single lines are not indented more than `TAIL_LIMIT` bytes back.

## Testing locally (no Hub required)

`npm run dev:server` starts a throwaway mock Hub that speaks the `/daemon`
namespace contract, plus `UMock-Codex` — a fake Codex script that prints
output, then a confirmation prompt, and resumes reading stdin after its
“apps”. See `dev-scripts/mock-hub.js` (clearly a local-only harness) and the
`dev-scripts/` README inside it.

## Cross-platform notes

- Uses Node ≥ 18 APIs only (`child_process.spawn`, `socket.io-client`).
- Default launch path is `shell:false`, which is portable on Linux/macOS and
  for a single-binary `codex`. On Windows the official installer ships a
  `codex` shim; if it is a `.cmd`, set `CODEX_USE_SHELL=1`.