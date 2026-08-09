# Ubuntu deployment

The Hub API is deployed on this machine as the systemd user service `hub-api.service`. It listens on `localhost:3000` and starts automatically at boot through the user's lingering systemd manager.

PostgreSQL 16.4 and Redis 7.4.5 are local-only dependencies managed by `code-caller-postgres.service` and `code-caller-redis.service`. Docker was unavailable and apt installation required an interactive sudo password, so they were built and installed without root under `/home/jahmin/.local/share/code-caller`. PostgreSQL listens on `127.0.0.1:5432`, Redis listens on `127.0.0.1:6379`, and Redis persistence is enabled with AOF.

The Prisma migration `20260809041332_init` was deployed and the initial account was seeded:

- Email: `admin@example.com`
- Password: stored only in `hub-api/.env.deployment-secrets` (mode `0600`, gitignored)

Runtime configuration is in the gitignored `hub-api/.env`. Firebase Cloud Messaging remains disabled because `FCM_SERVICE_ACCOUNT_PATH` is blank.

## Operations

Check all service statuses:

```bash
systemctl --user status hub-api code-caller-postgres code-caller-redis
```

Follow Hub API logs:

```bash
journalctl --user -u hub-api -f
```

Restart the Hub API:

```bash
systemctl --user restart hub-api
```

Stop or start the Hub API:

```bash
systemctl --user stop hub-api
systemctl --user start hub-api
```

The committed unit definitions are under `deploy/`. If they change, reload and restart them with:

```bash
systemctl --user daemon-reload
systemctl --user restart code-caller-postgres code-caller-redis hub-api
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

## Deployment notes

- Dependencies were installed with `npm install` and the application was built with `npm run build`.
- The production entry point is `dist/src/main.js`.
- User lingering is enabled (`loginctl show-user jahmin -p Linger` returns `Linger=yes`).
- No application source code was modified.
