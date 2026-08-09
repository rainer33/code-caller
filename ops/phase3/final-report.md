# Phase 3 Final Report

Branch: `feature/mobile-app-phase3`

## Built

- Added `mobile-app/`, a React Native 0.86 Android client.
- Implemented login against `POST /auth/login`.
- Implemented authenticated REST loading for `/servers`, `/tasks`, and `/approvals?status=PENDING`.
- Implemented approve/reject actions through `POST /approvals/:id/decision`.
- Implemented Socket.io `/app` subscription with JWT auth and handlers for `task:updated`, `approval:pending`, and `approval:resolved`.
- Implemented Android FCM token registration flow through `POST /notifications/push-token`.
- Added reusable prompt `ops/prompts/phase3-mobile-app.md`.
- Added design/status/report files under `ops/phase3/`.

## Verification

- `cd mobile-app && npm run typecheck`: passed.
- `cd mobile-app && npm test -- --runInBand`: passed.
- `cd mobile-app && npm run lint`: passed.
- `cd mobile-app/android && ANDROID_HOME=$HOME/.local/share/android-sdk ANDROID_SDK_ROOT=$HOME/.local/share/android-sdk ./gradlew assembleDebug`: passed.
- Debug APK: `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA-256: `75324ea98b6c80edd6609a558c0672da17b4931dbbb33df96f12758cecda7d7d`
- `curl -i http://172.30.1.83:3000/servers`: returned `HTTP/1.1 401 Unauthorized`, confirming network reachability and JWT protection.
- `curl -i -X POST http://172.30.1.83:3000/auth/login` with the default seed password returned `HTTP/1.1 401 Unauthorized`, confirming the deployed password is not the default.

## Known Limits

- Full successful live login could not be completed because this Codex session does not have the Ubuntu SSH password or the deployed `SEED_USER_PASSWORD`; SSH key auth also failed.
- No Android device/emulator is connected (`adb devices` returned an empty list), so install-and-boot verification was not possible in this session.
- FCM delivery was not tested. The app registers a token when Firebase runtime config is present, but Hub API deployment has `FCM_SERVICE_ACCOUNT_PATH` blank and this repo does not include `google-services.json`.
- React Native CLI generated iOS template files, but this phase is Android-only; `mobile-app/ios/` is intentionally ignored and not committed.

## Status Schema

Each subtask writes `ops/phase3/status/<subtask>/status.json` and, on success, `ops/phase3/status/<subtask>/.done`.

Fields used:

- `status`: `running`, `success`, or `failed`
- `owner`: command owner, here `codex`
- `task`: short task name
- `startedAt`: UTC ISO timestamp
- `updatedAt`: UTC ISO timestamp
- `summary`: current or final state
- `evidence`: command/file/artifact evidence
- `next`: next action
- `error`: error detail or `null`

PHASE3_DONE
