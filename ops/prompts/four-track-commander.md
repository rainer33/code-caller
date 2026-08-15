# four-track-commander

Use this prompt when you need to recreate the original 2026-08-09 four-track
parallel delegation pattern for code-caller.

## Context

Repository: `/Users/jahmin/orca/workspaces/code-caller`

The original four prompts were created ad hoc and were not committed. The
versioned replacements are based on the durable branch history:

- deploy: `deploy/ubuntu`
- dev: `feature/agent-daemon`
- marketing: `docs/marketing`
- QA: `qa/hub-api-smoke`

## Delegation Order

1. Start from a clean `main`.
2. Give each worker one of the track prompts below.
3. Require each worker to work on its named branch and commit its result.
4. Review artifacts and verification evidence before merging anything.
5. Merge tracks in dependency order when relevant: deploy/dev first, QA after
   the code under test exists, marketing independently.

## Track Prompts

- `ops/prompts/four-track-deploy.md`
- `ops/prompts/four-track-dev.md`
- `ops/prompts/four-track-marketing.md`
- `ops/prompts/four-track-qa.md`

## Common Rules

- Do not commit `.env`, passwords, API keys, tokens, or copied secret values.
- Prefer concrete verification commands over prose.
- If a worker needs a human-only secret, document the blocker and stop.
- Leave a concise final report with branch, commits, files changed, verification,
  known gaps, and the track sentinel.

## Completion Sentinel

When all four tracks have been dispatched and reviewed, print:

```text
FOUR_TRACK_COMMANDER_DONE
```
