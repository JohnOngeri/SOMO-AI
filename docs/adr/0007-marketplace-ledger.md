# ADR-0007: Marketplace revenue share on a double-entry journal

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Marketplace money is _other people's money_ (creators'), which raises the correctness bar above even subscriptions: every cent must be attributable, reversible, and auditable.

## Decision

1. **Double-entry journal** (`LedgerEntry`): sign convention is credit-positive/debit-negative; **entries sharing a `refId` must sum to zero** (asserted in every marketplace test); an account's balance is the sum of its entries. A sale writes `platform:clearing −gross / platform:revenue +fee / creator:{id} +net`; payouts and refunds are mirror journals. Balances are always derived, never stored.
2. **Platform fee 25%**, computed once in `splitFee()` and recorded on the `Sale` row — historical sales keep the fee they were sold under if the rate ever changes.
3. **Ownership = `PackGrant`**, not entitlements: a purchased pack is the teacher's property — it survives Plus lapsing and is exempt from the free-tier active-pack limit. Refunds revoke the grant.
4. **Pending mobile-money purchases** park after the charge row is written; the billing webhook dispatcher (via a `BillingHooks` callback, avoiding a circular service dependency) completes the sale idempotently (`Sale.providerRef` unique).
5. **Payouts**: full-balance cashout, min 1000 minor units, idempotent by key; sandbox settles instantly, real rails will flip `pending → paid` via the same journal shape.
6. Creator listings reuse the Pack model (`publisherId`, price); a separate review/curation workflow (`Listing.status`) is deferred until there are external creators.

## Consequences

- "Is the ledger balanced?" is a one-query invariant an auditor (or a cron alert) can check at any time.
- Refunded sales legitimately drive a creator balance negative; future payouts net it off — no clawback mechanics needed.
- Multi-currency creators keep per-currency balances implicitly (entries carry currency); payout requests are per-currency.
