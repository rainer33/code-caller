# phase3b-task-dispatch (모바일에서 새 작업 생성)

`mobile-app/`(Phase 3, `main`에 병합됨)에는 로그인/서버 목록/작업 조회/승인만 있고
**새 작업을 생성해서 특정 서버에 디스패치하는 화면이 없습니다.** 프로젝트의 핵심
목표는 "안드로이드 폰 화면에서 맥북(또는 다른 서버)의 Codex에게 작업을 시키는 것"이므로
이 화면이 반드시 필요합니다.

## 배경 확인 (실제로 동작 검증된 것들)

- Hub API `POST /tasks` — body `{ serverId, workerType: "CODEX"|"CLAUDE"|"GEMINI", input: { prompt } }` — 이미 존재하고 동작 확인됨.
- 이 맥북 자체가 `MacBook-Local`이라는 이름으로 Hub에 Server로 등록되어 있고, `agent-daemon`이 launchd(`~/Library/LaunchAgents/com.codecaller.agent-daemon.plist`)로 상시 실행 중이며 로컬 `codex` CLI를 구동합니다. 방금 실제 태스크(`pwd` 출력)를 던져서 9초 만에 COMPLETED로 끝나는 것까지 확인했습니다.
- `agent-daemon/src/runner.js`에 최근 버그 수정 커밋(`9ea13ff`)이 있습니다: `codex exec`은 stdin을 EOF까지 읽으려 하므로 spawn 직후 stdin을 닫아야 함. 참고만 하고 이 파일은 건드리지 마세요 (범위 밖).

## 이번 작업 범위

1. **`.claude/skills/design-first-scaffold/SKILL.md`를 먼저 읽고** 그 워크플로우(설계 확정 → 구현 → 실제 검증 → 커밋 → 보고)를 따르세요.
2. 새 브랜치(예: `feature/mobile-task-dispatch`)에서 작업하세요. `hub-api/`, `agent-daemon/` 소스는 건드리지 마세요.
3. `mobile-app/`에 "새 작업" 화면/모달을 추가하세요:
   - 서버 목록에서 대상 서버 선택 (`GET /servers`, 특히 `MacBook-Local`이 보여야 함)
   - workerType 선택 (기본값 `CODEX`)
   - 프롬프트 텍스트 입력
   - 제출 시 `POST /tasks`, 성공하면 작업 목록 화면으로 돌아가서 새 태스크가 보이는지 확인
4. **실제로 검증하세요**: 배포된 Hub(`http://172.30.1.83:3000`, 계정 정보는 이미 아시는 대로)에 대해 앱 코드 레벨에서 실제 fetch 호출까지 확인하고, 가능하면 이번에 등록된 `MacBook-Local` 서버로 실제 태스크를 하나 만들어서 COMPLETED까지 도는 것을 `GET /tasks/:id`로 확인하세요. Android 빌드도 다시 통과하는지 확인하세요.
5. `ops/phase3b/`에 동일한 규칙으로 `status.json`/`.done`을 남기고, 마지막에 `ops/phase3b/final-report.md`를 쓰고 맨 마지막 줄에 정확히 `PHASE3B_DONE`이라고 쓰세요.
6. `origin`에 push하지 마세요. 커밋은 자주 남기세요.
7. 민감정보(API 키, 비밀번호)는 코드/커밋/문서 어디에도 쓰지 마세요.

막히면 왜 막혔는지 최대한 구체적으로 남기고 그 지점까지 커밋하세요.
