# Phase 3 Mobile App Design

## Context

Phase 1 (`hub-api/`) and Phase 2 (`agent-daemon/`) are already on `main`. Phase 3 adds an Android-first React Native mobile client without changing `hub-api/` or `agent-daemon/`. The deployed Hub API is expected at `http://172.30.1.83:3000`.

The app must cover login, server list, task status with `/app` Socket.io updates, approval/deny actions, and FCM push token registration. Actual FCM delivery is out of scope because no service account key is configured on the Hub API.

As of 2026-08-09, the product direction is broader than the original Android MVP:
the mobile app should become the user's control plane for observing, approving,
and directing AI coding agents across Mac, Ubuntu, Windows, and eventually iOS
clients. Agent execution remains server-side through Hub + `agent-daemon`.

## Confirmed Decisions

- React Native Android-first client: required by the Phase 3 prompt and SRS.
- REST-first data loading with Socket.io deltas: matches Hub API Phase 1 contracts and keeps the future web dashboard path open.
- JWT access token in memory plus persisted refresh token: access token is needed for REST and Socket.io auth; refresh token allows app relaunch recovery.
- FCM registration is best-effort: token registration is implemented, but delivery cannot be verified without `FCM_SERVICE_ACCOUNT_PATH`.
- Hub/Daemon source is read-only for Phase 3: API gaps are documented instead of patched.
- Mobile is a control plane, not an execution runtime: it creates tasks, receives
  status/logs, and approves important actions. Codex/Claude/Antigravity/OpenCode
  execution belongs to registered daemons.
- Future server onboarding should be approval-based: a new server runs a
  `code-caller register` style command, the mobile app shows a registration
  request with a short verification code, and approval creates the durable
  `Server` plus daemon credential.
- This approval-based onboarding path is implemented as of `d5e1865` and
  deployed to the Ubuntu Hub on 2026-08-09. `Ubuntu-Codex` was registered by
  running `agent-daemon npm run register`, approving the verification code in
  the mobile app, and starting `code-caller-agent-daemon.service`.
- Voice input is an input-mode enhancement for `New Task`, not a backend
  architecture change. Speech recognition should write editable text into the
  prompt field; the user still presses submit explicitly.

## Architecture

```
[Android React Native App]
  screens/
    LoginScreen
    ServersScreen
    TasksScreen
    TaskDetailScreen
    ApprovalsScreen
  services/
    apiClient        REST with Bearer JWT
    authStore        token persistence and refresh/logout
    realtimeClient   Socket.io /app namespace, JWT auth
    pushService      FCM permission/token registration
        |
        | REST: /auth/login, /auth/refresh, /servers, /tasks,
        |       /approvals, /approvals/:id/decision,
        |       /notifications/push-token
        | Socket.io: /app auth.token, outbound events
        v
[Hub API at http://172.30.1.83:3000]
```

Long-term architecture:

```
[Mobile App: Android / iPhone]
  login, server registration approvals, task creation, task detail/logs,
  risk approvals, push notifications, optional voice-to-text prompt input
      |
      | REST + Socket.io
      v
[Hub API]
  auth, users, server registration requests, servers, tasks, approvals,
  worker routing, provider/profile/capability matching
      |
      | /daemon Socket.io
      v
[agent-daemon on each machine]
  runs local Codex / Claude Code / Antigravity / OpenCode profiles
  streams logs, requests approvals, returns results
```

## Component Breakdown

`App` owns global auth state, screen navigation, and boot-time session restore.

`apiClient` owns JSON fetch, bearer token headers, 401 refresh retry, and typed wrappers for Phase 3 endpoints.

`realtimeClient` owns the `/app` Socket.io connection. It reconnects whenever the access token changes and calls screen-level handlers for `task:updated`, `approval:pending`, and `approval:resolved`.

`pushService` owns Android notification permission checks, FCM token retrieval, and `/notifications/push-token` registration. Missing Firebase config is surfaced as a non-fatal limitation.

Screens are deliberately operational: login form, server list, task list,
approval queue, manual refresh controls, and approve/reject buttons. However,
the task list must stay a summary surface. Full prompts, logs, and results belong
in a task detail screen so the mobile UX does not collapse under long agent
output.

## Data Model

Client-side shapes mirror Hub API public responses:

- `AuthTokens`: `accessToken`, `refreshToken`
- `Server`: `id`, `name`, `osType`, `tailscaleIp`, `status`, `lastHeartbeatAt`, `createdAt`
- `Task`: `id`, `serverId`, `workerType`, `status`, `input`, `result`, `logs`, `createdAt`, `updatedAt`
- `Approval`: `id`, `taskId`, `status`, `requestedAt`, `decidedAt`, `reason`, optional included `task`
- `PushTokenRegistration`: `token`, `platform: "ANDROID"`

Planned data model extensions:

- `ServerRegistrationRequest`: pending server onboarding request from a daemon
  without an API key yet. Includes requested name, OS, IP/Tailscale IP,
  fingerprint, short verification code, status, and expiry.
- `ApprovalRequest` generalization: future approvals should cover task prompts,
  server registration, dangerous command/file actions, deployment, and cost or
  capacity exceptions under one user-facing approval model.
- `WorkerProfile`: replace or extend the fixed `WorkerType` enum with provider,
  model/profile, and capability metadata.

## State Machines

Task status follows the Hub API enum:

```
QUEUED -> RUNNING -> AWAITING_APPROVAL -> RUNNING -> COMPLETED
                            |              |
                            v              v
                        CANCELLED        FAILED
```

Approval status follows the Hub API enum:

```
PENDING -> APPROVED
PENDING -> REJECTED
```

The mobile client does not create new states. It only reloads full lists and applies socket event payloads by id.

Server registration request status should follow:

```
PENDING -> APPROVED -> CREDENTIAL_DELIVERED
PENDING -> REJECTED
PENDING -> EXPIRED
```

## Communication Contracts

REST:

- `POST /auth/login` body `{ email, password }` -> `{ accessToken, refreshToken }`
- `POST /auth/refresh` body `{ refreshToken }` -> `{ accessToken, refreshToken }`
- `POST /auth/logout` body `{ refreshToken }` -> `204`
- `GET /servers` -> `Server[]`
- `GET /tasks` -> `Task[]`
- `GET /approvals?status=PENDING` -> `Approval[]`
- `POST /approvals/:id/decision` body `{ approve, reason? }` -> `Approval`
- `POST /notifications/push-token` body `{ token, platform: "ANDROID" }` -> `204`

REST for server onboarding:

- `POST /server-registration-requests` from an unregistered daemon, creating a
  short-lived pending request, verification code, and request secret.
- `GET /server-registration-requests` for the authenticated mobile app's
  pending requests.
- `POST /server-registration-requests/:id/decision` for mobile approve/reject.
- `GET /server-registration-requests/:id/result?secret=...` for daemon polling.
  Approval creates the durable `Server` record and delivers the daemon
  credential once through the registration session, not by exposing secrets in
  the app list.

Socket.io:

- namespace: `/app`
- client auth: `{ token: accessToken }`
- outbound events consumed by app:
  - `task:updated`
  - `approval:pending`
  - `approval:resolved`

## Unverified Assumptions

- Android SDK/emulator availability is not guaranteed on the Mac workspace. If missing, verification will fall back to installable SDK command-line tools or document the blocker.
- The seeded production password is not in git. Live login verification requires reading it from the Ubuntu deployment secret over SSH or receiving it from the user.
- Firebase Android config may be absent. The push implementation must tolerate this and document that real FCM delivery was not tested.
- iPhone support is feasible because the app is React Native, but iOS needs its
  own Firebase/APNs, network, safe-area, and build verification path.
- Voice recognition can be added later, but must always show editable recognized
  text before task submission.

## Roadmap

1. Design and tracking setup: design doc, status schema, reusable prompt, branch.
2. Mobile scaffold: create `mobile-app/` with Android-focused React Native app structure.
3. Core integration: auth, REST API client, Socket.io updates, screen flow.
4. Push integration: FCM token registration with graceful missing-config behavior.
5. Verification: install/build dependencies, run static checks, Android build, and live Hub API login/API smoke test when credentials are available.
6. Commit and final report with evidence, limitations, status schema, branch name, and `PHASE3_DONE`.

## Product Roadmap After UI Cleanup

1. Completed: `TaskDetailScreen` with full prompt/result/log reading,
   per-section scrolling, result-first reading order, and live log auto-scroll.
2. Completed: approval-based server onboarding with `agent-daemon npm run
   register`, mobile approval, one-time daemon credential delivery, and
   automatic online appearance in `Servers`.
3. Started: provider/profile/capability data model via `WorkerProfile` and
   provider enum. Hub routing still needs capacity-aware selection.
4. Add voice-to-text prompt input on mobile after the task detail and onboarding
   foundations are stable.
5. Add iPhone build/support using the same control-plane API contracts.

## Verification Plan

- `npm install` in `mobile-app/`
- TypeScript check or project build check
- Android Gradle build for debug APK where SDK is available
- REST smoke test against `http://172.30.1.83:3000/auth/login` and authenticated endpoints
- Socket.io smoke test at least at client-code level; live socket connection when a valid token is available
