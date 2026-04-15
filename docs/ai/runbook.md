# Execution Runbook

This is the operating loop for the gstack multi-agent harness.
Follow this sequence. Skip steps only when time-boxed and documented why.

---

## Phase 1: Sprint Start


| Step | Skill           | What happens                                                                     | Your job                                                                                                |
| ---- | --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | `/office-hours` | Describe what you're building. It challenges premises and produces a design doc. | Answer the six forcing questions honestly.                                                              |
| 2    | `/autoplan`     | Runs CEO → design → eng review sequentially. Surfaces "taste decisions."         | Resolve taste decisions quickly — hackathon mode means bias toward action.                              |
| 3    | Review plan     | Read the output. Check that scope, architecture, and test matrix are locked.     | If anything is ambiguous, run the specific review skill (`/plan-ceo-review`, `/plan-eng-review`) again. |


**Exit criteria:** You have a reviewed plan with locked scope, architecture, and a prioritized slice list.

---

## Phase 2: Build Loop

Repeat for each vertical slice:


| Step | Skill               | When                                                                 |
| ---- | ------------------- | -------------------------------------------------------------------- |
| 1    | Implement           | Write code for the smallest slice from the plan.                     |
| 2    | `/review`           | When you feel "this should work."                                    |
| 3    | Deploy              | Push to a stable staging URL.                                        |
| 4    | `/qa <staging-url>` | After deploy. If auth is needed, run `/setup-browser-cookies` first. |
| 5    | Fix                 | Address demo-critical bugs from QA.                                  |
| 6    | `/review`           | After fixes, before moving to next slice.                            |


**Exit criteria per slice:** `/review` passes, `/qa` health score is acceptable, no demo-critical bugs remain.

---

## Phase 3: Pre-Merge (Demo-Critical)

Before merging anything that affects the demo path:


| Step | Skill        | Agent                                                                  |
| ---- | ------------ | ---------------------------------------------------------------------- |
| 1    | `/review`    | Lead (Cursor)                                                          |
| 2    | Codex review | Codex Adversary (separate CLI session)                                 |
| 3    | Compare      | Manually note overlap vs unique findings                               |
| 4    | `/qa <url>`  | QA Lead — after all fixes applied                                      |
| 5    | `/cso`       | Security Officer — if the feature touches auth, data, or external APIs |


**Exit criteria:** `/review` + Codex both pass. QA health score stable. No P1 security findings.

---

## Phase 4: Ship / Release


| Step | Skill                    | What happens                                                        |
| ---- | ------------------------ | ------------------------------------------------------------------- |
| 1    | `/ship`                  | Runs tests, creates PR.                                             |
| 2    | `/document-release`      | Updates README, CHANGELOG, ARCHITECTURE docs to match what shipped. |
| 3    | `/learn`                 | Capture learnings from this sprint.                                 |
| 4    | `scripts/ai/snapshot.sh` | Copy plan artefacts into `docs/ai/` for demo readiness.             |


**Exit criteria:** PR merged, docs updated, learnings captured, `docs/ai/` is demo-ready.

---

## Phase 5: Ongoing Maintenance


| Trigger                       | Skill                                                    |
| ----------------------------- | -------------------------------------------------------- |
| Weekly or end of sprint       | `/retro` — engineering retrospective with trend tracking |
| Before destructive operations | `/careful` or `/guard` — safety guardrails               |
| Context switch or break       | `/checkpoint` — save state for resume                    |
| "Didn't we fix this before?"  | `/learn` — search past learnings                         |
| Code quality check            | `/health` — composite quality score                      |


---

## Quick Reference: When to Call Which Subagent


| Situation                      | Subagent          | Skill                                    |
| ------------------------------ | ----------------- | ---------------------------------------- |
| "Is this scope right?"         | Scope Assassin    | `/plan-ceo-review`                       |
| "How should I architect this?" | Architecture Lock | `/plan-eng-review`                       |
| "Does this work?"              | QA Lead           | `/qa <url>`                              |
| "Is this secure?"              | Security Officer  | `/cso`                                   |
| "What did I miss?"             | Codex Adversary   | `/codex` or Codex CLI                    |
| "Ship it"                      | Lead              | `/ship` → `/document-release` → `/learn` |
