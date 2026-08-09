# AI 에이전트 지휘관 (Multi-AI Orchestration Hub)

Codex, Claude, Gemini 등 여러 AI 에이전트를 Ubuntu/Windows/macOS에 걸쳐 통합 관리하는 모바일 원격 지휘 서비스. 모바일 앱에서 각 서버의 AI 작업 상태를 실시간으로 모니터링하고, 민감한 작업은 승인/거부하며, 새 작업을 원격으로 지시한다.

전체 요구사항은 [`SRS-ai-commander.md`](./SRS-ai-commander.md), 초기 요청 배경은 [`claude-code-prompt.md`](./claude-code-prompt.md)를 참고.

## 진행 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | Hub API (NestJS) | ✅ 완료 |
| 2 | Agent Daemon (Ubuntu/Windows/macOS) | 예정 |
| 3 | React Native 앱 (Android) | 예정 |

## 아키텍처

```
[React Native 앱 (Android)]
   │ REST (로그인, 서버/작업 목록, 승인 결정 제출)
   │ WebSocket(/app ns, JWT) (실시간 상태 반영, 승인 대기 알림)
   ▼
[Hub API — NestJS] ── PostgreSQL(Prisma) / Redis+BullMQ
   modules: auth / servers / workers / tasks / approvals / notifications / realtime(gateway)
   │ REST (서버 등록/헬스체크/이력 조회, Daemon 최초 handshake)
   │ WebSocket(/daemon ns, API Key) (작업 지시·승인결정 push ↓ / 상태·로그·승인요청 push ↑)
   ▼
[Agent Daemon — Ubuntu/Windows/macOS 각 호스트]
   - Codex CLI를 child_process로 spawn, stdout/stderr 파싱
   - 민감 작업 감지 시 Hub에 승인 요청 후 진행 정지 (Hub 승인 완료 전까지 실행 안 함)
```

Hub↔모바일은 REST와 WebSocket을 병행하고(비실시간 CRUD는 REST, 실시간 상태/승인은 WebSocket), Hub↔Daemon도 동일한 원칙을 따른다. 설계 배경과 의사결정 근거는 `design-first-scaffold` 스킬(`.claude/skills/design-first-scaffold/SKILL.md`)에 정리되어 있다.

## 기술 스택

- **Hub API**: Node.js + NestJS(TypeScript), PostgreSQL + Prisma, Redis + BullMQ, Socket.io
- **Agent Daemon**: 경량 Node.js (Ubuntu/Windows/macOS 공통)
- **모바일 앱**: React Native (1단계 Android 전용)

## Hub API 실행 방법 (`hub-api/`)

### 1. 의존성 설치

```bash
cd hub-api
npm install
```

### 2. 로컬 인프라 기동

Docker를 쓸 수 있으면:

```bash
docker compose up -d
```

Docker가 없으면 Homebrew로 대체 가능:

```bash
brew install postgresql@14 redis
brew services start postgresql@14
redis-server --daemonize yes
createdb ai_commander
```

### 3. 환경 변수

```bash
cp .env.example .env
# DATABASE_URL, JWT 시크릿, PUSH_TOKEN_ENC_KEY(32바이트 hex: openssl rand -hex 32) 값을 채운다
```

### 4. 마이그레이션 + 초기 계정 생성

```bash
npx prisma migrate dev
SEED_USER_EMAIL=admin@example.com SEED_USER_PASSWORD=change-me npm run seed
```

### 5. 서버 실행

```bash
npm run start:dev
```

기본 포트는 `3000`. 로그인 → 서버 등록 → 작업 제출 → 승인까지 REST(`/auth`, `/servers`, `/tasks`, `/approvals`, `/notifications`)와 WebSocket(`/app`, `/daemon` 네임스페이스)으로 확인할 수 있다.

## API 요약

| 영역 | 엔드포인트 |
|---|---|
| 인증 | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` |
| 서버 | `GET/POST /servers`, `GET /servers/:id`, `GET /servers/:id/health`, `DELETE /servers/:id` |
| 작업 | `GET/POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/cancel` |
| 승인 | `GET /approvals?status=`, `POST /approvals/:id/decision` |
| 알림 | `POST /notifications/push-token` |

WebSocket 이벤트 계약 전체는 `.claude/skills/design-first-scaffold/SKILL.md`와 `hub-api/src/realtime/events.ts`를 참고.

## 보안

- Daemon↔Hub: Tailscale 프라이빗 네트워크 전제 + API Key(SHA-256 해시 저장)
- 모바일↔Hub: JWT access + refresh(회전, 서버 측 revoke 가능), 비밀번호는 bcrypt
- 푸시 토큰은 AES-256-GCM으로 암호화 저장
- 승인이 필요한 작업은 Hub의 승인 완료 응답 전까지 Daemon이 실행하지 않음
