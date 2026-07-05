# ADR-0005: Entitlements + metering as extraction-ready modules; offline-token semantics

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Freemium limits must hold on a phone that has been offline for weeks, without ever bricking a paying teacher, and every enforcement moment is also a conversion-funnel datapoint.

## Decision

1. **Modular monolith, not microservices (yet).** `EntitlementService` and `MeteringService` live inside `backend/api` as self-contained modules with their own routers — the architecture doc's `backend/entitlements` / `backend/metering` become separate deployables only when scale demands; every caller already goes through the service interface, so extraction is mechanical. (Deviation from the literal repo plan, recorded here.)
2. **Plan state on the user** (`plan`, `plusUntil`) until Phase 5's billing service becomes the writer. `plusUntil` uniformly covers paid periods, trials, and referral reward days; lapsing degrades to free with no cron — expiry is evaluated at read time.
3. **Offline tokens**: 30-day ed25519 tokens (dedicated key, distinct from the pack key) in packsign's compact format. Device semantics, tested server-side so client implementations can't drift: valid+fresh → full access; ≤7 days past exp → **degraded** (access continues, renew nudge); beyond grace → expired. A teacher in a dead zone never loses paid access mid-term.
4. **Metering = append-only facts, idempotent by client ULID.** Counters are always derived by query, never stored — replaying an offline outbox cannot double-count. The ask gate (`recordAskOrThrow`) is the single quota chokepoint that the AI coach (7), SMS/USSD (8), and sync (9) will all call.
5. **Every block is a metered `paywall_hit`** with a reason (`ask_limit`, `pack_limit`) — the revenue dashboard's conversion funnel reads straight from this table. Money-adjacent event types (`upgrade`, `trial_start`, `referral_redeem`) are server-written only.

## Consequences

- The 6th ask and the 2nd pack are now the product's two soft paywalls, enforced and instrumented.
- Quota counting is query-time (`count()` over an indexed week window) — fine to millions of events; pre-aggregation is a later optimization with the same interface.
- Offline enforcement honesty depends on the client honoring the token contract; the signed token makes lying detectable at next sync (server recount wins).
