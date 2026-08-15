# Four-Track Prompt Versioning

## Context

On 2026-08-09 the project used four Ubuntu-side worker tracks for parallel
work: deployment, daemon development, marketing, and QA. The original prompts
were written in a session scratchpad and were not committed. The durable source
evidence that remains in this repository is the branch and artifact history:

- `deploy/ubuntu` -> `c022c33` (`DEPLOYMENT.md`, `deploy/*.service`)
- `feature/agent-daemon` -> `84d0b0f` (`agent-daemon/dev-scripts/*`)
- `docs/marketing` -> `37a64fd` (`MARKETING.md`)
- `qa/hub-api-smoke` -> `6143ea7` (`BUGS.md`, `agent-daemon/*`)

This slice does not claim to reconstruct lost scratchpad text verbatim. It
versions reusable prompts that preserve the intent, constraints, branch names,
verification expectations, and deliverables proven by those artifacts.

## Confirmed Decisions

- Store reusable prompts under `ops/prompts/`; this follows the standing
  commander convention and keeps future delegation text reviewable.
- Keep each track as a separate prompt; the four tracks map to different
  ownership boundaries and verification methods.
- Include branch names and expected final sentinels in each prompt; future
  command runners can detect completion without reading the whole log.
- Keep secrets out of prompts; deployment and QA prompts point to existing
  gitignored secret locations instead of embedding values.

## Track Map

```text
Commander
  |
  +-- deploy/ubuntu        -> Ubuntu Hub deployment docs and systemd units
  +-- feature/agent-daemon -> daemon local mock harness and development checks
  +-- docs/marketing       -> Korean positioning and launch-copy draft
  +-- qa/hub-api-smoke     -> black-box Hub API and daemon integration report
```

## Prompt Files

- `ops/prompts/four-track-deploy.md`
- `ops/prompts/four-track-dev.md`
- `ops/prompts/four-track-marketing.md`
- `ops/prompts/four-track-qa.md`
- `ops/prompts/four-track-commander.md`

## Verification

This is documentation work, so verification is repository-level:

- Confirm all prompt files exist under `ops/prompts/`.
- Confirm each prompt references its track branch and expected deliverables.
- Search the new prompt files for obvious secret terms and committed credential
  values.
- Commit, merge to `main`, push, then mark the backlog item with the merge
  commit.
