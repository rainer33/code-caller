# 소프트웨어 요구사항 명세서 (SRS)
## AI 에이전트 지휘관 (Multi-AI Orchestration Hub)

문서 버전: 0.1 (초안)
작성일: 2026-08-09

---

## 1. 개요

### 1.1 목적
본 문서는 여러 AI 에이전트(Codex, Claude, Gemini)를 여러 서버(Ubuntu, Windows, macOS)에 걸쳐 통합 관리하는 모바일 원격 지휘 서비스의 요구사항을 정의한다.

### 1.2 범위
- 사용자는 모바일 앱(Android, 1단계)에서 여러 서버에 등록된 AI 에이전트의 작업 상태를 실시간으로 모니터링한다.
- 승인이 필요한 작업(파일 삭제, 배포, 외부 API 호출 등)을 원격에서 승인/거부한다.
- 새 작업을 AI 워커(Codex/Claude/Gemini)에 지시한다.
- 향후 관리자 웹 대시보드로 확장한다.

### 1.3 용어 정의
| 용어 | 정의 |
|---|---|
| Hub API | 중앙 오케스트레이션 서버 (NestJS) |
| Agent Daemon | 각 호스트(서버)에 설치되어 로컬 AI 프로세스를 감시/제어하는 경량 프로세스 |
| AI Worker | Codex, Claude, Gemini 등 실제 작업을 수행하는 AI 엔진 |
| Task | AI Worker에게 위임되는 작업 단위 |
| Approval | 실행 전 사용자 승인이 필요한 Task의 상태 |

### 1.4 이해관계자
- 서비스 운영자(개발자 본인) — 1인 개발/운영, 초기 사용자 겸 관리자
- 최종 사용자 — 멀티 서버·멀티 AI 파이프라인을 운용하는 개발자/소규모 팀 (서비스화 이후)

---

## 2. 전체 설명

### 2.1 제품 관점
독립형 신규 서비스. 기존에 사용자가 개별적으로 운용 중인 Codex 자동화 파이프라인(뉴스 수집, GitHub/Notion/Obsidian 배포)을 감싸는 관제탑 역할을 한다. 개별 AI 제공사의 자체 원격 제어 기능(Claude Code Remote Control, Codex 모바일)과 달리, 이종 AI를 하나의 승인/모니터링 흐름으로 통합하는 것이 핵심 차별점이다.

### 2.2 사용 환경
- 서버: Ubuntu, Windows, macOS (Tailscale 프라이빗 네트워크로 상호 연결)
- 모바일: Android (1단계). iOS는 후순위.
- 향후: 관리자 웹 대시보드 (브라우저)

### 2.3 사용자 특성
- 기술 숙련도가 높은 개발자/1인 운영자를 1차 타깃으로 가정
- 여러 AI 구독(Codex, Claude Pro, Gemini Plus)을 동시에 보유하고 멀티 서버 환경을 운용하는 사용자

### 2.4 제약사항
- 서버-Hub 간 통신은 Tailscale 프라이빗 네트워크를 전제로 설계 (퍼블릭 노출 시 별도 보안계층 필요)
- 모바일 1단계는 Android 전용 (iOS 미지원)
- 백엔드는 Node.js/NestJS로 확정, 개발은 Claude Code로 진행

---

## 3. 시스템 아키텍처 개요

```
[Android 앱 (React Native)]
        │  REST + WebSocket (JWT 인증, FCM 푸시)
        ▼
[Hub API — NestJS]
  ├─ auth            사용자 인증/JWT
  ├─ servers         서버 등록(Ubuntu/Windows/macOS), 헬스체크
  ├─ workers          AI 어댑터 (Codex/Claude/Gemini 공통 인터페이스)
  ├─ tasks           작업 큐(BullMQ)/상태 추적
  ├─ approvals        승인/거부 플로우
  └─ notifications     FCM 푸시 발송
        │  Tailscale 프라이빗 네트워크 + API 키 인증
        ▼
[Agent Daemon — Ubuntu / Windows / macOS 각 호스트]
  - 로컬 Codex/Claude 프로세스 감시
  - 상태/로그/diff 보고
  - 승인된 명령만 실행

(향후) [관리자 웹 대시보드] → 동일 Hub API(REST) 재사용
```

기술 스택: Node.js + NestJS / PostgreSQL + Prisma / Redis + BullMQ / Socket.io / React Native(Android)

---

## 4. 기능 요구사항

### FR-1. 사용자 인증
- FR-1.1 이메일/비밀번호로 로그인한다.
- FR-1.2 JWT 액세스 토큰 및 refresh 토큰을 발급한다.
- FR-1.3 로그아웃 시 토큰을 무효화한다.

### FR-2. 서버 관리
- FR-2.1 사용자는 서버(이름, OS 타입: Ubuntu/Windows/macOS, Tailscale IP, API 키)를 등록할 수 있다.
- FR-2.2 등록된 서버 목록과 각 서버의 온라인/오프라인 상태(헬스체크)를 조회할 수 있다.
- FR-2.3 서버를 삭제/비활성화할 수 있다.

### FR-3. AI 워커 관리
- FR-3.1 시스템은 Codex, Claude, Gemini에 대해 공통 인터페이스(`submitTask`, `getStatus`, `getResult`, `cancelTask`)를 제공하는 어댑터를 갖는다.
- FR-3.2 1단계는 Codex 어댑터만 구현하며, Claude/Gemini는 2단계에서 추가한다.
- FR-3.3 (2단계) 작업 태그(code/review/multimodal/longcontext)에 따라 적절한 워커로 자동 라우팅한다.

### FR-4. 작업(Task) 관리
- FR-4.1 사용자는 모바일 앱에서 새 작업을 특정 서버/워커에 지시할 수 있다.
- FR-4.2 작업 상태(대기/실행중/승인대기/완료/실패/취소)를 실시간으로 조회할 수 있다.
- FR-4.3 작업 결과(로그, diff, 출력)를 모바일에서 열람할 수 있다.
- FR-4.4 작업을 취소할 수 있다.

### FR-5. 승인(Approval) 플로우
- FR-5.1 Agent Daemon이 민감 작업(파일 삭제, 배포, 외부 API 호출 등)을 감지하면 즉시 실행하지 않고 Hub API에 승인 요청을 보낸다.
- FR-5.2 Hub API는 해당 작업을 "승인대기" 상태로 전환하고 사용자에게 푸시 알림을 보낸다.
- FR-5.3 사용자는 모바일 앱에서 승인/거부를 선택할 수 있다.
- FR-5.4 승인된 경우에만 Agent Daemon이 작업을 실행한다.
- FR-5.5 거부된 경우 작업은 "취소" 상태로 전환되고 이유를 기록할 수 있다.

### FR-6. 알림
- FR-6.1 승인 대기, 작업 완료, 작업 실패 시 FCM 푸시 알림을 발송한다.

### FR-7. (2단계) 관리자 웹 대시보드
- FR-7.1 브라우저에서 서버/작업/승인 현황을 조회한다.
- FR-7.2 모바일 앱과 동일한 Hub API(REST)를 재사용한다.

---

## 5. 비기능 요구사항

### NFR-1. 보안
- NFR-1.1 서버(Agent Daemon)-Hub API 간 통신은 Tailscale 프라이빗 네트워크 + API 키로 인증한다.
- NFR-1.2 모바일-Hub API 간 통신은 JWT + refresh token으로 인증하며, 모든 통신은 TLS를 적용한다.
- NFR-1.3 민감 작업은 승인 완료 전까지 Agent Daemon에서 실행되지 않는다 (FR-5 참조).
- NFR-1.4 푸시 토큰 등 사용자별 민감 정보는 암호화 저장한다.

### NFR-2. 성능
- NFR-2.1 승인 요청 발생 시 5초 이내에 푸시 알림이 사용자에게 도달하는 것을 목표로 한다.
- NFR-2.2 작업 상태 변경은 WebSocket을 통해 지연 없이(1초 이내) 클라이언트에 반영한다.

### NFR-3. 가용성
- NFR-3.1 Agent Daemon은 Hub API와의 연결이 끊겨도 로컬 작업 실행 상태를 유지하고, 재연결 시 상태를 동기화한다.
- NFR-3.2 Hub API 장애 시 승인 대기 중인 작업은 안전하게(자동 실행되지 않고) 대기 상태를 유지한다.

### NFR-4. 확장성
- NFR-4.1 AI 워커 어댑터는 신규 AI 추가 시 공통 인터페이스 구현만으로 확장 가능해야 한다.
- NFR-4.2 Hub API는 모바일 앱 외에 향후 웹 대시보드 클라이언트도 동일하게 지원할 수 있도록 REST 우선으로 설계한다.

### NFR-5. 이식성
- NFR-5.1 Agent Daemon은 Ubuntu, Windows, macOS 세 환경에서 동일하게 동작해야 한다.

### NFR-6. 유지보수성
- NFR-6.1 NestJS 모듈 구조를 따르며, 각 도메인(auth/servers/workers/tasks/approvals/notifications)을 독립 모듈로 분리한다.

---

## 6. 데이터 모델 (초안)

| 엔티티 | 주요 속성 |
|---|---|
| User | id, email, passwordHash, createdAt |
| Server | id, ownerId, name, osType(Ubuntu/Windows/macOS), tailscaleIp, apiKeyHash, status |
| Task | id, serverId, workerType(codex/claude/gemini), status, input, result, createdAt |
| Approval | id, taskId, status(pending/approved/rejected), requestedAt, decidedAt, reason |
| PushToken | id, userId, token, platform |

---

## 7. 향후 과제 (Out of Scope for MVP)
- Claude/Gemini 어댑터 구현 및 자동 라우팅
- 관리자 웹 대시보드
- iOS 앱
- 멀티테넌시/과금 모델 (서버 개수당 과금 vs 구독제 등 결정 필요)
- Agent Daemon 자동 업데이트 배포 체계

---

## 8. 미결정 사항 (확인 필요)
- 과금 모델 (SaaS 멀티테넌트 vs 셀프호스팅+유료지원)
- 승인 알림의 응답 SLA (몇 분 내 미응답 시 자동 거부할지 여부)
- Agent Daemon과 로컬 Codex/Claude CLI 간 정확한 연동 방식(파일시스템 감시 vs 프로세스 후킹 vs 로그 파싱)
