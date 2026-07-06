# SOMO Business Model — B2B / B2G

> Living document, rewritten 2026-07 for the enterprise pivot. The previous freemium model is retired (see "What changed" at the end). Pricing below mirrors `backend/api/src/billing/pricing.ts` — the config file is the source of truth; this doc explains it.

## The one-sentence model

**The teacher never pays; their employer or sponsor does — per seat, per term — and every seat carries a hard monthly usage quota, so SOMO's variable cost is capped by construction and the buyer's spend is predictable to the call.**

## Why we pivoted

Every SOMO user costs real money: LLM inference on each coach question, SMS/USSD fees on every gateway interaction, pack distribution bandwidth. A viral freemium teacher base means uncapped variable cost against ~$2/month consumer revenue with prepaid-market churn — growth would have been the failure mode. Institutions, by contrast, already pay far more than our seat price for the same job done worse: field mentors driving between schools.

The engineering counterpart of this model is **fail-closed cost gating** (ADR-0009): no metered action — AI call, outbound SMS, USSD-triggered work, pack download — is ever served without an ACTIVE seat on an ACTIVE license with remaining quota. Spend cannot exceed `seats × quota × unit cost`. This invariant is enforced in one chokepoint per rail and proven by the `gating.test.ts` suite (zero provider invocations for unauthorized/over-quota users).

## Who buys, and what they buy

| Buyer                       | Example                                             | What they buy                                | Why                                                                           |
| --------------------------- | --------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| NGOs / teaching fellowships | Teach For All partners                              | Seats for their cohort + coordinator console | Displace field-mentor visits; faster new-teacher ramp                         |
| Low-cost school networks    | Bridge-style, Nova Pioneer-style                    | Seats across their schools                   | Consistent teaching quality at chain scale, measurable coverage               |
| Ministries of Education     | County/national pilots                              | Seats for a district or cadre                | Teacher support at a per-seat price no in-person program can match            |
| Foundations / funders       | Program co-funding                                  | Seats on behalf of grantees + the ROI report | Auditable cost-per-outcome                                                    |
| Insights licensees          | Ministries, USAID/World Bank, curriculum publishers | The **aggregated analytics subscription**    | Region-level curriculum-friction signal (k-anonymous; see DATA_GOVERNANCE.md) |

The teacher's experience is free, warm, offline-first, and unchanged except one step: entering a one-time **authorization PIN** from their coordinator's printed PIN sheet (app, USSD, or SMS).

## Revenue streams

### 1. Seat licenses (core revenue)

Per seat, per term, tiered by buyer type with volume breaks (config: `pricing.ts`):

| Tier             | Base $/seat/term | Volume breaks                |
| ---------------- | ---------------- | ---------------------------- |
| NGO / Fellowship | $15              | −10% ≥200 seats, −20% ≥1,000 |
| School network   | $12              | −10% ≥500, −20% ≥2,500       |
| Ministry         | $7               | −15% ≥5,000, −30% ≥20,000    |
| Foundation       | $15              | −15% ≥500                    |

Multi-currency invoicing via a coarse FX table (USD, KES, NGN, TZS, UGX, GHS, ZAR, XOF). Pipeline: **quote → order → invoice (INV-YYYY-NNNN) → payment → license auto-provisioned** with exactly the ordered seats. Payment rails: bank transfer (primary, `markPaid` with reference), card via the Stripe adapter, mobile money via the existing provider interface. Nothing is provisioned before money lands.

Each license carries per-seat monthly quotas (defaults: 120 AI calls, 60 SMS; per-seat overrides available) — the quota is simultaneously the **cost ceiling for us** and the **budget line for them**, shown on the console cost dashboard as actual vs run-rate projection vs hard ceiling.

### 2. Insights subscription (data exhaust, licensed separately)

Aggregated, k-anonymous curriculum-friction analytics: "top concepts teachers struggle to explain" by country/institution type/week, plus per-topic trends. Strictly governed (docs/DATA_GOVERNANCE.md): labels only, no transcripts, no identifiers, cells under K=5 distinct teachers suppressed. Priced as an annual subscription per licensee (target $10–50k/year depending on scope); gated by the `insights` role today.

### 3. Content licensing (dormant, optional)

The signed-pack marketplace with its double-entry creator-payout ledger remains built and tested but unmounted from teacher surfaces. When institutions want third-party publisher content, packs are licensed institutionally and revenue-shared through the existing ledger (25% platform fee machinery already proven).

## Unit economics

Per active seat per month, worst case at default quotas:

- AI: 120 calls × ~$0.005 (Haiku-routed, cached tier free, quality tier rare) ≈ **$0.60 ceiling**, observed p50 far lower (cache + degraded-mode reuse)
- SMS: 60 × $0.01 ≈ **$0.60 ceiling** (USSD replies ride the session channel at no per-message cost)
- Everything else (storage, compute) amortizes to cents.

Ceiling variable cost ≈ **$1.20/seat/month ≈ $3.60/seat/term** against $7–15 seat revenue — a 48–76% worst-case gross margin that only improves because real usage sits well under quota and the cached tier is free. The console shows the same math to the buyer (unit costs are printed on their dashboard), which is itself a sales feature: no education vendor shows spend to the call.

## The sales motion (land → prove → expand)

1. **Land**: 15–50 seat paid pilot, one term (seeded demo mirrors this: "Teach For All — Kenya Pilot").
2. **Prove**: the console's **Impact & ROI report** is the renewal engine — mentor visits displaced (interactions ÷ 8), field hours and $ saved vs seat cost, time-to-competency cohort curve, weekly coverage. Every figure traces to the metered ledger; assumptions are printed and tunable per account.
3. **Expand**: network-wide or district-wide renewal at volume-break pricing; ministry deals anchor on the $7 tier.
4. **Layer**: insights subscriptions to ministries/funders ride on aggregate scale and are near-pure margin.

## Path to self-sustainability (12 months)

Fixed burn target: ~$18–21k/month (3-person core team + infra). Break-even requires roughly **1,400–2,600 paid seats per term** depending on tier mix (e.g. 2,000 network-tier seats × $12 × 3 terms/year ≈ $72k/year… illustrative mid-case: 4,000 blended seats ≈ $40k/term ≈ $13k/month) plus 2–3 insights licenses (~$4–8k/month amortized). Concretely:

| Milestone | Seats under license      | Monthly revenue (blended $11/seat/term ÷ 4 mo) | Note                            |
| --------- | ------------------------ | ---------------------------------------------- | ------------------------------- |
| M3        | 300 (2 pilots)           | ~$0.8k                                         | pilots prove the ROI report     |
| M6        | 1,500 (first network)    | ~$4k                                           | first renewal on ROI evidence   |
| M9        | 4,500 (+ ministry pilot) | ~$12k                                          | + first insights license        |
| M12       | 8,000                    | ~$22k + insights                               | **default-alive** at ~$21k burn |

The levers, in order: (1) renewal rate — a function of the ROI report being true; (2) ministry-tier volume; (3) insights attach rate. Variable cost is not a lever because it is capped by design.

## What changed from the freemium model (v1 of this doc)

Retired: consumer SOMO Plus subscriptions, trials/coupons/dunning as a consumer flow, airtime upgrades, teacher pack purchases, the Bluetooth referral-reward loop (peer pack sharing remains as zero-cost distribution, minus the Plus-days incentive), and k-factor/ARPU/churn as primary metrics. The operative metrics are now: **seats licensed, seat claim rate, weekly coverage %, quota utilization, renewal rate, cost per seat, and insights ARR.** The old consumer billing machinery survives as internal plumbing (charge audit, webhooks, refunds) reused by B2B invoicing and the dormant marketplace.
