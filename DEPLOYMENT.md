# Ubuntu deployment

The Hub API is deployed on this machine as the systemd user service `hub-api.service`. It listens on `localhost:3000` and starts automatically at boot through the user's lingering systemd manager.

The Ubuntu worker daemon is deployed on the same host as the systemd user
service `code-caller-agent-daemon.service`. It runs from
`/home/jahmin/awork/code-caller/agent-daemon`, connects to the Hub `/daemon`
namespace, and is registered in the Hub as `Ubuntu-Codex`. The daemon credential
is stored only in the gitignored `agent-daemon/.env`.

PostgreSQL 16.4 and Redis 7.4.5 are local-only dependencies managed by `code-caller-postgres.service` and `code-caller-redis.service`. Docker was unavailable and apt installation required an interactive sudo password, so they were built and installed without root under `/home/jahmin/.local/share/code-caller`. PostgreSQL listens on `127.0.0.1:5432`, Redis listens on `127.0.0.1:6379`, and Redis persistence is enabled with AOF.

The Prisma migrations deployed so far:

- `20260809041332_init`
- `20260809095000_server_registration_requests`

The initial account was seeded:

- Email: `admin@example.com`
- Password: stored only in `hub-api/.env.deployment-secrets` (mode `0600`, gitignored)

Runtime configuration is in the gitignored `hub-api/.env`. Firebase Cloud Messaging remains disabled because `FCM_SERVICE_ACCOUNT_PATH` is blank.

## Operations

Check all service statuses:

```bash
systemctl --user status hub-api code-caller-agent-daemon code-caller-postgres code-caller-redis
```

Follow Hub API logs:

```bash
journalctl --user -u hub-api -f
```

Follow Ubuntu daemon logs:

```bash
journalctl --user -u code-caller-agent-daemon -f
```

Restart the Hub API:

```bash
systemctl --user restart hub-api
```

Restart the Ubuntu daemon:

```bash
systemctl --user restart code-caller-agent-daemon
```

Stop or start the Hub API:

```bash
systemctl --user stop hub-api
systemctl --user start hub-api
```

The committed unit definitions are under `deploy/`. If they change, reload and restart them with:

```bash
systemctl --user daemon-reload
systemctl --user restart code-caller-postgres code-caller-redis hub-api code-caller-agent-daemon
```

## Verification

The login endpoint is the deployment health check. This command reads the password from the uncommitted secrets file:

```bash
cd /home/jahmin/awork/code-caller/hub-api
password=$(sed -n 's/^SEED_USER_PASSWORD=//p' .env.deployment-secrets)
curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"admin@example.com\",\"password\":\"$password\"}"
```

A healthy response contains both `accessToken` and `refreshToken`.

The server-registration endpoint is the onboarding smoke test:

```bash
curl -i -X POST http://localhost:3000/server-registration-requests \
  -H 'Content-Type: application/json' \
  --data '{"ownerEmail":"admin@example.com","name":"smoke","osType":"MACOS","tailscaleIp":"127.0.0.1","fingerprint":"1234567890123456"}'
```

A healthy response is `201 Created` with `verificationCode`, `requestSecret`,
and `status: "PENDING"`. Reject or ignore the smoke request afterward; pending
requests expire automatically.

Verify daemon connectivity from the Hub logs:

```bash
journalctl --user -u hub-api -n 80 --no-pager | grep 'Daemon connected'
```

Known deployed daemon ids as of 2026-08-09:

- `MacBook-Local`: `44e297ed-2e65-43dd-9c45-7dc405ff40ae`
- `Ubuntu-Codex`: `e1f1370a-7059-428f-be39-fcfb97d01303`

## Deployment notes

- Dependencies were installed with `npm install` and the application was built with `npm run build`.
- The production entry point is `dist/src/main.js`.
- User lingering is enabled (`loginctl show-user jahmin -p Linger` returns `Linger=yes`).
- Server onboarding requires `npx prisma migrate deploy`, `npx prisma generate`,
  `npm run build`, and `systemctl --user restart hub-api` after pulling the
  latest code.
