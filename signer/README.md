# Isolated ML-DSA-87 relay signer

The relayer signs every relay twice: secp256k1 and ML-DSA-87 (a hybrid `MsgCrossVMCall`, checked by the chain as
`pqc_hybrid_verify = verified`). Until 22 Nov 2026 both keys lived in the API's environment, so one leaked environment
gave both. Now they are split:

| Holds | Where | Key |
| --- | --- | --- |
| secp256k1 relayer key | API project (`pocketdrop-api`) | `RELAYER_SECP_KEY` |
| ML-DSA-87 relayer seed | this project (`pocketdrop-pqsigner`) | `RELAYER_PQC_SEED` |

Neither half alone can send a relay. The API builds the unsigned transaction (body without extension, AuthInfo), asks
this function for the ML-DSA-87 signature over the hybrid sign bytes, attaches it, and adds the secp256k1 signature.

## What this function signs

Only the hybrid sign bytes of a transaction that is exactly one `MsgCrossVMCall`:

- sender is the relayer (`RELAYER_COSMOS`), the signer key is the relayer's (`RELAYER_PUBKEY`), sign mode DIRECT;
- target is one of the two `PocketRouter`s or the v3 `PocketDrop` (`TARGETS` in `backend/src/pqSignerHandler.ts`);
- the payload selector is `relay`, `deployAndRelay`, or v3 `bind` / `claim`;
- no funds, not async, no extensions, no timeout height, memo starts with `pd `;
- one `uqor` fee coin up to 0.6 QOR, gas up to 4,000,000, no fee granter or payer;
- chain `qorechain-diana`; at most `PQ_SIGNER_MAX_PER_HOUR` signatures per instance per hour (default 600).

Requests carry `x-pd-ts` (unix seconds, within 120 s) and `x-pd-mac` = HMAC-SHA256(`PQ_SIGNER_HMAC`, `ts + "." + body`).
`GET /api/pq-sign` returns public facts only (relayer, keccak256 of the PQ public key, policy).

## Environment

| Name | Value |
| --- | --- |
| `RELAYER_PQC_SEED` | the relayer's 32-byte ML-DSA-87 seed (hex) |
| `PQ_SIGNER_HMAC` | shared with the API (`PQ_SIGNER_HMAC` there), 32+ characters |
| `RELAYER_COSMOS` | the relayer's `qor1…` address |
| `RELAYER_PUBKEY` | the relayer's compressed secp256k1 public key (hex, public) |

The API sets `PQ_SIGNER_URL=https://<this deployment>/api/pq-sign` and the same `PQ_SIGNER_HMAC`, and no longer has
`RELAYER_PQC_SEED`.

## Build

`cd backend && node scripts/bundle-pq-signer.mjs` writes `signer/api/pq-sign.mjs` (one ESM file with the SDK inside).
Tests: `backend/test/pqSplit.test.ts` (byte-for-byte parity with the SDK's in-process hybrid signer) and
`backend/test/pqSigner.test.ts` (policy, MAC, budget, end-to-end split signing).

## What is still shared

The HMAC key is in both projects: whoever holds the API environment can ask this function for signatures, but only for
relays the policy allows (the same calls the API makes anyway), and still needs the secp256k1 key to use them. The sponsor
(`/api/sponsor`) keeps its own hybrid keys in the API environment; it only pays small registration fees from a capped float.
