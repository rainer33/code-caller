# Phase 3 Mobile App Design

## Context

Phase 1 (`hub-api/`) and Phase 2 (`agent-daemon/`) are already on `main`. Phase 3 adds an Android-first React Native mobile client without changing `hub-api/` or `agent-daemon/`. The deployed Hub API is expected at `http://172.30.1.83:3000`.

The app must cover login, server list, task status with `/app` Socket.io updates, approval/deny actions, and FCM push token registration. Actual FCM delivery is out of scope because no service account key is configured on the Hub API.

## Confirmed Decisions

- React Native Android-first client: required by the Phase 3 prompt and SRS.
- REST-first data loading with Socket.io deltas: matches Hub API Phase 1 contracts and keeps the future web dashboard path open.
- JWT access token in memory plus persisted refresh token: access token is needed for REST and Socket.io auth; refresh token allows app relaunch recovery.
- FCM registration is best-effort: token registration is implemented, but delivery cannot be verified without `FCM_SERVICE_ACCOUNT_PATH`.
- Hub/Daemon source is read-only for Phase 3: API gaps are documented instead of patched.

## Architecture

```
[Android React Native App]
  screens/
    LoginScreen
    ServersScreen
    TasksScreen
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

## Component Breakdown

`App` owns global auth state, screen navigation, and boot-time session restore.

`apiClient` owns JSON fetch, bearer token headers, 401 refresh retry, and typed wrappers for Phase 3 endpoints.

`realtimeClient` owns the `/app` Socket.io connection. It reconnects whenever the access token changes and calls screen-level handlers for `task:updated`, `approval:pending`, and `approval:resolved`.

`pushService` owns Android notification permission checks, FCM token retrieval, and `/notifications/push-token` registration. Missing Firebase config is surfaced as a non-fatal limitation.

Screens are deliberately simple and operational: login form, server list, task list, approval queue, manual refresh controls, and approve/reject buttons.

## Data Model

Client-side shapes mirror Hub API public responses:

- `AuthTokens`: `accessToken`, `refreshToken`
- `Server`: `id`, `name`, `osType`, `tailscaleIp`, `status`, `lastHeartbeatAt`, `createdAt`
- `Task`: `id`, `serverId`, `workerType`, `status`, `input`, `result`, `logs`, `createdAt`, `updatedAt`
- `Approval`: `id`, `taskId`, `status`, `requestedAt`, `decidedAt`, `reason`, optional included `task`
- `PushTokenRegistration`: `token`, `platform: "ANDROID"`

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

## Roadmap

1. Design and tracking setup: design doc, status schema, reusable prompt, branch.
2. Mobile scaffold: create `mobile-app/` with Android-focused React Native app structure.
3. Core integration: auth, REST API client, Socket.io updates, screen flow.
4. Push integration: FCM token registration with graceful missing-config behavior.
5. Verification: install/build dependencies, run static checks, Android build, and live Hub API login/API smoke test when credentials are available.
6. Commit and final report with evidence, limitations, status schema, branch name, and `PHASE3_DONE`.

## Verification Plan

- `npm install` in `mobile-app/`
- TypeScript check or project build check
- Android Gradle build for debug APK where SDK is available
- REST smoke test against `http://172.30.1.83:3000/auth/login` and authenticated endpoints
- Socket.io smoke test at least at client-code level; live socket connection when a valid token is available
