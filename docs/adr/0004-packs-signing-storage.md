# ADR-0004: Pack signing chain, canonical JSON, and storage abstraction

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Packs travel over HTTPS, Bluetooth, USB sticks, and pre-loaded SD cards. The transport can never be trusted; the artifact must prove itself.

## Decision

1. **Signature covers the manifest; the manifest pins the content.** ed25519 over the canonical JSON of the full manifest (which embeds `contentHash` = sha256 of the archive bytes and `sizeBytes`). Device install check: verify manifest signature → download/receive bytes → hash-compare → install. A tampered manifest, swapped archive, or forged price all fail closed.
2. **Canonical JSON lives in `@somo/packsign`** (recursive key sort, drop-undefined, no whitespace, dependency-free) — the one function both signer and verifier must share. Also provides the compact `body.sig` base64url token codec reused by Phase 4 offline entitlements and referral invites (tested to fit in ≤3 SMS segments).
3. **Keys**: base64 DER env keys (`somo-root`); outside production an ephemeral dev keypair is generated at boot. Marketplace creators get countersigned keys in Phase 6.
4. **Storage behind `ObjectStore`** (put/get/exists). Dev + tests use `FsObjectStore` (path-traversal-guarded); the S3/MinIO adapter lands with deploy hardening (Phase 17) behind the same interface — MinIO is already in docker-compose. Uploads are base64 through tRPC for now; presigned S3 uploads when pack sizes demand it.
5. **Paid packs 402** at both the tRPC download and the archive route until Phase 4 entitlements land — the money gate exists from day one, entitlements only widen it.

## Consequences

- Peer-to-peer distribution is safe by construction, which is what makes the Bluetooth referral growth loop shippable.
- Rotating the root key requires re-signing live packs (acceptable at current scale; key-id field already supports multiple keys).
- The signing key never leaves the API service; clients only ever see the public key via `packs.signingKey`.
