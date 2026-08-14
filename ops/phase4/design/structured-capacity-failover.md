# Phase 4 Structured Capacity Failover

## Context

Dispatch-time failover and the RUNNING watchdog already reassign tasks when a daemon is unavailable or silent. A Codex CLI can also exit quickly with a capacity, quota, or rate-limit error. Before this slice, the daemon reported that as a plain `FAILED` result, so the Hub finalized the task instead of trying the next compatible worker.

## Confirmed Decisions

- Keep the socket event names stable. `task:result` gains optional structured failure metadata instead of adding a new event.
- Detect capacity exhaustion in the daemon from the child output tail and process error text. This keeps provider-specific CLI text near the adapter that sees it.
- Treat `CAPACITY_EXHAUSTED` as retryable at the Hub. The current attempt is marked failed with a structured reason, the exhausted server is excluded from the next dispatch candidate list, and the same task is put back in `QUEUED`.
- If no compatible candidate remains, fail the task with a Hub log explaining that capacity failover was exhausted.
- Avoid schema changes. `TaskAttempt.failureReason` stores a compact structured reason string, while `Task.result` keeps the daemon's full result payload.

## Contract Addition

Daemon `task:result` for retryable capacity failure:

```json
{
  "taskId": "task-id",
  "status": "FAILED",
  "failure": {
    "category": "CAPACITY_EXHAUSTED",
    "retryable": true,
    "message": "Codex capacity/quota/rate-limit signal detected."
  },
  "result": {
    "exitCode": 1,
    "signal": null,
    "lastChunk": "...",
    "failure": {
      "category": "CAPACITY_EXHAUSTED",
      "retryable": true,
      "message": "..."
    }
  }
}
```

## State Machine Addition

```text
RUNNING
  -> QUEUED   daemon result FAILED with retryable CAPACITY_EXHAUSTED and another worker exists
  -> FAILED   daemon result FAILED with non-retryable reason, or capacity failover has no remaining candidate
```

## Verification

- `cd agent-daemon && npm run dev:server`
- `cd hub-api && npx prisma validate`
- `cd hub-api && npx prisma generate`
- `cd hub-api && npm run build`
- Prisma smoke test against local Postgres:
  - create two online CODEX worker profiles for the same owner
  - create a RUNNING task and attempt on server A
  - invoke `handleDaemonTaskResult()` with `CAPACITY_EXHAUSTED`
  - confirm the task returns to `QUEUED`, the A attempt is `FAILED`, and the next dispatch candidate is server B
