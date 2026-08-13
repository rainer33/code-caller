# Phase 4 Worker Failover Watchdog

## Context

The first worker failover slice retries dispatch against same-owner online compatible workers when the preferred daemon is unavailable at submit time. It does not cover a task that reaches `RUNNING` and then stops producing updates because the daemon or CLI process hung, disconnected, or exhausted capacity without a structured terminal result.

This slice adds a backend-only watchdog and attempt history. It keeps the mobile and daemon submit contract stable while making `RUNNING` tasks eligible for reassignment after an inactivity timeout.

## Confirmed Decisions

- Keep task IDs stable across reassignments. The mobile app and daemon protocol already key all updates by task ID.
- Requeue stuck tasks instead of creating replacement tasks. This preserves user-facing history and avoids duplicate task rows.
- Add `TaskAttempt` records now. Logs are useful for the UI, but first-class attempt rows make watchdog decisions and future capacity-reason handling auditable.
- Use a repeated BullMQ job for the watchdog. The Hub already depends on BullMQ/Redis, so no new scheduler dependency is needed.
- Start with inactivity-based detection. A task is stuck when it has been `RUNNING` longer than the timeout and neither its task row nor current attempt has changed recently.

## State Machine Addition

```text
QUEUED
  -> RUNNING             dispatch accepted by a candidate
  -> FAILED              all dispatch attempts exhausted

RUNNING
  -> COMPLETED/FAILED    daemon result
  -> AWAITING_APPROVAL   daemon approval request/status
  -> QUEUED              watchdog marks current attempt TIMED_OUT and requeues
```

`AWAITING_APPROVAL` is excluded from watchdog reassignment because waiting for a human approval can be legitimately long.

## Data Model

`TaskAttempt`

- `id`
- `taskId`
- `serverId`
- `status`: `DISPATCHING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `TIMED_OUT`
- `failureReason`
- `startedAt`
- `lastSeenAt`
- `finishedAt`

The current attempt is the latest `DISPATCHING` or `RUNNING` attempt for a task.

## Watchdog Rules

- Default timeout: 15 minutes.
- Default interval: 60 seconds.
- Environment overrides:
  - `TASK_WATCHDOG_TIMEOUT_MS`
  - `TASK_WATCHDOG_INTERVAL_MS`
  - `TASK_WATCHDOG_MAX_REQUEUES`
- The watchdog only scans `RUNNING` tasks.
- If the latest running attempt is stale and fewer than the max requeues have timed out, mark that attempt `TIMED_OUT`, append a Hub log line, set task status back to `QUEUED`, and enqueue dispatch.
- If the max requeue count is reached, mark the task `FAILED`.

## Verification

- `cd hub-api && npx prisma validate`
- `cd hub-api && npm run build`
- Smoke test with Prisma against a temporary local Postgres database:
  - create two online CODEX worker profiles for the same owner
  - create a stale `RUNNING` task and attempt
  - run `scanStuckTasksOnce()`
  - confirm the task returns to `QUEUED`, the old attempt is `TIMED_OUT`, and a dispatch job is enqueued
