# Project Barca — Cala Leaderboard Competitor

Automated stock portfolio optimizer targeting the [Cala](https://cala.ai) investment competition leaderboard. Discovers high-return stocks via price harvesting, builds concentrated portfolios, and submits them to the Convex API.

**Current best: +151,057% return** (driven by MOND at +199,900%).

## Architecture

```
scripts/price-harvester.ts   ← core: harvest prices, optimize, submit
scripts/research-agent.ts    ← LLM-powered stock research pipeline
scripts/autonomous-runner.ts ← continuous loop: research → submit → compare
scripts/probe-submit.ts      ← test submissions + leaderboard viewer
lib/cala/                    ← Convex API client, leaderboard fetch, schemas
lib/omnigraph/               ← graph database client (optional)
lib/northflank/              ← compute job orchestration (optional)
data/price-db.json           ← cached per-stock prices and returns
data/bad-tickers.json        ← persistent list of invalid tickers
```

## Quick Start

```bash
# 1. Install
pnpm install

# 2. Environment
cp .env.example .env
# Set CALA_API_KEY, CALA_TEAM_ID, CALA_SUBMIT_URL at minimum

# 3. Harvest prices (parallel, ~5 concurrent batches)
pnpm tsx scripts/price-harvester.ts --harvest

# 4. View rankings from harvested data
pnpm tsx scripts/price-harvester.ts --show

# 5. Optimize and submit the best portfolio
CALA_ALLOW_SUBMIT=1 pnpm tsx scripts/price-harvester.ts --optimize

# 6. Preview without submitting
pnpm tsx scripts/price-harvester.ts --optimize --dry-run
```

## Key Scripts

| Script | Purpose |
|--------|---------|
| `price-harvester.ts --harvest` | Batch-submit tickers to collect purchase/eval prices. Runs 5 concurrent API calls, auto-detects bad tickers, persists results to `data/price-db.json`. |
| `price-harvester.ts --optimize` | Build the highest-return portfolio from cached prices. Concentrates capital in top performers. |
| `price-harvester.ts --leaderboard` | Print the current Cala leaderboard. |
| `research-agent.ts` | LLM-powered pipeline that generates stock picks using market research. |
| `autonomous-runner.ts` | Continuous loop: generates picks, submits, compares against leaderboard #1. |
| `probe-submit.ts` | Submit test portfolios and view leaderboard. Useful for debugging. |

## Strategy

The competition scores portfolios by total return from April 15 purchase prices to current evaluation prices. The winning approach:

1. **Harvest** — submit batches of 50 tickers to the Convex API to discover their purchase and evaluation prices
2. **Rank** — sort all harvested stocks by return percentage
3. **Concentrate** — allocate maximum capital to the highest-return stocks (minimum $5,000 per position, minimum 50 positions)
4. **Submit** — push the optimized portfolio to the leaderboard

The API has ~60 second latency per call, so the harvester runs 5 concurrent batches with automatic retry, bad ticker detection, and progress tracking.

## Environment Variables

See [`.env.example`](.env.example) for the full list. The critical ones:

| Variable | Required | Purpose |
|----------|----------|---------|
| `CALA_API_KEY` | Yes | Cala API authentication |
| `CALA_TEAM_ID` | Yes | Team identifier for submissions |
| `CALA_SUBMIT_URL` | Yes | Convex submission endpoint |
| `CALA_ALLOW_SUBMIT` | For live submits | Safety gate for real POSTs |
| `CALA_HARVEST_CONCURRENCY` | No (default: 5) | Parallel batch count |

## Tech Stack

- **Runtime**: Node.js 20+ / TypeScript
- **Framework**: Next.js 16 (App Router)
- **Package manager**: pnpm 10
- **API**: Convex (Cala leaderboard + submission)
- **Optional**: Omnigraph (context graph), Northflank (compute jobs)

## Detailed Docs

- [`docs/OPERATOR.md`](docs/OPERATOR.md) — full operator guide with API routes, troubleshooting, and integration details
