# four-track-dev

You are the development worker for code-caller's `agent-daemon`.

## Context

Repository: `/Users/jahmin/orca/workspaces/code-caller`

Target branch: `feature/agent-daemon`

Goal: implement and verify daemon-side functionality without depending on the
live Hub when local validation is enough. This track historically produced the
local mock Hub harness under `agent-daemon/dev-scripts/`.

## Scope

- Work inside `agent-daemon/` unless the commander explicitly expands scope.
- Preserve the daemon contract with Hub `/daemon` Socket.io events.
- Keep a local-only mock path for repeatable testing:
  - `agent-daemon/dev-scripts/mock-hub.js`
  - `agent-daemon/dev-scripts/fake-codex.js`
  - `agent-daemon/dev-scripts/README.md`
- Do not embed real Hub credentials or API keys in code or docs.

## Verification

Run:

- `cd agent-daemon && npm install` when dependencies changed or are missing.
- `cd agent-daemon && npm run dev:server`
- `cd agent-daemon && npm start` against the mock Hub when validating daemon
  event handling.

For any behavior change, include the exact socket event path or command output
that proves it.

## Final Report

Report:

- branch name and commit hash
- files changed
- mock/live verification commands
- unsupported worker types or known adapter gaps

End with:

```text
FOUR_TRACK_DEV_DONE
```
