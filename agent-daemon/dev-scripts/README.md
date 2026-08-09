# dev-scripts — LOCAL-ONLY test harness

**Not part of the product.** These files exist only to let you exercise
`agent-daemon` without a running Hub API:

- `mock-hub.js` — a throwaway Socket.io server that speaks the Hub's `/daemon`
  namespace contract (see `hub-api/src/realtime/daemon.gateway.ts` + `events.ts`),
  drives a real daemon instance, and asserts on the events it receives.
- `fake-codex.js` — a fake Codex CLI child that prints output, blocks on a
  `(y/n)` confirmation prompt, and resumes when daemon writes to its stdin.

Run the whole end-to-end battery:

```bash
cd agent-daemon
npm run dev:server     # node dev-scripts/mock-hub.js
```

Exit code 0 = all scenarios passed. The scenarios covered:

1. connect with valid apiKey + heartbeat,
2. `task:submit` → `task:statusUpdate RUNNING` → `task:log` → `approval:request` → approved → `task:result COMPLETED`,
3. rejected → child killed, **no** `task:result` (Hub owns CANCELLED),
4. `task:cancel` → child killed, **no** `task:result`,
5. offline buffering: with the Hub down, daemon stays alive, buffers daemon-originated events, and flushes them on reconnect.

Use it to develop or sanity-check against the real Hub: point the daemon's
`HUB_URL` at a real deployment instead, keep `.env` out of version control.