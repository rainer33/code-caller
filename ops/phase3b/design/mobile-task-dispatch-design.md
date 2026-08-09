# Phase 3B Mobile Task Dispatch Design

## Context

Phase 3 shipped the Android-first React Native client with login, server list,
task list, approval decisions, Socket.io updates, and best-effort FCM token
registration. The missing core workflow is creating a new Hub task from the
phone and dispatching it to a chosen server, especially the deployed
`MacBook-Local` daemon target. Phase 3B adds only that mobile workflow.

Hub API and agent daemon code are out of scope. The existing deployed Hub API at
`http://172.30.1.83:3000` already supports `GET /servers`, `POST /tasks`, and
`GET /tasks/:id`.

As of the UI cleanup discussion on 2026-08-09, this workflow is still valid as
the MVP, but it should evolve. The long-term task creation UX should let the
user describe the goal first, then let Hub recommend or choose the best
server/agent profile based on availability and capability. Manual server
selection remains useful as an advanced override.

## Confirmed Decisions

- Keep the current single-file React Native app shape: Phase 3 uses `App.tsx`
  for typed API wrappers and screen components, so Phase 3B should avoid a
  broad refactor.
- Add a top-level `New Task` tab: task creation is a primary app workflow, not
  a hidden action buried inside the existing list.
- Server options come from the already-loaded `GET /servers` response: this
  preserves the existing REST-first loading model and guarantees
  `MacBook-Local` is visible when the Hub returns it.
- Default `workerType` is `CODEX`: it matches the verified local daemon path.
- On successful `POST /tasks`, reload all lists and navigate to `Tasks`: this
  verifies the new task is visible through the same list path users already use.
- The New Task prompt field must be keyboard-safe on mobile. When the prompt is
  focused or grows, the form should auto-scroll so the user can still see what
  they are typing and reach the submit button.
- Voice recognition is a future input method for this screen. It should convert
  speech into editable prompt text, never auto-submit directly.
- The current fixed `WorkerType` selector is acceptable for MVP, but future
  versions should use provider/profile/capability metadata rather than a small
  hard-coded enum.

## Architecture

```
[NewTaskScreen]
  select server from in-memory GET /servers result
  select workerType: CODEX | CLAUDE | GEMINI
  enter prompt (text now, voice-to-text later)
      |
      | POST /tasks
      | body { serverId, workerType, input: { prompt } }
      v
[Hub API]
      |
      | response Task
      v
[Mobile App]
  prepend returned task
  reload /servers, /tasks, /approvals?status=PENDING
  navigate to Tasks tab
```

Socket.io remains unchanged. If the daemon progresses the task after creation,
the existing `task:updated` listener continues to merge updates into the task
list.

Future architecture:

```
[NewTaskScreen]
  enter goal/prompt first
  optional: choose provider/profile/capability or accept Hub recommendation
  optional: override server
      |
      | POST /tasks
      | body { goal/input, preferredProfile?, preferredServerId? }
      v
[Hub routing]
  choose registered daemon with matching capability and capacity
      |
      v
[agent-daemon]
```

## Component Breakdown

`App` owns the new `createTask` callback, task form state reset after success,
and navigation to the task list.

`NewTaskScreen` owns display and validation for server selection, worker type
selection, prompt text entry, and submit button enablement. It receives all
state through props so the existing top-level app remains the only owner of
network side effects.

`WorkerTypeSelector` is implemented with existing `Pressable` styling patterns
instead of adding dependencies.

`ServersList`, `TasksList`, and `ApprovalsList` remain read-only except for the
existing approval decision callback.

`NewTaskScreen` uses scroll-aware keyboard handling. Prompt focus and text
growth should move the form toward the prompt/submit area rather than leaving
the user typing behind the keyboard or bottom navigation.

## Data Model

Existing client shapes are reused:

- `ServerItem`: source for server picker labels.
- `TaskItem`: result from `POST /tasks` and list rows.

New client-only type:

- `WorkerType`: `"CODEX" | "CLAUDE" | "GEMINI"`

Planned replacement:

- `WorkerProfile`: provider (`codex`, `claude-code`, `antigravity`,
  `opencode`), profile/model, capabilities, and optional server constraints.

Task creation request body:

- `serverId`: selected server id.
- `workerType`: selected `WorkerType`, default `CODEX`.
- `input.prompt`: non-empty prompt text.

## State Machines

New task form:

```
empty prompt/server -> editable
editable + non-empty prompt + selected server -> submittable
submitting -> disabled controls
success -> reset form -> Tasks tab
failure -> editable with error message preserved
```

Voice input state, when added:

```
idle -> listening -> transcript ready -> editable prompt -> submit
idle -> permission denied -> editable prompt
listening -> cancelled -> editable prompt
```

Task lifecycle remains owned by Hub/daemon:

```
QUEUED -> RUNNING -> COMPLETED | FAILED | AWAITING_APPROVAL
```

## Communication Contracts

REST already used:

- `GET /servers` -> `ServerItem[]`
- `GET /tasks` -> `TaskItem[]`

REST added to the mobile app:

- `POST /tasks`
  - body: `{ "serverId": string, "workerType": "CODEX"|"CLAUDE"|"GEMINI", "input": { "prompt": string } }`
  - response: `TaskItem`

Future task creation contract should support recommendation/routing without
forcing users to understand server placement:

- `POST /tasks`
  - body: `{ "input": { "prompt": string }, "preferredProfileId"?: string, "preferredServerId"?: string }`
  - Hub validates capability and capacity before dispatch.

Live verification-only REST:

- `GET /tasks/:id` -> `TaskItem`

## Unverified Assumptions

- The live deployed admin credentials are available through the same local
  mechanism used in Phase 3 verification, but they must not be written to source
  files, commits, or reports.
- `MacBook-Local` remains registered and connected during live verification.
- Android SDK paths from Phase 3 are still present under the user's local SDK
  directory.
- The current server list is API-backed, but server onboarding remains too
  manual. Future releases should add `code-caller register` plus mobile approval
  before task dispatch UX is considered product-complete.

## Roadmap

1. Design setup: create Phase 3B design and status tracking files.
2. Mobile implementation: add `New Task` tab, server picker, worker selector,
   prompt input, and `POST /tasks` flow.
3. JavaScript validation: run typecheck, unit test, and lint.
4. Live Hub verification: use the app-level request contract against the
   deployed Hub, create a real `MacBook-Local` CODEX task, and poll
   `GET /tasks/:id` until terminal.
5. Android build: rebuild debug APK.
6. Commit and final report with `PHASE3B_DONE` as the last line.

## Follow-up UX Roadmap

1. Add a Task Detail screen before trying to show large prompts, logs, and
   results inside list cards.
2. Keep New Task keyboard-safe with auto-scroll, and later add microphone
   input as a text-entry helper.
3. Replace hard-coded server-first task creation with goal-first creation and
   Hub recommendation once provider/profile/capability routing exists.

## Verification Plan

- `cd mobile-app && npm run typecheck`
- `cd mobile-app && npm test -- --runInBand`
- `cd mobile-app && npm run lint`
- Live HTTP smoke against `http://172.30.1.83:3000` without persisting secrets:
  login, `GET /servers`, assert `MacBook-Local`, `POST /tasks`, poll
  `GET /tasks/:id` to `COMPLETED` when daemon is available.
- `ANDROID_HOME=$HOME/.local/share/android-sdk ANDROID_SDK_ROOT=$HOME/.local/share/android-sdk ./gradlew assembleDebug`
