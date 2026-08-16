# BUGS.md — QA Findings for code-caller Hub API & Agent Daemon Integration

## 2026-08-16 Regression Cycle: Phase 3/3b + Worker Failover Follow-up

**Test Date**: 2026-08-16
**Branch**: `feature/qa-regression-cycle`
**Scope**: Phase 3/3b mobile build surface, Hub API Prisma/build surface, agent-daemon mock integration, and deployed Hub reachability after worker failover/watchdog/capacity changes.

### PASS: Hub API schema and build

**Command**:
```bash
cd hub-api
npx prisma validate && npx prisma generate && npm run build
```

**Status**: PASS — Prisma schema validates, Prisma Client generates, and Nest build completes.

### PASS: Agent daemon mock integration regression

**Command**:
```bash
cd agent-daemon
npm run dev:server
```

**Status**: PASS — mock Hub scenarios all passed:
- daemon connects with valid API key and emits heartbeat
- task submit emits RUNNING, streams logs, and completes
- cancel kills the child process without a completion result
- capacity exhaustion emits retryable `CAPACITY_EXHAUSTED`
- offline buffering flushes events on reconnect

### PASS: Mobile app TypeScript and Android release build

**Commands**:
```bash
cd mobile-app && npm run typecheck
cd mobile-app/android
ANDROID_HOME=$HOME/.local/share/android-sdk \
ANDROID_SDK_ROOT=$HOME/.local/share/android-sdk \
./gradlew assembleRelease
```

**Status**: PASS — TypeScript check completed and Android release APK build completed successfully.

### FAIL: Deployed Hub API not reachable from Mac during regression window

**Commands**:
```bash
curl --max-time 5 -sS -o /tmp/code-caller-live-servers.json \
  -w 'servers_http=%{http_code}\n' http://172.30.1.83:3000/servers
curl --max-time 5 -sS -o /tmp/code-caller-live-health.json \
  -w 'servers_http=%{http_code}\n' http://100.92.64.11:3000/servers
```

**Observed**:
- `http://172.30.1.83:3000/servers` timed out after 5 seconds.
- `http://100.92.64.11:3000/servers` failed to connect immediately.
- Local launchd still reports `com.codecaller.agent-daemon` running.

**Expected**: unauthenticated `/servers` should return HTTP 401, confirming the Hub API process is reachable even without credentials.

**Severity**: High — mobile and daemon end-to-end live paths depend on the deployed Hub being reachable.

**Next**: Inspect the Ubuntu Hub host/service/network route and restore `http://172.30.1.83:3000` reachability before claiming a live end-to-end pass.

**Test Date**: 2026-08-09  
**Hub API**: Running on http://localhost:3000 (systemd user service `hub-api`)  
**Branch**: `qa/hub-api-smoke` (from main)  
**Seeded Account**: `admin@example.com` (password in `hub-api/.env.deployment-secrets`)

---

## Part 1: Hub API Black-Box Findings

### 1. Login with seeded account works
**Command**:
```bash
password=$(sed -n 's/^SEED_USER_PASSWORD=//p' /home/jahmin/awork/code-caller/hub-api/.env.deployment-secrets)
curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"admin@example.com\",\"password\":\"$password\"}"
```

**Output**:
```json
{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","refreshToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}
```
**Status**: ✅ PASS — Returns both `accessToken` and `refreshToken`.

---

### 2. Wrong password rejected with 401 (not 500)
**Command**:
```bash
curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"admin@example.com","password":"wrongpassword"}'
```

**Output**:
```json
{"message":"이메일 또는 비밀번호가 올바르지 않습니다.","error":"Unauthorized","statusCode":401}
```
**Status**: ✅ PASS — Returns 401 with useful Korean message, not 500.

---

### 3. Authenticated endpoint without token returns 401
**Command**:
```bash
curl -sS -X GET http://localhost:3000/servers
```

**Output**:
```json
{"message":"Unauthorized","statusCode":401}
```
**Status**: ✅ PASS — Returns 401.

---

### 4. Register server returns apiKey
**Command**:
```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' --data "{\"email\":\"admin@example.com\",\"password\":\"$password\"}" | jq -r '.accessToken')
curl -sS -X POST http://localhost:3000/servers \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  --data '{"name":"test-server","description":"Test server for QA","osType":"UBUNTU","tailscaleIp":"100.64.0.1"}'
```

**Output**:
```json
{"id":"5fdb871d-bfb7-4a3b-a74d-954703726a2e","name":"test-server","osType":"UBUNTU","tailscaleIp":"100.64.0.1","status":"OFFLINE","lastHeartbeatAt":null,"createdAt":"2026-08-09T05:19:26.449Z","apiKey":"c3daefbfc95f64cdea9dd55cf0a8f69a640afbc5a39e876c682fbe08311a830d"}
```
**Status**: ✅ PASS — Returns `apiKey` in response.

---

### 5. GET /servers/:id/health for server with no daemon reports OFFLINE
**Command**:
```bash
curl -sS -X GET http://localhost:3000/servers/5fdb871d-bfb7-4a3b-a74d-954703726a2e/health \
  -H "Authorization: Bearer $TOKEN"
```

**Output**:
```json
{"status":"OFFLINE","lastHeartbeatAt":null}
```
**Status**: ✅ PASS — Reports OFFLINE with null heartbeat.

---

### 6. Task against offline server stays QUEUED
**Command**:
```bash
curl -sS -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  --data '{"serverId":"5fdb871d-bfb7-4a3b-a74d-954703726a2e","title":"Test task","command":"echo hello","workingDir":"/tmp","workerType":"CODEX","input":{"test":"value"}}'
# wait 3s
curl -sS -X GET http://localhost:3000/tasks/c51c79a3-1667-4a57-af1b-937d3eeefeeb -H "Authorization: Bearer $TOKEN"
```

**Output** (after 3s):
```json
{"id":"c51c79a3-1667-4a57-af1b-937d3eeefeeb","serverId":"5fdb871d-bfb7-4a3b-a74d-954703726a2e","workerType":"CODEX","status":"QUEUED","input":{"test":"value"},"result":null,"logs":"","createdAt":"2026-08-09T05:20:25.148Z","updatedAt":"2026-08-09T05:20:25.148Z",...}
```
**Status**: ✅ PASS — Task remains QUEUED, does not silently become RUNNING.

---

### 7. Cross-user resource access returns 403/404
Created second user `user2@example.com` via Prisma seed.

**Command** (user2 accessing user1's server):
```bash
TOKEN2=$(curl -sS -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' --data '{"email":"user2@example.com","password":"password123"}' | jq -r '.accessToken')
curl -sS -X GET http://localhost:3000/servers/5fdb871d-bfb7-4a3b-a74d-954703726a2e -H "Authorization: Bearer $TOKEN2"
curl -sS -X GET http://localhost:3000/servers -H "Authorization: Bearer $TOKEN2"
```

**Output**:
```json
{"message":"해당 서버에 접근할 권한이 없습니다.","error":"Forbidden","statusCode":403}
```
```json
[]
```
**Status**: ✅ PASS — Returns 403 for specific resource, empty list for collection (no data leak).

---

### 8. Invalid input validation returns 400 with useful message
**Test 8a: Missing required fields (POST /servers)**
```bash
curl -sS -X POST http://localhost:3000/servers -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --data '{}'
```
**Output**:
```json
{"message":["name must be longer than or equal to 1 characters","name must be a string","osType must be one of the following values: UBUNTU, WINDOWS, MACOS","tailscaleIp must be an ip address"],"error":"Bad Request","statusCode":400}
```

**Test 8b: Invalid enum value (osType)**
```bash
curl -sS -X POST http://localhost:3000/servers -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --data '{"name":"test","osType":"INVALID","tailscaleIp":"100.64.0.1"}'
```
**Output**:
```json
{"message":["osType must be one of the following values: UBUNTU, WINDOWS, MACOS"],"error":"Bad Request","statusCode":400}
```

**Test 8c: Invalid enum value (workerType)**
```bash
curl -sS -X POST http://localhost:3000/tasks -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --data '{"serverId":"5fdb871d-bfb7-4a3b-a74d-954703726a2e","title":"Test","command":"echo hi","workingDir":"/tmp","workerType":"INVALID","input":{"a":1}}'
```
**Output**:
```json
{"message":["workerType must be one of the following values: CODEX, CLAUDE, GEMINI"],"error":"Bad Request","statusCode":400}
```
**Status**: ✅ PASS — All return 400 with descriptive validation messages, no 500s.

---

### Part 1 Summary
All 8 black-box checks pass. No critical bugs found in Hub API REST surface.

---

## Part 2: Hub↔Daemon Integration Test

### Setup
- Copied `agent-daemon/` from `~/awork/code-caller-dev` (branch `feature/agent-daemon`)
- Configured `.env` with:
  - `HUB_URL=http://localhost:3000`
  - `API_KEY=c3daefbfc95f64cdea9dd55cf0a8f69a640afbc5a39e876c682fbe08311a830d` (from Part 1 step 4)
  - `SERVER_ID=test-server`
  - `CODEX_COMMAND_TEMPLATE=bash -c 'echo "MOCK: Starting task..."; echo "Are you sure you want to continue? (y/n)"; read -r ans; echo "User answered: $ans"; echo "MOCK DONE"'` (mock command simulating approval prompt)
  - `CODEX_USE_SHELL=1`
  - `HEARTBEAT_INTERVAL_MS=5000`
  - `DEBUG_SOCKET=1`

---

### 1. Daemon connects and server flips to ONLINE
**Command**:
```bash
cd /home/jahmin/awork/code-caller-qa/agent-daemon && timeout 60 npm start 2>&1 &
sleep 5
curl -sS -X GET http://localhost:3000/servers/5fdb871d-bfb7-4a3b-a74d-954703726a2e/health -H "Authorization: Bearer $TOKEN"
```

**Daemon Logs**:
```
[2026-08-09T05:23:49.768Z] [INFO] [daemon:test-server] Agent Daemon starting (server=test-server, hub=http://localhost:3000/daemon)
[2026-08-09T05:23:49.779Z] [INFO] [daemon:test-server] connected to Hub at http://localhost:3000/daemon (server=test-server)
[2026-08-09T05:23:54.774Z] [DEBUG] [daemon:test-server] emit daemon:heartbeat {}
```

**Hub Logs** (`journalctl --user -u hub-api -n 50 --no-pager`):
```
Aug 09 05:23:49 ubuntu1 node[60679]: [Nest] 60679  - 08/09/2026, 5:23:49 AM     LOG [DaemonGateway] Daemon connected: server=5fdb871d-bfb7-4a3b-a74d-954703726a2e
```

**Health Check Output**:
```json
{"status":"ONLINE","lastHeartbeatAt":"2026-08-09T05:23:49.780Z"}
```
**Status**: ✅ PASS — Daemon connects, heartbeats, server status becomes ONLINE.

---

### 2. Task submission → daemon receives → status transitions to RUNNING
**Command**:
```bash
TASK_RESPONSE=$(curl -sS -X POST http://localhost:3000/tasks -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --data '{"serverId":"5fdb871d-bfb7-4a3b-a74d-954703726a2e","title":"Test task","command":"echo hello","workingDir":"/tmp","workerType":"CODEX","input":{"prompt":"test prompt"}}')
TASK_ID=$(echo $TASK_RESPONSE | jq -r '.id')
sleep 3
curl -sS -X GET http://localhost:3000/tasks/$TASK_ID -H "Authorization: Bearer $TOKEN"
```

**Daemon Logs**:
```
[2026-08-09T05:25:05.599Z] [INFO] [daemon:test-server] task:submit received (taskId=dfc8c300-9854-45aa-92bb-968619b75545)
[2026-08-09T05:25:05.600Z] [INFO] [daemon:test-server] [task:dfc8c300-9854-45aa-92bb-968619b75545] spawning via shell: echo "MOCK: 'test prompt'" && sleep 2 && echo "MOCK DONE"
[2026-08-09T05:25:05.604Z] [DEBUG] [daemon:test-server] emit task:statusUpdate {"taskId":"dfc8c300-9854-45aa-92bb-968619b75545","status":"RUNNING"}
[2026-08-09T05:25:05.606Z] [DEBUG] [daemon:test-server] emit task:log {"taskId":"dfc8c300-9854-45aa-92bb-968619b75545","chunk":"MOCK: 'test prompt'\n"}
[2026-08-09T05:25:07.607Z] [DEBUG] [daemon:test-server] emit task:log {"taskId":"dfc8c300-9854-45aa-92bb-968619b75545","chunk":"MOCK DONE\n"}
[2026-08-09T05:25:07.610Z] [DEBUG] [daemon:test-server] emit task:result {"taskId":"dfc8c300-9854-45aa-92bb-968619b75545","status":"COMPLETED","result":{"exitCode":0,"signal":null,"lastChunk":"MOCK DONE\n"}}
```

**Hub Response** (GET /tasks/:id):
```json
{"id":"dfc8c300-9854-45aa-92bb-968619b75545","status":"COMPLETED","input":{"prompt":"test prompt"},"result":{"signal":null,"exitCode":0,"lastChunk":"MOCK DONE\n"},"logs":"MOCK: 'test prompt'\nMOCK DONE\n",...}
```
**Status**: ✅ PASS — Task flows QUEUED → RUNNING → COMPLETED with logs and result.

---

### 3. Approval flow: daemon detects prompt → requests approval → Hub creates approval → user approves → daemon continues → task completes
**Command Sequence**:
1. Submit task with mock command that prints `(y/n)` prompt
2. Wait for `AWAITING_APPROVAL` status
3. List approvals to get `approvalId`
4. POST `/approvals/:approvalId/decision` with `{"approve":true}`
5. Verify task completes

**Daemon Logs** (key events):
```
[2026-08-09T05:34:33.774Z] [WARN] [daemon:test-server] [task:d98c4343-6a16-4b1d-8bfb-df9fac478cf9] approval prompt detected -> asking Hub. reason=MOCK: Starting task... Are you sure you want to continue? (y/n)
[2026-08-09T05:34:33.774Z] [DEBUG] [daemon:test-server] emit approval:request {"taskId":"d98c4343-6a16-4b1d-8bfb-df9fac478cf9","reason":"MOCK: Starting task... Are you sure you want to continue? (y/n)"}
... (after approval decision) ...
[2026-08-09T05:34:38.804Z] [INFO] [daemon:test-server] approval:decision received (taskId=d98c4343-6a16-4b1d-8bfb-df9fac478cf9, approved=true)
[2026-08-09T05:34:38.804Z] [INFO] [daemon:test-server] [task:d98c4343-6a16-4b1d-8bfb-df9fac478cf9] approved -> sending y to stdin
[2026-08-09T05:34:38.807Z] [DEBUG] [daemon:test-server] emit task:result {"taskId":"d98c4343-6a16-4b1d-8bfb-df9fac478cf9","status":"COMPLETED","result":{"exitCode":0,"signal":null,"lastChunk":"User answered: y\nMOCK DONE\n"}}
```

**Hub Task Status Progression**:
- `QUEUED` → `RUNNING` → `AWAITING_APPROVAL` → `COMPLETED`

**Status**: ✅ PASS — Full approval cycle works end-to-end.

---

### 4. Approval rejection: user rejects → daemon kills child → task CANCELLED
**Command**: POST `/approvals/:approvalId/decision` with `{"approve":false}`

**Daemon Logs**:
```
[2026-08-09T05:36:00.915Z] [INFO] [daemon:test-server] approval:decision received (taskId=33c1bca2-16ae-4f8e-ae2b-b2b01e04093d, approved=false)
[2026-08-09T05:36:00.915Z] [WARN] [daemon:test-server] [task:33c1bca2-16ae-4f8e-ae2b-b2b01e04093d] killing child (reason=rejected)
[2026-08-09T05:36:00.917Z] [INFO] [daemon:test-server] [task:33c1bca2-16ae-4f8e-ae2b-b2b01e04093d] child closed code=null signal=SIGTERM
```

**Hub Task Status**: `CANCELLED`
**Status**: ✅ PASS — Rejection kills child, task marked CANCELLED.

---

### 5. Task cancellation via POST /tasks/:id/cancel
**Command**: `curl -sS -X POST http://localhost:3000/tasks/$TASK_ID/cancel -H "Authorization: Bearer $TOKEN"`

**Daemon Logs**:
```
[2026-08-09T05:37:07.625Z] [WARN] [daemon:test-server] [task:7f29b25c-3f98-4383-9c6d-e8f250532abc] killing child (reason=cancel)
[2026-08-09T05:37:07.628Z] [INFO] [daemon:test-server] [task:7f29b25c-3f98-4383-9c6d-e8f250532abc] child closed code=null signal=SIGTERM
```

**Hub Task Status**: `CANCELLED`
**Status**: ✅ PASS — Cancel endpoint triggers daemon to kill child, task marked CANCELLED.

---

### Part 2 Summary
All integration test scenarios work fully:
| Scenario | Result |
|---|---|
| Daemon connects & heartbeats | ✅ |
| Server status ONLINE/OFFLINE | ✅ |
| Task submit → RUNNING → COMPLETED | ✅ |
| Approval request detection | ✅ |
| Approval approve → continue → COMPLETED | ✅ |
| Approval reject → kill → CANCELLED | ✅ |
| Task cancel → kill → CANCELLED | ✅ |
| Log streaming (task:log) | ✅ |
| WebSocket reconnection handling | ✅ (observed on daemon restart) |

---

## Issues Found (Non-Critical)

### Issue 1: Approval decision endpoint uses `approvalId` not `taskId`
**Expected**: Might be more intuitive to accept `taskId` directly since that's what the user has.
**Actual**: Must first GET `/approvals` to find the `approvalId` for the task, then POST to `/approvals/:approvalId/decision`.
**Severity**: Low — works as designed, just an extra API call.
**Repro**: Submit task → wait for approval → try POST `/approvals/:taskId/decision` → 404 "승인 요청을 찾을 수 없습니다."

### Issue 2: Approval DTO field name is `approve` (not `approved`)
**Expected**: Field name `approved` might be more natural.
**Actual**: Must send `{"approve": true}` not `{"approved": true}`.
**Severity**: Low — validation error message is clear: `"approve must be a boolean value"`.
**Repro**: POST `/approvals/:id/decision` with `{"approved": true}` → 400.

### Issue 3: No signup/registration endpoint in Hub API
**Observation**: Only seeded user exists; new users must be created via Prisma seed script or direct DB insert.
**Severity**: Medium — limits onboarding; should be documented or implemented.
**Note**: Not a bug per se, but a missing feature for production use.

---

## Evidence Summary

All commands executed against live Hub API at `http://localhost:3000` with real PostgreSQL/Redis backend and systemd-managed service. Agent Daemon runs as separate Node.js process connecting via Socket.io to `/daemon` namespace with API key authentication.

No source code modifications were made to either `hub-api` or `agent-daemon`. The copied `agent-daemon/` folder is committed to this branch for reproducibility.
