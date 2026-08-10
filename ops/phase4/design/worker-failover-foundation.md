# Phase 4 Worker Failover Foundation

## Context

The Hub currently dispatches a task to the user-selected server and relies on BullMQ retries when that server's daemon is unavailable. That preserves the task, but it keeps retrying the same target. The P0 backlog requires a preferred worker chain with capacity or availability based fallback.

This first slice implements the smallest verifiable backend foundation: dispatch-time fallback across the same owner's online compatible worker profiles. It does not yet reassign tasks that were accepted by a daemon and then hang or later report capacity exhaustion.

## Confirmed Decisions

- Keep `CreateTaskDto.serverId` as the preferred server. Existing mobile flows and task ownership checks do not need a contract break.
- Use `WorkerProfile` as the compatibility source. It is already the provider/profile/capability extension point added in the registration work.
- Start with synchronous dispatch failures. Offline daemon dispatch already throws through `RealtimeService`, making this path testable without changing the daemon protocol.
- Preserve BullMQ retries. If every candidate fails, the job still retries with backoff instead of marking the task failed immediately.

## Architecture

```text
POST /tasks
  -> Task(status=QUEUED, serverId=preferred)
  -> BullMQ task-dispatch job
  -> TasksProcessor
       -> WorkerRegistry.getDispatchCandidates(workerType, preferredServerId)
       -> preferred online WorkerProfile first
       -> same-owner online compatible profiles next
       -> adapter.submitTask(candidate.serverId)
       -> on success: Task(serverId=candidate, status=RUNNING)
       -> on exhausted failures: append hub log and throw for BullMQ retry
```

## Compatibility Rules

`WorkerType.CODEX` maps to `WorkerProvider.CODEX`. `WorkerType.CLAUDE` maps to `WorkerProvider.CLAUDE_CODE`. `WorkerType.GEMINI` maps to `WorkerProvider.GEMINI`.

Candidates must be:

- owned by the same user as the preferred server
- `Server.status = ONLINE`
- `WorkerProfile.enabled = true`
- same mapped provider as the requested worker type

The preferred server is sorted first when it is a valid candidate; other candidates are sorted by server name for stable behavior.

## Verification

- `npm run build` in `hub-api`
- `npx prisma validate` in `hub-api`

## Follow-Up

- Add daemon-side structured failure reasons for capacity exhaustion.
- Add a watchdog for tasks stuck in `RUNNING` without logs or result past a timeout.
- Store attempt history in a first-class table if operational debugging needs more than the current task log note.
