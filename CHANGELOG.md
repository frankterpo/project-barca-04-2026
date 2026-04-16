# Changelog

## [0.1.1] - 2026-04-16

### Added

- Northflank operator docs and `scripts/trigger-research-job.ts` with `pnpm agent:run-remote`
- `lib/graph/omnigraph-run-data.ts` and API routes preferring Omnigraph with JSON fallback
- Supabase migrations and API routes for prices and runs; Cala portfolio math and ticker universe helpers
- Graph queries extensions in `graph/queries.gq`

### Changed

- Research agent, price harvester, Judge Mode, and trading dashboard consolidated flows
- Docs: `docs/OPERATOR.md`, `.env.example` Northflank and Omnigraph variables

## [Unreleased]

### Cala / Convex

- Leaderboard: `GET /api/leaderboard` and `pnpm tsx scripts/price-harvester.ts --leaderboard` use the same Convex `submissions:leaderboard` query path. Override the deployment with `CALA_CONVEX_QUERY_URL`, or derive from `CALA_SUBMIT_URL` / `CALA_LEADERBOARD_URL` (`.convex.site` → `.convex.cloud`). See `.env.example` and `docs/OPERATOR.md`.

When you ship a version, add `## [x.y.z] - YYYY-MM-DD` above this section and move finished items out of Unreleased.
