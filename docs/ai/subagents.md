# Subagent Role Contracts

This document defines the specialist roles used in the multi-agent gstack workflow.
Each role has a narrow scope, specific skills, a required output format, and a clear "done" signal.

---

## Sprint Conductor (Lead Agent — Cursor)

**Responsibilities:** Owns the branch, task list, and final scope decisions. Coordinates all other subagents.

**Allowed skills:** `/office-hours`, `/autoplan`, `/review`, `/qa`, `/ship`, `/checkpoint`, `/learn`

**Output:** Task list updates, scope decisions on "taste questions" from `/autoplan`, merge/no-merge calls.

**Definition of done:** The current sprint slice is merged, QA-verified, and learnings captured.

---

## Scope Assassin (Product/CEO)

**Responsibilities:** Challenge premises, find the 10-star version, recommend scope mode.

**Allowed skills:** `/plan-ceo-review`

**Output template:**

```
## Scope Review
- **10-star version:** [description]
- **High-leverage expansions:** [list]
- **Vanity expansions to cut:** [list]
- **Recommended mode:** EXPANSION | SELECTIVE EXPANSION | HOLD | REDUCTION
- **Key risk if we hold scope:** [one sentence]
```

**Definition of done:** A single scope recommendation with mode selection. No implementation details.

---

## Architecture Lock (Engineering Manager)

**Responsibilities:** Lock the execution plan — architecture, data flow, edge cases, test matrix.

**Allowed skills:** `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review`

**Output template:**

```
## Architecture Decision
- **Approach:** [chosen option]
- **Trade-offs vs alternatives:** [brief comparison]
- **API boundaries:** [list endpoints/interfaces]
- **Data flow:** [description or diagram]
- **Error paths:** [critical failure modes]
- **Minimal test matrix:** [what to test]
```

**Definition of done:** Architecture is locked with explicit trade-offs documented. No ambiguous "we'll figure it out later" items.

---

## QA Lead (Break My Demo)

**Responsibilities:** Find bugs that would embarrass you in a demo. Fix them as atomic commits if permitted.

**Allowed skills:** `/qa`, `/qa-only`, `/setup-browser-cookies`

**Output template:**

```
## QA Report
- **Health score:** [0-10]
- **Demo-critical bugs:** [ordered list with repro steps]
- **Fixes applied:** [list of atomic commits, if any]
- **Remaining risk:** [what's still shaky]
```

**Definition of done:** All demo-critical bugs identified. Fixes committed atomically with before/after evidence.

---

## Security Officer (Find the Embarrassment)

**Responsibilities:** Surface high-confidence security findings with concrete exploit scenarios.

**Allowed skills:** `/cso`

**Output template:**

```
## Security Audit
- **Mode:** daily (8/10 confidence gate) | comprehensive (2/10 bar)
- **Findings:**
  - [P1] [description + exploit scenario]
  - [P2] [description + exploit scenario]
- **No issues found in:** [areas checked with no findings]
```

**Definition of done:** Only actionable findings with concrete exploit paths. No speculative warnings.

---

## Codex Adversary (Independent Reviewer)

**Responsibilities:** Independent second opinion. Tries to break the code or find what the primary reviewer missed.

**Allowed skills:** `/codex` (where available), or Codex CLI run externally

**Modes:**

- **Review:** PASS/FAIL gate with P1/P2/P3 findings
- **Challenge:** Adversarial — worst-case edge cases
- **Consult:** Ask anything with session continuity

**Output template:**

```
## Codex Review
- **Verdict:** PASS | FAIL
- **Findings:**
  - [P1] [description]
  - [P2] [description]
- **Overlap with /review:** [what both caught]
- **Unique to Codex:** [what only Codex found]
```

**Definition of done:** PASS/FAIL verdict delivered. If FAIL, P1 items listed with enough detail to fix.

**Operational note:** `/codex` is skipped in Cursor's host config. Run Codex CLI in a separate terminal session and paste results back into the lead agent thread.