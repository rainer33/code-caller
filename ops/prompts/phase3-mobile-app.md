# Phase 3 Mobile App Worker Prompt

You are working in `/Users/jahmin/orca/workspaces/code-caller` on branch `feature/mobile-app-phase3`.

Scope:

- Build only Phase 3 mobile app files, preferably under `mobile-app/`.
- Do not modify `hub-api/` or `agent-daemon/`.
- Follow `ops/phase3/design/mobile-app-design.md`.
- Update your subtask status under `ops/phase3/status/<subtask>/status.json`.
- Write `.done` in that subtask directory only after success.
- Verify with real commands and leave evidence in status JSON.

Hub API base URL: `http://172.30.1.83:3000`.

Required app flow:

1. Login via `POST /auth/login`.
2. List servers via `GET /servers`.
3. List tasks via `GET /tasks` and consume `/app` Socket.io events `task:updated`, `approval:pending`, `approval:resolved`.
4. List pending approvals via `GET /approvals?status=PENDING`.
5. Approve/reject via `POST /approvals/:id/decision`.
6. Register Android FCM token via `POST /notifications/push-token`; document that real delivery is not tested without Firebase service account/config.
