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

- **Empty portfolio**: run `pnpm run demo:seed` then refresh.
- **Wrong run id**: set `LOBSTER_DEFAULT_RUN_ID` / `NEXT_PUBLIC_LOBSTER_DEFAULT_RUN_ID` to match the folder under `data/runs/`.
