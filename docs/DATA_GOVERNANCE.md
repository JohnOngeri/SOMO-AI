# SOMO Data Governance

This document governs what SOMO collects, how the analytics product is separated from operational data, and what is and is not sold. It is referenced from institutional license agreements.

## Two stores, one wall

|                          | Operational store                                | Analytics mart (`AnalyticsSignal`)                               |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| Purpose                  | Serve teachers; bill institutions                | Aggregated educational-friction insights                         |
| Contains                 | Accounts, transcripts, reflections, usage ledger | **Classification labels only**                                   |
| Personal identifiers     | Yes (phone, name, per-teacher events)            | **None** — no userId, phone, name, institution id, or free text  |
| Tenant                   | Scoped to the teacher's institution              | Cross-tenant, coarse geography only (country + institution type) |
| Sold / shared externally | **Never**                                        | Only as k-anonymous aggregates (see below)                       |

The wall is enforced at ingest: `AnalyticsService.ingest()` classifies the text (question or reflection) into a curriculum topic + skill and stores **only the labels** with country, institution type, grade/subject when known, and an ISO-week bucket. The transcript never enters the mart. Classification is a zero-cost keyword taxonomy (no per-event LLM call); any future AI classifier must run inside SOMO infrastructure under this same rule.

`teacherHash` is a keyed one-way HMAC used exclusively to count _distinct_ teachers for k-anonymity. It is not reversible without the server secret, is never exported, and never joins back to operational tables in any product surface.

## Consent

- Analytics ingestion is part of the institutional license. Each institution carries an `analyticsOptOut` flag; when set, **no signals are ingested for its teachers at all** (enforced at the ingest gate, tested).
- Opt-out status can be changed at any time by the institution; it applies from that moment forward. On request, SOMO deletes an institution's historical signals (identified via seat → teacherHash mapping computed server-side for the deletion job only).

## k-anonymity

Every read of the mart (top concepts, trends, any future query) enforces a k-anonymity threshold (`ANALYTICS_K_THRESHOLD`, default **5** distinct teachers per cell):

- Cells below k are **removed**, not zeroed or rounded.
- The number of suppressed cells is disclosed with every result, so consumers know data was withheld rather than absent.
- Trend buckets are suppressed independently per week.

Geography is deliberately coarse (ISO country + institution type). Finer geography (district-level) requires raising k proportionally and a specific data-protection review before shipping.

## What is sold

The **insights subscription** (ministries, funders such as USAID/World Bank, curriculum developers, publishers) contains only:

- Ranked curriculum-friction topics ("top concepts teachers struggle to explain") by country / institution type / time window.
- Trend lines per topic per week.
- All outputs k-anonymous per the rules above.

What is **never** sold or shared: raw questions or reflections, Class DNA content, per-teacher or per-school data, phone numbers, institution-identifiable slices, or the teacherHash keys.

## Retention

- Operational data: retained for the license term + 24 months, then deleted or anonymized; teachers may request deletion of their reflections/DNA at any time (seat usage counts persist for billing audit).
- Analytics signals: labels only, retained indefinitely unless the source institution opts out and requests deletion.
- Payment/webhook audit rows: 7 years (financial audit).

## Review triggers

Any of the following requires a governance review before shipping: new fields in `AnalyticsSignal`, geography finer than country, k below 5, joining the mart to any operational table in a product surface, or an external data-share not covered by the insights subscription contract.
