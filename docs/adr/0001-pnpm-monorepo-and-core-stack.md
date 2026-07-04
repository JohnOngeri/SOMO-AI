# ADR-0001: pnpm monorepo, TypeScript everywhere, Fastify+tRPC+Prisma core

- **Status:** accepted
- **Date:** 2026-07-04

## Context

SOMO spans four frontends (mobile, web PWA, admin, ussd-sim), nine backend services, and five shared packages. Frontend and backend must share one typed API contract, money paths must be testable end-to-end in one repo, and we prefer boring, well-supported tech over clever/novel.

## Decision

- **pnpm workspace monorepo** (`frontend/*`, `backend/*`, `packages/*`). No Nx/Turbo/Bazel at this scale — recursive `pnpm -r` scripts with `--if-present` keep the toolchain boring; we can add a task runner later if build times demand it.
- **TypeScript everywhere**, strict mode, shared base tsconfig in `packages/config`.
- **API contract lives in `packages/types`** as zod schemas; both server (tRPC routers) and clients infer types from it. Contract tests enforce the match.
- **Fastify + tRPC + Prisma + PostgreSQL (pgvector)** for all backend services; **Redis + BullMQ** for queues; **MinIO/S3** for signed packs.
- **Node 22 LTS** pinned via `.nvmrc` + `engines`; pnpm pinned via `packageManager`.
- **Prettier + ESLint** shared presets in `packages/config`; Husky pre-commit runs lint+typecheck, pre-push runs tests; CI (GitHub Actions) runs lint, typecheck, and tests against real Postgres+Redis services.

## Consequences

- One `pnpm install` boots everything; contract drift between frontend and backend is a compile error, not a runtime bug.
- pgvector keeps RAG inside Postgres — one database to operate, at the cost of ceiling vs a dedicated vector store (acceptable at our scale).
- Recursive scripts mean no build caching across packages yet; revisit if CI exceeds ~10 minutes.
- The reference prototype in `project/` stays untracked (`.gitignore`) — it is design input, not product source.
