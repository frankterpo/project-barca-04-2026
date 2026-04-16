# Northflank + Omnigraph (reference deployment)

Run **Omnigraph** as a long-lived service on Northflank so the research agent (`scripts/research-agent.ts`) and the Next.js app can share one graph (internal URL + bearer token).

## 1. Omnigraph service

1. Create a **Service** (stateful) in your Northflank project.
2. **Image:** `ghcr.io/modernrelay/omnigraph-server:latest` (or build from [ModernRelay/omnigraph](https://github.com/ModernRelay/omnigraph); adjust tag to match your org).
3. **Command / args:** serve your compiled repo bundle, e.g. `omnigraph-server /data/repo.omni --bind 0.0.0.0:8080` (exact entrypoint depends on image).
4. **Persistent volume:** mount at `/data` (Lance / graph storage).
5. **Port:** `8080` (HTTP).
6. **Environment (server):**
   - `OMNIGRAPH_SERVER_BEARER_TOKEN` — long random string; same value as `OMNIGRAPH_BEARER_TOKEN` on clients.
7. **Internal DNS:** note the cluster URL (e.g. `http://omnigraph:8080`) for jobs that run in the same project.

**Bootstrap schema:** bake `graph/schema.pg` + `graph/queries.gq` into your image or init container, run `omnigraph init` once to produce `repo.omni` on the volume. For CI, copy the same files this repo uses under `graph/`.

See `omnigraph.docker-compose.yaml` for a local analogue of the same layout.

## 2. Research agent job

Create a **Job** that runs the TypeScript entrypoint:

- **Image:** your repo image with Node + `pnpm install` + `tsx`.
- **Command:** `pnpm exec tsx scripts/research-agent.ts` (or your wrapper).
- **Runtime environment** (inject per run or defaults on the job):

| Variable | Purpose |
|----------|---------|
| `CALA_API_KEY` | Cala API |
| `CALA_TEAM_ID` | Cala team |
| `OMNIGRAPH_URL` | Internal service URL from step 1 |
| `OMNIGRAPH_BEARER_TOKEN` | Same as server bearer |
| `CALA_ALLOW_SUBMIT` | `1` only when you want real leaderboard POSTs |

Trigger runs from CI or locally via `pnpm agent:run-remote` (`scripts/trigger-research-job.ts`).

## 3. Next.js (Vercel) → remote Omnigraph

Set `OMNIGRAPH_URL` to a **public or tailscale-reachable** Omnigraph endpoint if the dashboard should read the same graph. Prefer mTLS or IP allowlist + bearer token in production.
