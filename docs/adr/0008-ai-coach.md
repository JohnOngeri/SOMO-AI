# ADR-0008: AI coach — cost ladder, grounding without embeddings, provider adapter

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Ask Coach is the product's hero feature AND its biggest variable cost. BUSINESS_MODEL.md caps AI cost at ≤ $0.03/MAU/month, so the architecture is a cost ladder, not a model call.

## Decision

1. **Three-rung cost ladder**, cheapest first, recorded per reply as `costTier` (margin telemetry):
   - **cached** — normalized question (case/whitespace/punctuation) + DNA profile id hash-matches a prior reply → zero model cost.
   - **small** — `claude-haiku-4-5` ($1/$5 per MTok) for short single questions and ALL SMS/USSD asks (200-token cap, ≤380-char answers).
   - **quality** — `claude-sonnet-5` for long (>280 chars, env-tunable) or multi-part questions.
     Models are env-config, not code — repricing or swapping tiers is a config change.
2. **Grounding without embeddings**: the system prompt carries the teacher's Class DNA (class size, traits, sprint transcripts) plus installed-pack lesson titles. pgvector RAG over full lesson content is deferred until packs carry enough text to warrant it — Anthropic has no embeddings API, so that will need an embedding provider decision; the schema (pgvector already in the dev image) and this service boundary are ready for it.
3. **Provider adapter** (`AiProvider`): official `@anthropic-ai/sdk` behind an interface; `MockAiProvider` is deterministic and asserts on the exact system prompts sent, so tests verify grounding without a key. Keyless environments automatically get the mock.
4. **Quota is enforced inside the coach**, via the same `recordAskOrThrow` gate as everything else; asks are idempotent by client ULID end to end (replay returns the stored answer and consumes nothing).
5. Voice mode reaches this service as text — transcription happens in the worker pipeline (Phase 8+), keeping the coach transport-agnostic. SMS/USSD answers are generated under an explicit SMS-size instruction AND hard-truncated as a belt-and-braces.

## Consequences

- Worst-case per-ask cost ≈ small fractions of a cent (Haiku, ~1K tokens); cache and quota keep the p95 far lower. The `costTier` + token columns feed the cost-per-active-user metric on the revenue dashboard (Phase 12).
- Identical questions across different teachers don't share cache entries when grounded (DNA id is in the key) — correctness over cache hit rate.
- The mock keeps CI deterministic; a small nightly live-key smoke test can be added at hardening.
