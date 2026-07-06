# SOMO

**The offline-first AI teaching coach free for teachers, licensed by the institutions that support them.**

SOMO works across the whole connectivity ladder — Wi-Fi, 2G, SMS/USSD, and fully offline down to a button phone. Teachers capture their classroom's "Class DNA", reflect in 3-minute mirrors, and ask an AI coach questions by voice, typing, or SMS. NGOs, school networks, and ministries buy **seats per term**; every seat carries a one-time authorization PIN and a hard monthly usage quota, so access is gated and spend is predictable to the call.

## Documentation

- [Business model](docs/BUSINESS_MODEL.md) — B2B/B2G seat licensing, pricing tiers, unit economics
- [Architecture](docs/ARCHITECTURE.md) — the authorization spine, fail-closed cost gates, connectivity ladder
- [Data governance](docs/DATA_GOVERNANCE.md) — the analytics mart's privacy wall (k-anonymity, consent)
- [ADRs](docs/adr/) — decisions 0001–0009

## Quickstart (dev)

```bash
corepack enable pnpm                                  # Node 22+, pnpm 11
pnpm install
cp .env.example .env                                  # defaults work; add ANTHROPIC_API_KEY for real AI
docker compose -f infra/docker-compose.yml up -d      # postgres + redis + minio
pnpm --filter @somo/api db:push                       # create the schema
pnpm --filter @somo/api seed                          # demo institutions + PINs (see output)
pnpm dev                                              # api :4000 + admin console :5180
```

No Docker? Tests need nothing (they boot an embedded Postgres automatically); for `pnpm dev`, point `DATABASE_URL` at any Postgres.

**Demo walkthrough** (seed prints these): sign into the console at `localhost:5180` as `+254700000001` (OTP code appears in the API log), explore Teach For All's seats/costs/ROI; redeem the teacher PIN `TEST-SEAT` via the API or USSD webhook. Without an `ANTHROPIC_API_KEY` the coach answers through a deterministic mock — every flow works offline-from-Anthropic.

## Root scripts

| Script           | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | run all apps/services in watch mode                    |
| `pnpm lint`      | prettier check + eslint across all workspaces          |
| `pnpm typecheck` | TypeScript across all workspaces                       |
| `pnpm test`      | 170 tests: unit + API integration on **real Postgres** |
| `pnpm build`     | production builds (console bundle ~82 kB gzipped)      |

## Repository layout

```
frontend/admin/   institution console: seats, printable PIN sheets, cost + ROI dashboards
backend/api/      modular monolith: auth+PIN, seats/licenses, fail-closed cost gates,
                  AI coach (cached→haiku→sonnet), PIN-first USSD/SMS gateway, signed
                  packs, B2B sales pipeline, anonymized analytics mart
packages/         types (zod contract) · packsign (ed25519) · payments · ui tokens · i18n
infra/            docker-compose, CI
```

The invariant everything hangs on: **no seat, no paid call** proven by `backend/api/test/gating.test.ts`.
