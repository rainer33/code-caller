# phase3-commander (Codex가 지휘관 역할을 맡는 테스트)

당신은 이제 code-caller 프로젝트의 **Phase 3 지휘관**입니다. 지금까지 Claude가 지휘관 역할(설계, 작업 배분, 검토, 병합)을 해왔는데, 이번엔 당신이 그 역할을 맡아 진행하고 Claude는 최종 산출물만 검수합니다.

## 배경

- 저장소: `/Users/jahmin/orca/workspaces/code-caller` (GitHub: https://github.com/rainer33/code-caller, public)
- Phase 1(Hub API, `hub-api/`)과 Phase 2(Agent Daemon, `agent-daemon/`)는 완료되어 `main`에 있습니다.
- Hub API는 우분투 서버(`172.30.1.83`, 사용자 `jahmin`, 비밀번호 인증 — 이미 아시는 그대로)에 systemd 서비스로 상시 실행 중입니다. `DEPLOYMENT.md`에 운영 정보가 있습니다.
- 우분투 서버에는 `codex`, `opencode` CLI가 설치되어 있고, `~/awork/code-caller`, `~/awork/code-caller-dev`, `~/awork/code-caller-marketing`, `~/awork/code-caller-qa` 클론이 이미 있습니다 (필요하면 재사용하거나 새로 만드세요).

## Phase 3 목표

`claude-code-prompt.md`, `SRS-ai-commander.md`의 Phase 3 범위를 그대로 따릅니다: **React Native, Android 전용 빌드**로 아래 최소 화면 흐름을 만드는 것.

1. 로그인 (Hub API `/auth/login`)
2. 서버 목록 (`/servers`)
3. 작업 상태 화면 (`/tasks`, 실시간 갱신은 `/app` Socket.io 네임스페이스 — `hub-api/src/realtime/app.gateway.ts`, `events.ts` 참고)
4. 승인/거부 버튼 (`/approvals`)
5. 푸시 수신 (FCM — 실제 서비스 계정키는 없으니 토큰 등록 API 연동까지만 하고 실제 FCM 발송 테스트는 생략 가능, 문서에 한계로 남길 것)

## 지휘관으로서 해야 할 것

1. **먼저 `.claude/skills/design-first-scaffold/SKILL.md`를 읽고 그 워크플로우를 따르세요.** 설계 확정 → 단계별 구현 → 실제 검증 → 커밋 → 보고, 이 순서를 지킵니다.
2. 작업을 쪼개서 배분하세요 — 당신 스스로 할 수도 있고, 필요하면 우분투 서버의 opencode/codex 인스턴스에 SSH로 위임해도 됩니다 (오늘 Claude가 한 방식과 동일: 프롬프트 작성 → 실행 → 결과 확인 → 병합).
3. **재사용 가능한 프롬프트는 `ops/prompts/`에 파일로 저장**하고 즉흥적으로 다시 쓰지 마세요 (이 파일 자체가 그 컨벤션의 예시입니다).
4. **작업 진행상황은 표준 파일로 남기세요**: 각 하위 작업마다 `status.json`(`{"status": "running"|"success"|"failed", ...}`)과 완료 시 `.done` 파일을 만들어서, 누가 보든(당신 자신이든 Claude든 사람이든) 다시 물어보지 않고 파일만 보고 진행상황을 알 수 있게 하세요. 어떤 스키마를 썼는지 최종 보고에 적어주세요.
5. 새 브랜치(예: `feature/mobile-app`, 원하는 이름으로)에서 작업하고 커밋을 자주 남기세요. **`origin`에 push는 하지 마세요** — Claude가 검토 후 병합합니다.
6. **실제로 검증하세요** — 빌드가 되는지, 가능하면 에뮬레이터나 최소한 앱이 부팅해서 실제 Hub API(`http://172.30.1.83:3000`)에 로그인 요청을 보내고 응답을 받는지까지 확인하세요. 그냥 "될 것 같다"고 보고하지 마세요.
7. `hub-api/`, `agent-daemon/` 소스 코드는 건드리지 마세요 (Phase 3 범위만). 만약 API에 진짜 문제가 있어서 막히면, 조용히 고치지 말고 명확히 문서화하세요.

## 마지막에

- 최종 보고서를 작성하세요: 무엇을 만들었는지, 어떻게 검증했는지(증거 포함), 알려진 한계, status.json 스키마, 브랜치 이름.
- 보고 맨 마지막 줄에 `PHASE3_DONE`이라고 정확히 써주세요 (완료 감지용).
- 막혀서 못 끝내면 어디까지 됐는지와 왜 막혔는지를 최대한 자세히 남기고, 그 시점까지 커밋하세요.
