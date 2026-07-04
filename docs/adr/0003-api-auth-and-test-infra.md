# ADR-0003: OTP auth design, refresh-token rotation, and dockerless real-Postgres tests

- **Status:** accepted
- **Date:** 2026-07-04

## Context

Phase 2 delivers the main API (Fastify + tRPC + Prisma). Two decisions needed recording: how phone-OTP auth is secured, and how integration tests hit a real Postgres on machines without Docker.

## Decision

1. **OTP challenges** are server-side rows: HMAC-SHA256 code hash (never the code), 5-minute TTL, 60-second resend window per phone, 5 wrong attempts lock the challenge, single-use consumption. The SMS text is localized via `@somo/i18n`. Codes never appear in API responses.
2. **Sessions**: 15-minute HS256 JWT access tokens + 30-day opaque refresh tokens stored as SHA-256 hashes, bound to a device. Rotation is single-use; presenting an already-rotated token is treated as theft and revokes the device's whole token family (RFC 9700 style).
3. **Idempotency by client ULID** starts here: reflections accept a client-generated ULID and replay safely — the pattern every offline mutation will follow (Phase 9 sync generalizes it).
4. **Test infra**: `vitest` globalSetup boots **embedded-postgres** (real PostgreSQL binaries, no Docker) on port 5433 when `DATABASE_URL` is unset; CI sets `DATABASE_URL` to its service container so the same tests run against both. A plain `prisma db push` provisions the schema — the data dir is recreated fresh every run, so the destructive `--force-reset` (which Prisma 7's AI-agent guard rightly blocks) is never needed. Tests truncate between cases and run files serially.
5. **Prisma 7** (driver-adapter model): client generated into `src/generated/` (gitignored, regenerated in typecheck/test scripts), connections via `@prisma/adapter-pg`, CLI config in `prisma.config.ts`.
6. Server assembly is dependency-injected (`buildServer({env, db, sms})`) so tests swap in `MemorySmsSender` and read the "sent" codes — no mocking framework.

## Consequences

- Auth is passwordless, replay-resistant, and testable offline; stolen refresh tokens have a one-use blast radius.
- Local `pnpm test` needs no Docker (first run downloads PG binaries once); CI stays on standard service containers.
- HS256 with a shared secret is fine for a single API service; when more backend services must verify tokens (Phase 4+), we either share the secret via env or move to ed25519 JWKs — revisit then.
