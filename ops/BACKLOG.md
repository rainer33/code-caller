# Code Caller Backlog

이 파일은 code-caller 프로젝트의 살아있는 작업 목록이다. **누가 다음에 무엇을 해야 하는지**를 여기서 결정한다 — Claude에게 다시 묻지 않아도 되도록, `ops/prompts/codex-standing-commander.md`가 매 실행마다 이 파일을 읽고 가장 우선순위 높은 미완료 항목을 스스로 골라 진행한다.

`[화면]` 표시가 붙은 항목은 모바일 앱 UI/UX 작업이다 — 사용자가 Codex 데스크톱 앱으로 이 저장소를 직접 열어 화면을 보면서 실시간으로 지시하는 방식으로 진행하며, 헤드리스 자동 실행(launchd)은 이 항목들을 절대 스스로 고르지 않는다. 2026-08-09부터 사용자가 "화면 수정 개선이 최우선 목표"라고 재확정했으므로, 실시간 대화 세션에서는 `[화면]` 항목이 백엔드/인프라 항목보다 우선한다. 배경은 `ops/HANDOFF.md` 참고.

형식: 각 항목은 `[ ]`(미완료)/`[x]`(완료) 체크박스, 우선순위(P0가 가장 높음), 한 줄 설명. 완료 시 체크만 하지 말고 관련 커밋 해시를 옆에 남긴다. 완료된 항목은 지우지 말고 아래로 내려서 이력으로 남긴다.

## ⚠️ 사람 확인 필요

- 2026-08-30 10:09 KST 헤드리스 실행 기준, `[화면]` 표시가 없는 미완료 백로그 항목이 없다. 헤드리스 규칙상 아래의 화면/UX 항목은 사용자가 Codex 데스크톱 앱에서 직접 지시할 때까지 선택하면 안 되므로, 자동 실행은 새 비화면 백엔드/인프라/운영 작업이 추가되기 전까지 구현 작업을 진행하지 않는다. 다음 조치는 사용자가 화면 작업을 대화형으로 지시하거나, 새 비화면 항목을 이 백로그에 추가하는 것이다.

## 진행 중 / 대기 (우선순위 순)

- [ ] `[화면]` P0 — **모바일 앱 화면 수정 개선 최우선 루프**: 사용자가 Codex 데스크톱 앱에서 실제 화면을 보며 지시하는 UI/UX 개선 작업을 최우선으로 처리한다. 이 작업은 Claude Code에서 지시하기 어렵기 때문에 앞으로 사용자와 Codex가 직접 진행한다. 구현 전 `mobile-app/App.tsx`, `ops/phase3/design/mobile-app-design.md`, `ops/phase3b/design/mobile-task-dispatch-design.md`를 확인하고, 구현 후 Android release build로 검증한다.
- [ ] `[화면]` P1 — **New Task 음성 입력**: Android/iPhone 모두를 고려해 마이크 권한과 음성 인식 라이브러리를 선택한다. 음성은 곧바로 실행하지 않고 editable prompt에 반영하며, 사용자가 확인 후 작업 실행 버튼을 누르게 한다.
- [ ] `[화면]` P1 — **iPhone 지원 준비**: React Native iOS 빌드, Safe Area, APNs/Firebase 설정, 네트워크 권한, iOS 배포/실기기 테스트 경로를 정리한다.
- [ ] `[화면]` P2 — **모바일 앱 폴리시**: 작업 취소 버튼, 로그 tail 실시간 스트리밍 뷰, FCM 실제 전송 테스트(Firebase 서비스 계정 키가 준비되면), 에러 상태 UX 개선. `[화면]` 항목이므로 헤드리스 자동 실행이 아니라 사용자가 Codex 데스크톱 앱에서 직접 화면 보며 지시할 때 진행한다.

## 완료 (이력)

- [x] Phase 1 — Hub API (NestJS+Prisma+Socket.io) 스캐폴딩 및 우분투 배포 — `main`
- [x] Phase 2 — Agent Daemon (Codex spawn+파싱) — `main`
- [x] `GET /tasks/:id`에서 `server.apiKeyHash` 노출되던 취약점 수정 — `c09337c`
- [x] Phase 3 — 안드로이드 모바일 앱 (로그인/서버/작업/승인/FCM 등록) — Codex가 지휘, Claude가 최종 검수 — `c7f2b4e`
- [x] `agent-daemon`이 `codex exec` 스폰 시 stdin에서 영원히 멈추는 데드락 수정 — `9ea13ff`
- [x] 이 맥북을 Hub에 `MacBook-Local` Server로 등록 + `agent-daemon` launchd 상시 서비스화, 실제 태스크 디스패치 종단 검증
- [x] Phase 3B — 모바일 앱에 "새 작업 생성/디스패치" 화면 추가 — `219aab7`, 라이브 검증 `1af0718`
- [x] 릴리즈 APK가 Hub(평문 HTTP)에 접속 못 하던 cleartext 차단 문제 수정 (`network_security_config.xml`) — `5532e0c`
- [x] **목표 달성 확인**: 사용자가 실제 폰에서 release APK로 로그인 → New Task 탭 → 맥북 Codex에게 실제 프롬프트 전송 → COMPLETED 응답 수신까지 실기기 검증 완료 (2026-08-09)
- [x] "문서화배포"를 로컬 Codex에게 위임 (Notion Apps 커넥터 활용, Claude 개입 불필요)
- [x] Obsidian `Code-Caller` 폴더를 `code-caller-worklog`(private) 저장소로 GitHub 동기화, "문서화배포"에 sync 포함
- [x] `[화면]` P0 — **Tasks 상세 화면 + 긴 로그/결과 UX**: Tasks 목록 요약화, 상세 화면, 프롬프트/결과/로그 내부 스크롤, 결과 우선 배치 — `71b42d4`, `dacb921`
- [x] P0 — **승인 기반 서버 등록 플로우**: `npm run register` daemon CLI, Hub 등록 요청/승인 API, 모바일 승인 카드, 1회 credential 전달 — `d5e1865`
- [x] P0 — **Worker provider/profile/capability 구조화 1차**: 서버별 `WorkerProfile` 모델과 Codex/Claude Code/Antigravity/OpenCode provider 기반 확장 토대 추가 — `d5e1865`
- [x] `[화면]` P0 — **New Task 목표-first UX 1차**: 프롬프트를 첫 단계로 이동하고 실행 대상 요약/서버/worker 선택 순서로 재배치 — `d5e1865`
- [x] P1 — **우분투 워커 도그푸딩**: `Ubuntu-Codex`를 승인 기반 등록 플로우로 Hub에 편입하고 `code-caller-agent-daemon.service` systemd user service로 상시 실행. Hub `/daemon` 연결 확인: `e1f1370a-7059-428f-be39-fcfb97d01303` — 2026-08-09
- [x] P0 — **용량 기반 자동 failover 시스템 1차**: `WorkerProfile` 기반 선호 워커 체인과 디스패치 실패 시 같은 소유자의 온라인 호환 워커로 즉시 폴백하는 Hub 토대 추가 — `d0fb67b`
- [x] P0 — **용량 기반 자동 failover 시스템 2차 / RUNNING watchdog**: `TaskAttempt` 이력, stale `RUNNING` watchdog, 타임아웃 서버 후보 제외, 재큐잉/반복 실패 처리 추가 — `c03fe11`
- [x] P1 — **Daemon 용량 소진 구조화 실패 사유**: daemon이 capacity/quota/rate-limit 실패를 `CAPACITY_EXHAUSTED`로 구조화해 보고하고, Hub가 해당 서버를 제외해 즉시 다음 compatible worker로 재큐잉하는 경로 추가 — `6fe93db`
- [x] P1 — **원본 4트랙 프롬프트 버전관리**: 2026-08-09 초기에 우분투 4개 워커(deploy/dev/marketing/QA)에게 즉흥적으로 줬던 프롬프트들을 저장소의 durable branch/artifact 증거 기준으로 재사용 가능하게 `ops/prompts/four-track-*.md`에 정리 — `2e38ca0`
- [x] P2 — **QA 회귀 테스트**: Phase 3/3b, 맥북 daemon 등록, network security 픽스 이후로 Hub build, daemon mock integration, mobile typecheck, Android release build를 재검증하고 `BUGS.md`를 갱신. Live Hub reachability 실패는 P1 후속으로 분리 — `93b89a1`
- [x] P1 — **배포 Hub API reachability 복구**: Hub 서비스가 `100.92.64.11:3000`에서 401 reachability 신호를 반환함을 확인하고, 모바일 앱 REST/Socket.io가 `172.30.1.83` 실패 시 직접 Tailscale 주소로 폴백하도록 복구. 현재 Mac의 `172.30.1.83` timeout은 LAN/subnet-route 문제로 `BUGS.md`에 기록 — `c187fd5`
- [x] P3 — **마케팅 후속**: `MARKETING.md` 초안 이후 실제 커뮤니티 포스팅 여부를 저장소/원격 브랜치/공개 웹 검색으로 감사. 게시 증거와 외부 반응이 없어 `MARKETING.md`에 2026-08-18 감사 결과를 남김 — `e5a9f2b`
