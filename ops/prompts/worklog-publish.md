# worklog-publish (Codex, 로컬 macOS 실행용)

"문서화" 또는 "문서화배포" 트리거를 받았을 때 이 프롬프트로 로컬 `codex exec`를 실행한다. 사용자와 Codex가 직접 진행한 대화형 화면 작업은 매 대화 종료마다 문서화하지 않는다. 어느 정도 작업이 누적된 뒤 사용자가 "문서화"라고 말하면, 마지막 작업일지 이후의 미문서화 작업을 한꺼번에 정리한다:

```bash
codex exec --skip-git-repo-check -C /Users/jahmin/orca/workspaces/code-caller - < ops/prompts/worklog-publish.md
```

---

당신은 code-caller 프로젝트의 작업일지 담당입니다. 저장소는 `/Users/jahmin/orca/workspaces/code-caller` (GitHub: https://github.com/rainer33/code-caller).

## 할 일

1. `git log --since="<마지막 작업일지 이후>" --oneline --all`로 그 사이 무슨 커밋이 있었는지 확인하고, 필요하면 `git log -p`나 최근 커밋 메시지로 내용을 파악한다. 마지막 작업일지 날짜를 모르면 Notion의 "Code Caller 개발일지" 페이지(아래 parent id) 하위 페이지 목록에서 가장 최근 날짜를 확인한다.
2. 오늘 날짜(`YYYY-MM-DD`, Asia/Seoul 기준)로 작업일지 항목을 작성한다. 형식은 기존 항목들과 동일하게: 오늘 한 일 / 트랙별 상태 표(있으면) / 발견된 이슈 / 다음 할 일.
3. **Notion**: parent page id `3b7b1ca1-fdde-8159-9691-ffebbfd0c9e2` ("Code Caller 개발일지") 아래에 제목 `YYYY-MM-DD - <핵심 요약>`으로 새 하위 페이지를 만든다. 이미 그날짜 페이지가 있으면 내용을 추가/갱신한다.
4. **Obsidian**: `/Users/jahmin/Downloads/openai-export-data/LLM-Wiki-Vault/40_Content/Code-Caller/YYYY-MM-DD.md`에 같은 내용을 마크다운으로 쓴다 (파일 맨 위에 Notion 페이지 URL과 GitHub 저장소 URL을 링크로 남긴다).
5. 그 Obsidian 폴더에서 git add/commit/push 한다 (`origin` = `https://github.com/rainer33/code-caller-worklog`, private repo). 커밋 메시지: `worklog: YYYY-MM-DD`.
6. 마지막으로 무엇을 올렸는지 간단히 보고한다 (Notion URL, 커밋 해시).

## 하지 말 것

- code-caller 저장소의 소스 코드는 건드리지 않는다 (읽기만).
- 비밀번호/토큰/API 키 등 민감정보는 Notion이나 Obsidian에 절대 쓰지 않는다.
