# AGENTS.md — code-caller

이 저장소를 여는 모든 에이전트(Codex CLI, Codex 데스크톱 앱 포함)를 위한
공통 지침이다.

## 이 프로젝트

"AI 에이전트 지휘관" (code-caller) — 모바일 앱으로 여러 서버에서 도는
AI 코딩 에이전트(Codex 등) 작업을 모니터링/승인/지시하는 Multi-AI
Orchestration Hub. 구성:

- `hub-api/` — NestJS + Prisma + Socket.io 백엔드. 우분투(`172.30.1.83`)에
  systemd `--user` 서비스로 배포됨.
- `agent-daemon/` — 각 워커 호스트(맥북 포함)에서 도는 경량 데몬. Hub의
  `/daemon` 소켓에 붙어서 로컬 `codex` CLI를 스폰/제어한다. 이 맥북에는
  `MacBook-Local`이라는 이름으로 launchd 상시 서비스로 이미 떠 있다
  (`~/Library/LaunchAgents/com.codecaller.agent-daemon.plist`).
- `mobile-app/` — 안드로이드 React Native 클라이언트. 로그인, 서버 목록,
  새 작업 생성/디스패치(`New Task` 탭), 작업 상태, 승인/거부.

## 만약 사용자가 "클로드에게 위임받은 일이 있냐, 보고해" 라고 물으면

**`ops/HANDOFF.md`를 읽고 그 내용을 정확하게 보고하라.** 요약하거나
생략하지 말고, 그 파일이 곧 정답이다. 필요하면 `ops/BACKLOG.md`와
`git log --oneline -20`으로 최신 상태를 보강해서 답하라.

## 일반 작업 규칙

- 설계 확정 → 구현 → 실제 검증(빌드/테스트/실제 API 호출) → 커밋 → 보고
  순서를 따른다 (`.claude/skills/design-first-scaffold/SKILL.md` 참고,
  Claude Code 전용 스킬 포맷이지만 워크플로우 자체는 그대로 적용 가능).
- 재사용 가능한 지시/프롬프트는 `ops/prompts/`에 파일로 저장한다.
- 진행상황은 `ops/<phase>/status/<subtask>/status.json` (+성공 시 `.done`)
  관례를 따른다. 스키마: `ops/phase3/status/schema.md`.
- 비밀번호/토큰/API 키 등 민감정보는 코드/커밋/Notion/Obsidian 어디에도
  쓰지 않는다. `.env`류는 절대 커밋하지 않는다.
- Hub API: `http://172.30.1.83:3000`. 관리자 계정은 이미 아는 대로.

## 화면(모바일 앱 UI) 수정 요청을 받았을 때

이게 앞으로 이 프로젝트에서 가장 자주 오는 요청 형태다. 사용자가 직접
화면을 보면서(Codex 데스크톱 앱으로) 구체적인 수정을 요청한다. 이 경우:

1. `mobile-app/App.tsx` 및 `ops/phase3/design/mobile-app-design.md`,
   `ops/phase3b/design/mobile-task-dispatch-design.md`로 현재 화면 구조를
   먼저 파악한다.
2. 요청받은 수정을 구현한다.
3. **실제로 빌드해서 검증한다** (`cd mobile-app/android &&
   ANDROID_HOME=$HOME/.local/share/android-sdk
   ANDROID_SDK_ROOT=$HOME/.local/share/android-sdk ./gradlew assembleRelease`).
   릴리즈 APK는 `usesCleartextTraffic=false`라서 Hub 접속에
   `network_security_config.xml`이 필요하다는 것을 기억할 것 (한 번 이 문제로
   막혔던 적 있음, `AndroidManifest.xml`의 `networkSecurityConfig` 참조 유지).
4. 커밋하고, 검증됐으면 `main`에 직접 병합/푸시한다 (더 이상 Claude가
   리뷰하지 않는다 — 당신이 최종 검수자다).
5. `ops/HANDOFF.md`와 `ops/BACKLOG.md`를 갱신한다.
6. 애매한 UX/디자인 판단이 필요하면 추측하지 말고 사용자에게 직접 물어라
   (당신은 지금 사용자와 실시간으로 대화하는 상황이므로 이게 자연스럽다 —
   헤드리스 자동 실행 때와 다르게 여기서는 되묻는 게 맞다).

## 자동/헤드리스 실행 (사람 개입 없이 도는 경우)

launchd가 하루 한 번 `ops/prompts/codex-standing-commander.md`를 실행한다
(`~/Library/LaunchAgents/com.codecaller.codex-commander.plist`). 이건
백엔드/인프라 성격 작업(`ops/BACKLOG.md`의 화면 관련 아님 표시 항목)만
스스로 판단해서 진행하고, 화면/UX 관련 항목은 건드리지 않는다 (그건
사용자가 직접 지시할 때까지 대기).
