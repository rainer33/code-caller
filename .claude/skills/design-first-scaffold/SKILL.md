---
name: design-first-scaffold
description: Design-before-code workflow for building a new backend service (or a new phase of one) from spec/requirement documents. Use when the user provides SRS/PRD-style docs and asks to design first before writing code, when architecture-critical decisions in the spec are ambiguous or explicitly marked "미결정/TBD", or when scaffolding a new NestJS-style multi-module service (REST + realtime + queue) from scratch. Also covers the specific pattern used to avoid circular module dependencies between realtime gateways and domain services.
---

# Design-First Scaffold

Codifies the workflow used to design and build the AI 에이전트 지휘관 (Multi-AI Orchestration Hub) Hub API: read specs fully, resolve ambiguous architecture decisions with the user before writing a design doc, get the design approved, then implement phase-by-phase with real end-to-end verification and a report/pause gate between phases.

## When to use

- The user hands you spec docs (SRS, PRD, a request/prompt file) and says "design first, review it" before coding.
- A spec has an explicit open-questions / 미결정 section that affects architecture, not just detail.
- You're scaffolding a new service from zero — especially a NestJS-style backend combining REST, a realtime channel (WebSocket/Socket.io), and a job queue (BullMQ) — where module wiring choices made on day one are expensive to undo later.
- You're starting a new phase of a project that already has an approved design doc from a prior phase.

## Workflow

1. **Read every provided doc in full before responding.** Don't start designing from a partial read — architecture-relevant constraints are often buried mid-document (NFRs, data model drafts, an "open questions" section at the end).

2. **Find the decisions that are actually architecture-critical**, not just any unresolved detail. A spec's "미결정 사항 / TBD" section usually mixes business questions (pricing model) with technical ones that determine module boundaries (e.g. "how does the daemon talk to the hub — polling or push?"). Only the latter block design; note the former and move on.

3. **Resolve each architecture-critical unknown with the user before designing around it** — don't silently pick one and present it as fact:
   - Use `AskUserQuestion` with a **Recommended** default and a one-line tradeoff (technical difficulty vs. maintainability) per option, not just labels.
   - If the user's answer references something ambiguous (e.g. "can we just use websocket?" without saying for which leg of the system), **ask a follow-up before assuming** — a single question can span two unrelated layers of the architecture, and guessing wrong here is expensive to unwind after code exists.
   - When you have a genuine recommendation, say it plainly with reasoning, then let the user confirm — don't hide behind "either could work."

4. **Enter Plan Mode (`EnterPlanMode`) for any non-trivial scaffold.** Skip it only for a single obvious file change. Write the plan file with, in this order:
   - **Context**: why this design is being made now, and what was already decided in conversation (so the doc stands alone).
   - **Confirmed decisions**, each with the one-line reason a future reader needs to not re-litigate it.
   - **Architecture diagram** (ASCII is fine) showing every hop and which protocol/auth mechanism each hop uses.
   - **Module/component breakdown** — one paragraph per module, naming what it owns.
   - **Data model** — concrete field lists, not just entity names; call out fields added beyond what the spec drafted, with why (e.g. a refresh-token table the spec's data model didn't mention but FR-1.3 logout-invalidation requires it).
   - **State machines** for anything with a lifecycle (task status, approval status).
   - **Communication contracts** — every REST route and every socket event, both directions.
   - **Explicitly flagged unverified assumptions** — anything the design depends on that you could not confirm (e.g. "assumes the CLI takes y/n on stdin for approval prompts"). Never bury these; a reviewer needs to see them without hunting.
   - **Phased roadmap** matching however the user asked to sequence delivery, plus a **verification** section describing how each phase will actually be exercised (not just "tests pass").
   - Call `ExitPlanMode` only once the plan file is complete — don't ask "does this look okay?" in prose first.

5. **Implement phase by phase after approval.** Track modules/components with `TaskCreate`/`TaskUpdate` so progress is visible. Build common/shared infrastructure (DB client wrapper, auth guards) before the domain modules that depend on it.

6. **Verify end-to-end for real before calling a phase done** — a green `build`/`tsc` is necessary, not sufficient:
   - Stand up real local infra (Postgres/Redis via Docker or Homebrew if Docker isn't available in the sandbox) rather than mocking it away.
   - Boot the app and exercise the actual golden path with real requests (curl for REST; a small throwaway `socket.io-client` script for WebSocket flows) — confirm the state machine actually transitions the way the design says (e.g. a task genuinely stays `QUEUED` when its target daemon isn't connected, rather than silently marking itself `RUNNING`).
   - Fix anything the live run surfaces (e.g. an internal relation leaking into a socket payload) before moving on.

7. **Commit at the end of each phase, then stop and report before starting the next one.** The report is: what was built (by module), what was verified and how, and known gaps/open assumptions carried forward — then wait for the user before starting the next phase. Don't chain straight into the next phase just because auto-mode says "keep going"; a phase boundary in a durable, user-specified roadmap is exactly the kind of decision point worth pausing at.

## Reference pattern: decoupling realtime gateways from domain modules

When a NestJS service has both realtime gateways (e.g. a `/daemon` and an `/app` Socket.io namespace) and domain modules (tasks, approvals) that need to (a) push outbound events through the gateway and (b) react to inbound events the gateway receives, a naive design creates an import cycle: `domain → realtime → domain`.

Fix: keep the realtime module one-directional.
- The gateway never imports domain modules. On each inbound socket event, it emits a **process-local** event via `@nestjs/event-emitter`'s `EventEmitter2` (e.g. `daemon.task.status`) and returns.
- Domain modules import the realtime module only to call a thin outbound facade (`RealtimeService.dispatchToServer(...)`, `RealtimeService.notifyUser(...)`), and separately register `@OnEvent(...)` listeners for the inbound events they care about.
- Result: `domain → realtime` is the only edge; there is no cycle, and no `forwardRef` gymnastics are needed.

See `hub-api/src/realtime/` (`events.ts`, `daemon.gateway.ts`, `app.gateway.ts`, `realtime.service.ts`) and the `@OnEvent` handlers in `hub-api/src/tasks/tasks.service.ts` / `hub-api/src/approvals/approvals.service.ts` for the concrete implementation.

## Anti-patterns

- Picking an architecture-critical answer yourself and presenting it as settled, when the spec marked it as an open question.
- Treating "the build passed" as verification for a realtime/stateful flow — build success does not confirm a WebSocket event actually reaches the right room, or that a state machine transition is gated correctly.
- Letting a gateway class inject domain services directly "just for now" — the cycle it creates gets harder to unwind the more handlers accumulate on it.
- Auto-advancing to the next phase of a roadmap the user explicitly asked to gate on a per-phase report — finishing a phase is a decision point, not a checkpoint to blow through.
