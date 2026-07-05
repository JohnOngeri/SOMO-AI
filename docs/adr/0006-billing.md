# ADR-0006: Billing — subscription lifecycle, dunning, and money-path guarantees

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Billing is the first module where a bug costs real money or a paying teacher's trust. It must behave like financial software on flaky mobile-money rails where a charge can hang in "STK push sent" limbo for minutes.

## Decision

1. **Lifecycle**: `pending → active` (webhook-settled mobile money), `trialing → active` (14-day no-card trial, conversion charge at trial end), `active → past_due → active|expired` (dunning), `active → canceled → expired` (runs to period end). One live subscription per user.
2. **Dunning = day 0/2/5**: first failure enters `past_due` with a retry 2 days out, second failure 3 more days, third failure expires + downgrades. Access is **granted through the retry window** (`plusUntil = nextRetryAt`) — a flaky wallet never means instant lockout mid-lesson.
3. **Money-path guarantees**, each with a test:
   - _Idempotent subscribe_: the client's ULID idempotency key flows to the provider AND keys the `PaymentCharge` audit row; retries return the original subscription.
   - _Idempotent refunds_: our own `Refund` table (unique idempotency key + refundRef) independent of provider idempotency — a replay can never re-increment `refundedMinor`. (Caught by the suite before it shipped.)
   - _Replay-proof webhooks_: raw body stored **before** processing (even unverified ones, flagged, for forensics); processing keyed by provider event id; duplicates are acknowledged no-ops.
   - _Audited everything_: every charge attempt (incl. failures), every refund, every webhook is a row.
4. **Coupons**: percent-off or fixed-amount (currency-matched), redeem-by + max-redemption caps, counted only on successful activation.
5. **Price book seeded** per BUSINESS_MODEL.md: Plus at KES 260 / NGN 3,000 / TZS 5,200 / $2 monthly; annual = 10× monthly. Prices are rows, not code — market repricing is an update, not a deploy.
6. Renewal/dunning/settle methods take an injectable `at: Date` — the whole lifecycle is testable without clocks; the BullMQ worker (Phase 8/workers) just calls them on schedule.

## Consequences

- The upgrade path from paywall_hit → trial → paid → renewal is fully wired to entitlements; the funnel events (`trial_start`, `upgrade`) land in metering for the revenue dashboard.
- Flutterwave/Paystack adapters slot in behind `PaymentProvider` with zero billing-logic changes; until then the sandbox exercises every code path including async settlement.
- No proration/plan-switching yet — deferred until a second consumer plan exists.
