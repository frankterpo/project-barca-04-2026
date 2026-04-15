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

**Live submission (autonomous runner):** `scripts/autonomous-runner.ts` can call Cala’s submit API when not in dry-run and `allocCount >= 50`. That path is gated: your run’s `return_pct` must **strictly beat** the current leaderboard #1 (max return on the board), and you must set **`CALA_ALLOW_SUBMIT=1`** in `.env` only after explicit operator approval. Without it, the runner logs and skips submit.

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

