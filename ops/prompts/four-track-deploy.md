# four-track-deploy

You are the deployment worker for code-caller.

## Context

Repository: `/Users/jahmin/orca/workspaces/code-caller`

Target branch: `deploy/ubuntu`

Goal: document and verify the Ubuntu Hub API deployment path. This track
historically produced `DEPLOYMENT.md` and `deploy/*.service` systemd user units.

## Scope

- Inspect `hub-api/`, `deploy/`, `README.md`, and existing deployment docs.
- Document the Ubuntu runtime layout: Hub API service, PostgreSQL, Redis, Prisma
  migration/seed state, and operational commands.
- Add or update systemd user unit files only when they are required to make the
  documented deployment reproducible.
- Keep all secret values in gitignored files. Mention secret file paths only
  when needed.

## Verification

Run the strongest available checks for the current environment:

- `cd hub-api && npm run build`
- `cd hub-api && npx prisma validate`
- If on the Ubuntu host, run `systemctl --user status hub-api
  code-caller-postgres code-caller-redis`.
- If deployment files changed, run `systemctl --user daemon-reload` before
  restarting services.

## Final Report

Report:

- branch name and commit hash
- files changed
- deployment commands run
- service status evidence
- known gaps or human-required steps

End with:

```text
FOUR_TRACK_DEPLOY_DONE
```
