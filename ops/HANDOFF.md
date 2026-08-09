# Claude → Codex 위임 현황판

이 파일은 "클로드에게 위임받은 일이 있냐?"라는 질문에 대한 정답이다.
사용자가 이렇게 물으면 이 파일 전체를 정확하게 보고할 것 — 요약하다가
빠뜨리지 말 것.

## 왜 이 위임이 생겼나

2026-08-09까지 Claude(Anthropic)가 이 프로젝트의 지휘관 역할(설계 확정,
작업 배분, 검토, 병합, 배포 판단)을 맡아왔다. 그런데 이 프로젝트의 다음
단계 작업은 대부분 **모바일 앱 화면(UI) 수정**이고, 사용자는 화면을 직접
보면서 실시간으로 수정 지시를 내리고 싶어한다. Codex는 데스크톱 앱으로
이 저장소를 로컬에서 열어 사용자와 그렇게 상호작용할 수 있지만 Claude는
그 워크플로우에 맞지 않는다. 그래서 2026-08-09에 **일상적인 개발/배포/검토
업무 전체를 Codex에게 위임**했고, Claude는 더 이상 이 프로젝트의 기본
작업 루프에 관여하지 않는다.

## 위임된 것 (전체 범위)

1. **상시 지휘관 역할** — 설계, 구현, 실제 검증, 커밋, `main` 병합/푸시까지
   전부. 규칙은 `AGENTS.md`와 `ops/prompts/codex-standing-commander.md`에
   있다.
2. **화면(UI) 수정 작업 전체** — 앞으로 가장 자주 오는 요청 형태. 사용자가
   Codex 데스크톱 앱에서 직접 화면을 보며 지시하면, Codex가 구현·빌드
   검증·병합·푸시까지 스스로 끝낸다. Claude는 이 루프에 없다. 2026-08-09에
   사용자가 "Claude Code에서는 화면 수정사항을 지시하기 쉽지 않으니,
   지금부터 화면수정 개선이 최우선 목표"라고 재확정했다. 따라서 화면 수정은
   사용자와 Codex가 직접 진행하는 최우선 작업이다.
3. **작업일지 자동화** ("문서화배포") — Notion "Code Caller 개발일지"
   시리즈 + Obsidian(`code-caller-worklog` private repo) 동기화.
   `ops/prompts/worklog-publish.md`. 이건 2026-08-09 중반에 이미 Codex에게
   위임됐었고, 이번 전체 위임에도 그대로 포함된다.
4. **백엔드/인프라 성격 후속 작업** — `ops/BACKLOG.md`에 우선순위와 함께
   정리돼 있다. launchd가 하루 한 번
   (`~/Library/LaunchAgents/com.codecaller.codex-commander.plist`)
   `codex-standing-commander.md`를 자동 실행해서, 화면 작업이 아닌
   백엔드 항목을 사람 개입 없이 스스로 골라 진행한다.

## 지금까지 실제로 만들어진 것 (Claude가 지휘하던 동안, 2026-08-09까지)

- Phase 1 — Hub API (NestJS+Prisma+Socket.io), 우분투 배포
- Phase 2 — Agent Daemon (Codex CLI spawn/파싱)
- Phase 3 — 안드로이드 모바일 앱 (로그인/서버/작업/승인/FCM 등록) — 이때부터
  이미 Codex가 지휘, Claude는 검수만 함 (실전 테스트였음)
- Phase 3B — 모바일 앱에 "새 작업 생성/디스패치" 화면 추가
- 이 맥북을 Hub에 `MacBook-Local` Server로 등록, `agent-daemon`을 launchd
  상시 서비스로 설치 — 실제로 폰 → Hub → 맥북 Codex 작업 디스패치가
  종단으로 동작하는 것까지 사용자가 실기기에서 직접 확인함 (2026-08-09)
- 버그 두 건 발견/수정: `codex exec` stdin 데드락, 릴리즈 APK cleartext
  차단 (`network_security_config.xml`)
- 목표 달성: "폰 화면에서 맥북 Codex에게 작업을 지시한다"는 이 프로젝트의
  핵심 시나리오가 실제로 동작함

세부 커밋 이력과 미완료 항목 우선순위는 `ops/BACKLOG.md`, 설계 근거는
`ops/phase3/design/`와 `ops/phase3b/design/`에 있다.

## 지금부터 (2026-08-09 이후)

- 화면 수정 요청 → 최우선. Codex가 직접 사용자와 대화하며 처리 (`AGENTS.md`의
  "화면 수정 요청을 받았을 때" 섹션 참고). 이 루프는 사용자와 Codex 중심으로
  진행하고, Claude는 명시적으로 다시 부르기 전까지 관여하지 않는다.
- 백엔드/인프라 작업 → `ops/BACKLOG.md` 우선순위대로 헤드리스 자동 실행
  또는 사용자가 직접 요청
- Claude는 사용자가 명시적으로 다시 부르기 전까지 이 프로젝트의 일상
  작업에 관여하지 않는다
