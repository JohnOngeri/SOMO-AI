# SOMO Business Model

> Living document. Assumptions below are launch hypotheses; the internal revenue dashboard (Phase 12) computes the same model from **live** metrics, and this doc gets updated as real numbers arrive.
>
> Goal: **default-alive within 12 months** — gross monthly revenue covers infrastructure + core team burn.

## 1. Revenue streams

### A. Freemium consumer (B2C)

| Tier           | Price                                                                                                                 | Includes                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Free**       | $0                                                                                                                    | DNA Sprint, 3-Minute Mirror, **5 Ask Coach / week**, **1 active pack**, community   |
| **SOMO Plus**  | local-currency equivalent of **$2/mo** (e.g. KES 260, NGN 3,000, TZS 5,200); **annual = 10× monthly** (2 months free) | unlimited Ask Coach, all standard packs, offline everything, priority voice, no ads |
| **Plus trial** | 14 days free, no card required (phone-verified, one per number)                                                       | full Plus                                                                           |

Payment rails: mobile money (M-Pesa, MTN MoMo, Airtel Money) via Flutterwave/Paystack, card, and airtime billing where available — all behind the `PaymentProvider` interface with a sandbox adapter for dev/test.

### B. B2B / B2B2C seat licensing — the revenue that carries fixed costs

Org buys N seats → admin portal (invite teachers, assign packs, cohort analytics, privacy-safe outcome metrics) + invoicing.

| Volume (seats) | Price / seat / year |
| -------------- | ------------------- |
| 1 – 100        | $15                 |
| 101 – 1,000    | $10                 |
| 1,001 – 10,000 | $7                  |
| Ministry-scale | custom ($3–5)       |

In-product expansion trigger: when ≥5 teachers from one school are active, surface "bring your school onto SOMO" → routes into the B2B sales funnel.

### C. Content marketplace (take-rate)

Verified publishers and expert teachers sell signed packs. **Platform fee: 25%** of each sale (creator keeps 75%). Payout ledger is double-entry and auditable; creators get an earnings dashboard and monthly mobile-money payouts (min threshold $10).

### D. SMS/USSD micro-revenue + carrier deals

Premium USSD coach sessions (carrier-billed, e.g. ~$0.02/session, telco revenue-share modelled at 60/40 telco-favoured) and zero-rating partnerships. Modelled in the billing layer from day one; specific telco integrations stubbed until contracts exist.

### E. Grants & impact revenue (non-dilutive)

Anonymized impact-metrics export (teacher retention, reflection depth, lesson-completion outcomes) in funder-ready format. Budgeted conservatively at **$50k in year 1** — treated as runway extension, never as the path to sustainability.

## 2. Growth loops (built as product code)

| Loop       | Mechanism                                                                                         | Metric                  |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| Referral   | Bluetooth/USB pack share carries a signed invite → new signup credits **both** users 14 Plus days | k-factor (target ≥ 0.4) |
| Retention  | streaks, weekly community digest, leaderboards, re-engagement SMS                                 | D30 / W12 retention     |
| Conversion | soft paywalls at natural limits (6th Ask, 2nd pack), trial, annual nudge                          | free→Plus conversion    |
| Expansion  | school-cluster detection → B2B funnel                                                             | teacher→seat-deal rate  |

## 3. Funnel (every step instrumented)

install → signup (phone OTP) → DNA Sprint complete (activation) → first Ask → weekly habit (3+ active days) → paywall hit → trial start → **paid Plus** → (cluster) → **B2B seat deal**

## 4. Unit economics — launch assumptions

| Variable                       | Assumption                       | Basis                                                  |
| ------------------------------ | -------------------------------- | ------------------------------------------------------ |
| Variable cost / MAU / month    | **$0.04–0.08**                   | small-model routing, caching, SMS, P2P distribution    |
| CAC (teacher)                  | ~**$0.10**                       | teacher-to-teacher referral is the primary channel     |
| Free → Plus conversion         | 3% of MAU                        | industry freemium range 2–5%, priced for market        |
| Plus monthly churn             | 6%                               | prepaid-market norm; annual plans reduce blended churn |
| B2B seat gross margin          | ~90%                             | seats are software + support                           |
| Blended ARPU (paying)          | ~$1.9/mo B2C; ~$0.75/mo/seat B2B | pricing tables above                                   |
| Fixed burn (infra + core team) | **$18k/mo**                      | 3-person core team (blended $5.5k) + $1.5k infra/tools |

## 5. 12-month break-even model

Adoption ramp: 2k MAU at launch (M1), ~35% m/m growth cooling to ~15% by M12 → ~55k MAU. B2B: first pilot school M4, first network deal M7, first ministry pilot M10. Marketplace GMV starts M6.

| Month | MAU    | Plus subs | B2C MRR | B2B seats | B2B MRR\* | Mkt fee | SMS  | **Revenue** | Burn | Net        |
| ----- | ------ | --------- | ------- | --------- | --------- | ------- | ---- | ----------- | ---- | ---------- |
| 1     | 2,000  | 30        | $60     | 0         | $0        | $0      | $0   | **$60**     | $18k | −$17.9k    |
| 2     | 2,700  | 55        | $110    | 0         | $0        | $0      | $0   | **$110**    | $18k | −$17.9k    |
| 3     | 3,600  | 95        | $190    | 0         | $0        | $0      | $10  | **$200**    | $18k | −$17.8k    |
| 4     | 4,900  | 150       | $300    | 300       | $310      | $0      | $20  | **$630**    | $18k | −$17.4k    |
| 5     | 6,600  | 215       | $430    | 300       | $310      | $0      | $30  | **$770**    | $18k | −$17.2k    |
| 6     | 8,900  | 300       | $600    | 800       | $780      | $150    | $50  | **$1.6k**   | $19k | −$17.4k    |
| 7     | 12,000 | 420       | $840    | 2,300     | $2.1k     | $300    | $80  | **$3.3k**   | $19k | −$15.7k    |
| 8     | 16,000 | 570       | $1.1k   | 3,300     | $3.0k     | $500    | $120 | **$4.7k**   | $19k | −$14.3k    |
| 9     | 21,000 | 760       | $1.5k   | 5,300     | $4.6k     | $800    | $170 | **$7.1k**   | $20k | −$12.9k    |
| 10    | 27,000 | 990       | $2.0k   | 9,300     | $7.4k     | $1.2k   | $230 | **$10.8k**  | $20k | −$9.2k     |
| 11    | 34,000 | 1,270     | $2.5k   | 15,300    | $11.4k    | $1.7k   | $300 | **$15.9k**  | $21k | −$5.1k     |
| 12    | 43,000 | 1,600     | $3.2k   | 23,300    | $16.4k    | $2.3k   | $390 | **$22.3k**  | $21k | **+$1.3k** |

\* B2B MRR = seats × blended $10.5/seat/yr ÷ 12, ramping toward volume tiers. Burn grows slightly with support + infra scale. Grant income ($50k y1) extends runway but is excluded from the break-even line by design.

**Break-even: month 12** on subscription + licensing revenue. Cumulative net burn to break-even ≈ **$164k** (covered by grants + pre-seed). The two levers that matter most, in order: (1) landing B2B seat deals on schedule — B2B is ~73% of M12 revenue; (2) keeping variable cost/MAU ≤ $0.08 so gross margin stays >85%.

**Sensitivity:** if B2B slips 3 months, break-even moves to ~M15 and required runway to ~$220k. If free→Plus conversion is 2% instead of 3%, B2C MRR drops ~33% but break-even still lands M12–13 because B2B dominates. The Phase 12 dashboard computes **months-to-break-even from live metrics** using exactly this model.

## 6. Cost discipline (protecting margin)

- Cost-aware AI routing: cached/templated answers → small model → quality model only when needed; target ≤ $0.03 AI cost/MAU/month.
- SMS instead of data where possible; USSD sessions are telco-cost, revenue-shared.
- Peer-to-peer pack distribution = near-zero bandwidth + near-zero CAC.
- Report **cost per active user** monthly on the internal dashboard; alert if > $0.10.

## 7. Decisions log

Pricing and fee choices above are recorded as ADRs when implemented (billing Phase 5, marketplace Phase 6). Ambiguities are resolved with a reasonable choice + ADR, not a stall.
