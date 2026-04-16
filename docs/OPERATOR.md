# Lobster IC — operator quick start

Target **TTHW**: clone → running UI with mock committee in a few minutes.

## 1) Install

- Node 20+
- `npm i -g pnpm` (if you don’t have pnpm)

```bash
pnpm install
```

## 2) Environment

```bash
cp .env.example .env
```

For the scaffold, you only need `APP_URL` (optional). Real keys land in M2–M4 sections when those modules ship.

**Cala (M2):** set `CALA_API_KEY` and `CALA_TEAM_ID` in `.env`. Both are required — the HTTP client (`lib/cala/client.ts`) fails fast on startup without them. `CALA_BASE_URL` is optional (defaults to `https://api.cala.ai`).

**Leaderboard URL:** Scripts try, in order: `CALA_LEADERBOARD_URL` (if you set only a site root, the same host’s `/api/leaderboard` is tried next), `{origin}/api/leaderboard` from `CALA_SUBMIT_URL`, each URL in `CALA_LEADERBOARD_URLS`, then the default Convex deployment. The response must be JSON: a **non-empty array** of rows (with `return_pct` and/or `total_value`, etc.). If you get HTML or 404, ask the operator for the JSON endpoint and set `CALA_LEADERBOARD_URL`, or add fallbacks in `CALA_LEADERBOARD_URLS`. Verify with `pnpm tsx scripts/price-harvester.ts --leaderboard` (prints which URL worked).

**Convex query URL (app dashboard):** `GET /api/leaderboard` in the Next app calls Convex `POST …/api/query` with path `submissions:leaderboard`. Override with `CALA_CONVEX_QUERY_URL` if the deployment changes; otherwise it is derived from `CALA_SUBMIT_URL` (same deployment slug, `.convex.site` → `.convex.cloud`).

**Harvest throughput:** `scripts/price-harvester.ts` orders unknown tickers so **liquid / priority** names fill the first slots in each batch; micro-caps and lottery names follow. Bad symbols from API errors are stripped and batches refilled using the same ordering.

**Price DB = live submit cache (not a quote API):** Each `--harvest` batch POSTs a dummy equal-weight portfolio; the JSON response includes `purchase_prices_apr15` and `eval_prices_today`. Those values are written to `data/price-db.json`. There is no separate “historical quote” endpoint in this flow—**replay vs live** means: stale `price-db.json` reflects an older mark; re-run `--harvest` before `--optimize` if `CALA_PRICE_DB_WARN_STALE_HOURS` warns (default 48h, set `0` to disable).

**Universe quality:** The raw `ALL_TICKERS` list is filtered to **1–5 letter** symbols (drops obvious OTC/long tickers) before harvesting. Optional: `CALA_EXTRA_TICKERS`, `CALA_HARVEST_CANDIDATE_FILES` (JSON `{ "tickers": [...] }`), and by default **`data/research-harvest-candidates.json`** from `scripts/research-agent.ts` is merged when present (`CALA_MERGE_RESEARCH_CANDIDATES=0` to skip). **`CALA_HARVEST_MAX_BATCHES`** caps how many 50-stock waves run (probe mode).

**Live submission:** Portfolio POSTs from `scripts/price-harvester.ts --optimize` (without `--dry-run`) and from `scripts/autonomous-runner.ts` require **`CALA_ALLOW_SUBMIT=1`** when you intentionally want real submits. The autonomous runner also only submits when the scored return beats leaderboard #1; without `CALA_ALLOW_SUBMIT=1` it logs and skips.

**Iteration (Cala / gstack-style):** After each competitor round run `pnpm tsc --noEmit` and `pnpm lint` and fix regressions. For larger design changes, capture decisions in a short `PLAN.md` (or Cursor plan mode) and run `/gstack-plan-eng-review` on it; optional `/review` or `/gstack-review` on the diff before merge.

API routes available after startup:


| Route                   | Method     | Purpose                           |
| ----------------------- | ---------- | --------------------------------- |
| `/api/cala/search`      | POST / GET | Knowledge search (GET uses `?q=`) |
| `/api/cala/query`       | POST       | Structured dot-notation query     |
| `/api/cala/entity/[id]` | GET / POST | Full entity profile by UUID       |


The team-id helper in `lib/cala/team-id.ts` (`requireCalaTeamId`, `withCalaTeamId`) injects `team_id` into every POST body automatically — do not hardcode team ids in source.

**Omnigraph (M3):** Omnigraph is an open-source context graph ([omnigraph.dev](https://omnigraph.dev)). Install the CLI (`brew install ModernRelay/tap/omnigraph` or `curl -fsSL https://raw.githubusercontent.com/ModernRelay/omnigraph/main/scripts/install.sh | bash`), then initialize and start the server:

```bash
omnigraph init --schema graph/schema.pg ./repo.omni
omnigraph-server ./repo.omni --bind 0.0.0.0:8080
```

Set `OMNIGRAPH_URL` in `.env` if the server is not at the default `http://127.0.0.1:8080`. For remote/shared deployments, set `OMNIGRAPH_BEARER_TOKEN` (maps to `OMNIGRAPH_SERVER_BEARER_TOKEN` on the server side). The schema lives in `graph/schema.pg` and queries in `graph/queries.gq`.

Graph API routes:

| Route               | Method | Purpose                                  |
| ------------------- | ------ | ---------------------------------------- |
| `/api/graph/health` | GET    | Checks if omnigraph-server is reachable  |
| `/api/graph/read`   | POST   | Execute a named read query               |
| `/api/graph/change` | POST   | Execute a named mutation (insert/update) |

Request body for read/change: `{ "query": "<name>", "params": { ... }, "branch": "main" }`.

**Northflank (M4):** set `NORTHFLANK_API_KEY` in `.env`. The key authenticates against the Northflank v1 API (`https://api.northflank.com`). Jobs must already exist on Northflank — the client triggers runs, polls status, and lists history.

**Omnigraph on Northflank:** see `northflank/README.md` for a service + job layout (persistent volume, `OMNIGRAPH_SERVER_BEARER_TOKEN`, internal URL). Trigger the packaged research agent with `pnpm agent:run-remote` after setting `NORTHFLANK_PROJECT_ID` and `NORTHFLANK_RESEARCH_JOB_ID`.

Compute API routes:

| Route                 | Method | Purpose                                 |
| --------------------- | ------ | --------------------------------------- |
| `/api/compute/run`    | POST   | Start a new job run                     |
| `/api/compute/status` | GET    | Get run detail (`?projectId&jobId&runId`) |
| `/api/compute/runs`   | GET    | List runs for a job (`?projectId&jobId`)  |

POST `/api/compute/run` body: `{ "projectId": "...", "jobId": "...", "runtimeEnvironment": { ... } }`.

## 3) Seed mock JSON

```bash
pnpm run demo:seed
```

Writes `data/runs/demo-v1/summary.json` and `data/runs/demo-v1/decisions/*.json` (gitignored).

## 4) Run the app

```bash
pnpm dev
```

Open `/portfolio`, click a holding, use **Judge Mode** for preset cross-exam.

## 5) Verify API stubs (optional)

- `GET /api/runs` — run summary
- `GET /api/companies/AAPL` — committee decision JSON
- `GET /api/judge-mode?ticker=AAPL&presetId=1` — cached judge answer

## Troubleshooting

- `**ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` / `"#"` isn’t supported**: run a bare `pnpm install` (no extra arguments after it). If you pasted `pnpm install   # if needed`, most shells ignore the comment; if install still fails, enable the pinned version with `corepack enable` then `corepack use pnpm@10.33.0` (or `npm i -g pnpm@latest`) and retry. Check `package.json` for no dependency version set to `"#"` or other junk.
- **Empty portfolio**: run `pnpm run demo:seed` then refresh.
- **Wrong run id**: set `LOBSTER_DEFAULT_RUN_ID` / `NEXT_PUBLIC_LOBSTER_DEFAULT_RUN_ID` to match the folder under `data/runs/`.

