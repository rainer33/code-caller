# 프로젝트: AI 에이전트 지휘관 (Multi-AI Orchestration Hub)

## 프로젝트 개요

Codex, Claude, Gemini 세 가지 AI를 여러 서버(Ubuntu, Windows)에 걸쳐 통합 관리하는 모바일 원격 지휘 서비스를 만든다. 사용자는 모바일 앱에서 각 서버에서 실행 중인 AI 에이전트 작업 상태를 실시간으로 모니터링하고, 승인/거부하며, 새 작업을 지시할 수 있다.

이미 검증된 실사용 환경: Tailscale로 연결된 Ubuntu 서버 + Windows 서버 + MacBook(제어용이자 서버 호스트로도 사용 가능)에서 Codex가 뉴스 수집, GitHub 배포, Notion 배포, Obsidian 배포 등 일일 자동화 파이프라인을 실행 중이며, 이를 여러 사용자를 위한 상용 서비스로 확장하려는 것이 목표다.

## 기술 스택 (확정)

- **백엔드**: Node.js + NestJS (TypeScript)
- **DB**: PostgreSQL + Prisma ORM
- **캐시/큐**: Redis + BullMQ
- **실시간 통신**: Socket.io (NestJS WebSocket Gateway)
- **모바일 앱**: React Native, 1단계는 **Android 전용**으로 빌드/테스트 (iOS 대응 코드는 배제하지 않되 우선순위 아님)
- **서버 에이전트**: 각 호스트(Ubuntu/Windows/macOS)에 설치되는 경량 Node.js 데몬
- **추후 확장**: 관리자용 웹 대시보드 (React 기반, Hub API를 그대로 재사용) — 2단계 이후 고려, 지금 구조 설계 시 API가 웹 클라이언트도 무리 없이 지원하도록 REST 우선으로 설계할 것

## 아키텍처

```
[React Native 모바일 앱]
        │  (REST + WebSocket, JWT 인증, FCM 푸시)
        ▼
[Hub API — NestJS]
  modules/
    auth/           사용자 인증, JWT 발급
    servers/        등록된 서버(Ubuntu/Windows) 관리, 헬스체크
    workers/         AI 어댑터 — codex / claude / gemini 공통 인터페이스
    tasks/          작업 큐(BullMQ), 상태 추적
    approvals/       승인/거부 플로우, 승인 대기열
    notifications/   FCM 푸시 발송
        │  (Tailscale 프라이빗 네트워크 + API 키 인증)
        ▼
[Agent Daemon — 각 서버에 설치]
  - 로컬 Codex/Claude 프로세스 감시
  - 상태/로그/diff를 Hub API로 보고
  - Hub API로부터 승인된 명령 수신 후 실행
```

## AI 워커 공통 인터페이스

모든 AI 어댑터(Codex, Claude, Gemini)는 다음 인터페이스를 구현한다:

```typescript
interface AIWorkerAdapter {
  submitTask(task: TaskRequest): Promise<TaskHandle>;
  getStatus(handle: TaskHandle): Promise<TaskStatus>;
  getResult(handle: TaskHandle): Promise<TaskResult>;
  cancelTask(handle: TaskHandle): Promise<void>;
}
```

라우팅 로직(어떤 워커에 작업을 배분할지)은 초기엔 규칙 기반(작업 태그: code/review/multimodal/longcontext)으로 시작하고, MVP 이후 고도화한다.

## MVP 범위 (1단계에서 이것만 구현)

1. `auth` — 기본 이메일/비밀번호 로그인, JWT
2. `servers` — 서버 등록(이름, OS 타입: Ubuntu/Windows/macOS, Tailscale IP, API 키), 헬스체크
3. `workers` — Codex 어댑터 하나만 (실제 실행 중인 파이프라인과 연동)
4. `tasks` + `approvals` — 작업 상태 조회, 승인/거부 플로우
5. `notifications` — 승인 대기 시 FCM 푸시
6. React Native 앱 (Android 전용 빌드) — 로그인, 서버 목록, 작업 상태 화면, 승인/거부 버튼, 푸시 수신

Claude, Gemini 어댑터와 자동 라우팅은 2단계로 미룬다.

## 보안 요구사항

- 서버(Agent Daemon) ↔ Hub API: Tailscale 프라이빗 네트워크 전제 + API 키 인증. 퍼블릭 인터넷에 Hub API를 노출할 경우 반드시 별도 인증 계층 추가
- 모바일 앱 ↔ Hub API: JWT + refresh token, 푸시 토큰은 사용자별로 안전하게 저장
- 승인이 필요한 작업(파일 삭제, 배포, 외부 API 호출 등)은 Agent Daemon이 즉시 실행하지 않고 반드시 Hub API의 승인 완료 응답을 받은 후에만 실행

## 요청 사항

1. 먼저 위 MVP 범위를 바탕으로 NestJS 프로젝트 구조를 스캐폴딩할 것 (모듈, Prisma 스키마, 기본 라우트)
2. Agent Daemon은 별도 경량 Node.js 프로젝트로 분리해서 구성할 것 (Ubuntu/Windows/macOS 세 환경 모두에서 동작해야 함)
3. React Native 앱은 Android 빌드로 로그인 → 서버 목록 → 작업 상태 → 승인/거부 흐름이 되는 최소 화면부터 만들 것
4. 각 단계마다 실행 가능한 상태로 커밋하고, 다음 단계로 넘어가기 전에 무엇을 만들었는지 요약해서 보고할 것
5. 기술적으로 애매한 결정(예: React Native vs Flutter가 실제로 맞는지, FCM vs 다른 푸시 서비스)이 있으면 진행 전에 먼저 질문할 것
