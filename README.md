# SOMO

**Offline-first AI teaching coach for teachers and learners in low-connectivity markets.**

SOMO works across the whole connectivity ladder — Wi-Fi, 2G, SMS/USSD, and fully offline — down to a button phone. Teachers capture their classroom's "Class DNA", get a daily lesson from signed term packs, reflect in 3-minute voice mirrors, and ask an AI coach questions by voice, typing, or SMS.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, monorepo layout, connectivity ladder, money paths
- [Business model](docs/BUSINESS_MODEL.md) — pricing, revenue streams, 12-month break-even model
- [ADRs](docs/adr/) — architecture decision records

## Quickstart (dev)

```bash
corepack enable pnpm       # Node 22+, pnpm 11
pnpm install
cp .env.example .env       # fill in sandbox keys as needed
docker compose -f infra/docker-compose.yml up -d
pnpm dev
```

## Root scripts

| Script           | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | run all apps/services in watch mode           |
| `pnpm lint`      | prettier check + eslint across all workspaces |
| `pnpm typecheck` | TypeScript across all workspaces              |
| `pnpm test`      | unit + integration tests                      |
| `pnpm e2e`       | Playwright / Maestro end-to-end suites        |

## Repository layout

```
frontend/   mobile (Expo), web PWA, admin portal, ussd-sim
backend/    api, billing, entitlements, metering, marketplace, ussd-gateway, ai, sync, workers
packages/   ui, types, i18n, payments, config
infra/      docker-compose, CI, seed scripts
docs/       architecture, business model, ADRs, runbook
```

Workspaces are added phase by phase — see the build plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
