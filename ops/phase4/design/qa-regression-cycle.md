# QA Regression Cycle - 2026-08-16

## Context

The highest-priority incomplete non-screen backlog item is the P2 QA regression test after Phase 3/3b, MacBook daemon registration, Android cleartext-network fix, and Phase 4 worker failover/watchdog/capacity changes.

## Scope

- Hub API static/runtime build checks.
- Agent daemon mock Hub integration checks, including capacity exhaustion behavior added in Phase 4.
- Mobile app TypeScript and Android release build checks.
- Live Hub reachability check from the Mac to the configured deployment addresses.

## Verification Matrix

| Area | Check | Expected |
|---|---|---|
| Hub API | `npx prisma validate && npx prisma generate && npm run build` | schema and Nest build pass |
| Agent daemon | `npm run dev:server` | all mock integration scenarios pass |
| Mobile app | `npm run typecheck` | TypeScript pass |
| Android release | `./gradlew assembleRelease` with Android SDK env | release APK build pass |
| Live Hub | unauthenticated `GET /servers` | HTTP 401 reachability signal |

## Result

All local/static/build checks passed. Live Hub reachability did not pass from the Mac during the regression window: `172.30.1.83:3000` timed out and `100.92.64.11:3000` refused the connection. This is recorded as a high-severity operational finding in `BUGS.md` and a follow-up backlog item.
