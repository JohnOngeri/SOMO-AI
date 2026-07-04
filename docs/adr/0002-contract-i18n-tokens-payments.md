# ADR-0002: Internal-package pattern, zod-4 contract, token-level a11y, sandbox payments

- **Status:** accepted
- **Date:** 2026-07-04

## Context

Phase 1 creates the shared packages every later phase builds on: the API contract, translations, design tokens, and the payment abstraction. Decisions made here are expensive to reverse.

## Decision

1. **Internal-package pattern.** Shared packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`), no build step. Consumers (vitest, vite, tsx, expo/metro) compile TS natively; production backend builds bundle workspace deps. Avoids build-order orchestration in a task-runner-less monorepo.
2. **zod 4 as the single contract language** in `@somo/types`. Every wire shape (auth, DNA, reflections, coach, packs, entitlements, billing, metering, marketplace ledger, sync, referral, USSD) is a zod schema; TS types are inferred, never hand-written. Money is integer minor units + explicit currency — floats rejected at the schema level.
3. **i18n without a library.** `@somo/i18n` ships plain JSON catalogs (EN/FR/Hausa/Swahili) + a ~20-line typed `t()` with `{param}` interpolation and English fallback. Tests enforce key parity, non-empty strings, and placeholder parity across locales. FR/SW/HA strings are first-pass drafts pending native-speaker review.
4. **Accessibility enforced at the token level.** `@somo/ui` tests compute WCAG 2.2 contrast ratios for every sanctioned fg/bg pair and fail the build below AA; consequence: clay is a surface/large-text color — clay-as-body-text must use `clayDeep`. Tap target minimum (44px) is a token. Storybook 10 (react-vite + a11y addon) documents tokens; component primitives are added when the first app ships (Phase 10+), styled via the shared tailwind preset.
5. **Payments = one interface, sandbox first.** `@somo/payments` defines `PaymentProvider` (idempotent `createCharge`, `fetchCharge`, `refund`, `verifyWebhook`). The sandbox adapter is a complete deterministic implementation of mobile-money semantics — magic msisdns for insufficient-funds/invalid/pending, async STK-push settlement emitting HMAC-signed webhooks, partial/over-refund rules, idempotency on charges AND refunds. All billing tests run against it; Flutterwave/Paystack adapters arrive in Phase 5 behind the same interface.
6. **Toolchain rides current majors** (TypeScript 6, ESLint 10 flat config at root, Vitest 4, zod 4, Storybook 10) — pinned by the lockfile.

## Consequences

- Contract drift is a compile error; a schema change breaks the offending consumer immediately.
- No dist artifacts to keep in sync, but backend Docker builds must bundle workspace packages (esbuild/tsup — Phase 2).
- The palette cannot silently regress below AA — designers change tokens and tests, together.
- Every money code path from Phase 5 onward is testable offline with zero real keys.
