# Phase 3 Status Schema

Each subtask writes `ops/phase3/status/<subtask>/status.json` and, on success, `ops/phase3/status/<subtask>/.done`.

`status.json` schema:

```json
{
  "status": "running",
  "owner": "codex",
  "task": "short stable task name",
  "startedAt": "2026-08-09T00:00:00.000Z",
  "updatedAt": "2026-08-09T00:00:00.000Z",
  "summary": "human-readable current state",
  "evidence": ["commands, files, or artifacts"],
  "next": "next expected action",
  "error": null
}
```

Allowed `status` values are `running`, `success`, and `failed`.
