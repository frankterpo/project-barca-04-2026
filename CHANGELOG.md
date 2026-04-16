# Changelog

## [Unreleased]

### Cala / Convex

- Leaderboard: `GET /api/leaderboard` and `pnpm tsx scripts/price-harvester.ts --leaderboard` use the same Convex `submissions:leaderboard` query path. Override the deployment with `CALA_CONVEX_QUERY_URL`, or derive from `CALA_SUBMIT_URL` / `CALA_LEADERBOARD_URL` (`.convex.site` → `.convex.cloud`). See `.env.example` and `docs/OPERATOR.md`.

When you ship a version, add `## [x.y.z] - YYYY-MM-DD` above this section and move finished items out of Unreleased.
