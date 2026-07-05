# ADR-0009: Fail-closed cost gating — no seat, no paid call (pivot P2)

- **Status:** accepted
- **Date:** 2026-07-05
- **Supersedes:** the freemium behavior in ADR-0005/0006 (weekly free asks, paywalls, consumer subscriptions, airtime upgrades)

## Context

The business model pivoted to B2B/B2G seat licensing: teachers use SOMO free, institutions pay per seat per term. Every LLM call and SMS costs real money, so the defining engineering requirement became **predictable spend**: monthly cost must be bounded by `seats × quota`, provably.

## Decision

1. **One authorization question everywhere**: `SeatService.activeSeatFor(userId|phone)` — ACTIVE seat, ACTIVE license, inside the term window, institution not suspended, evaluated lazily (no cron dependency). Null answer = fail closed.
2. **Entitlements derive exclusively from seats.** Seatless claims are `plan: 'none'` with **zero** limits and no packs. `User.plan/plusUntil` are dead columns pending removal. Offline seat tokens cap `exp` at the license end, so a lapsed license stops new AI even on a device that never reconnects (7-day degraded grace serves cached content only).
3. **Two cost gates, both in metering, both audited**:
   - `recordAiCallOrThrow` — the ONLY path to a model provider. Consumes a monthly `ai_call` credit or records a `quota_block` and throws. A blocked askId retried later cannot read as "already paid" (the block is stored under a fresh event id — a fail-open hole caught during this phase).
   - `recordSmsOrThrow` via `SmsGate` — the ONLY path to non-OTP outbound SMS. Auth OTPs stay on the raw sender, bounded by the resend window (the one deliberate pre-seat cost: you can't onboard without it).
4. **Graceful degradation, never uncontrolled spend**: over-quota seats still get cached coach answers (flagged `degraded`); new questions get the "renews on the 1st" message. Reflections and DNA (our own storage, no marginal cost) remain ungated.
5. **The gateway is PIN-first.** An unbound MSISDN's only affordance is PIN entry. USSD replies to unbound numbers ride the session channel (free); inbound SMS from unbound numbers is processed only when it starts with `PIN` and failures get **no reply** — an attacker cannot make us spend by texting us. SMS `ASK` pre-checks the SMS quota before consuming an AI credit, so we never pay for an answer we can't deliver.
6. **Teacher-facing commerce removed**: billing router unmounted, `marketplace.buy` unmounted (grants already sold remain property and bypass the seat gate), airtime upgrades deleted. `BillingService` survives as charge/webhook/refund plumbing for P6 invoicing.
7. **Quota counters are derived** from the append-only `UsageEvent` ledger per calendar month (`ai_call`, `sms_out` are the cost ledger; `quota_block` is the audit of every refusal) — no stored counters to drift, idempotent under offline replay.

## Consequences

- `gating.test.ts` proves the invariant the pivot exists for: mock-provider invocations === `ai_call` rows === bounded by seat quotas; zero for seatless/revoked/expired/over-quota users.
- Institutions get to-the-call spend predictability: `seats × (monthlyAiCalls × cost/call + monthlySms × cost/sms)` is a hard ceiling.
- The signup OTP is the only unmetered SMS; per-phone resend windows bound it. Rate-limiting unbound PIN attempts beyond the no-reply policy is listed for hardening.
