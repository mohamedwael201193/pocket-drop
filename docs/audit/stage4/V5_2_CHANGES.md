# v5.2 changes (branch `v5.2-audit-hardening`, not deployed)

v5.1 (deployed on Diana, QCAI stage 4: 82 / HIGH, 0 critical) has no confirmed vulnerability; see
[`QCAI_V5_1_TRIAGE.md`](QCAI_V5_1_TRIAGE.md). v5.2 makes the guarantees behind each false positive explicit in the
code. The security model stays the same: every change adds a check, none removes one.

Status: source and tests only. No v5.2 contract is deployed, the live app still uses v5.1, and no audit has run on v5.2.

## Flattened source for the next audit

| File | Lines | sha256 |
| --- | --- | --- |
| [`../stage5/PocketDrop-v5.2-flattened.sol`](../stage5/PocketDrop-v5.2-flattened.sol) | 2168 | `ec71d762edfc5343d867a7c674a05ff06b5796ec85c4576f79067f8d2fa81b7d` |

`contracts-v4/script/flatten-v52.mjs` rebuilds it, checks that it is the plain concatenation of `src/`, compiles it alone
(solc 0.8.28, cancun, optimizer 200) and checks that each contract's runtime bytecode equals the repo build. After a
deploy it also compares against the chain.

## Changes per finding

| Finding (stage 4) | v5.1 verdict | v5.2 change | Tests |
| --- | --- | --- | --- |
| H1 finalize callable by anyone | false positive (no arguments; target fixed by guardians; timelock and veto apply) | `finalizeRecovery(authorizer, deadline, sig)` and `finalizeRecoveryUnanimous(authorizer, deadline, sig)`. The authorizer must be the owner, a guardian or the approved new owner (unanimous path: guardian or new owner, never the old owner) and must sign `finalizeDigest(...)` with ML-DSA-87. The digest binds chain id, vault, recovery nonce, new owner, new key hash, authorizer and deadline. Event `RecoveryFinalizeAuthorized`. Error `NotAuthorized`. A relayer can still submit the call; it cannot authorize one. | `V52Hardening.t.sol` (finalize group), `RealCrypto.t.sol` `test_v52_real_*` |
| M2 drip sum overflow | false positive (quoted text was a comment) | `PocketDrop` checks `spent > cap`, computes `headroom = cap - spent`, then `drip > headroom`. Constructor rejects `dailyDripCap > type(uint128).max`. | `test_v52_drip_*` |
| M3 Payout reentrancy | false positive (every entry point locked, CEI) | `_pay` reverts `PayoutOutsideLock` unless the lock is held; named lock states; `PayoutSent` event; `_rawSend` private. The vault gains its own lock (`nonReentrant` on spend, executeQueued, createDrop, confirmDrop, cancelDrop, createPool, closePool; `receive` stays open for refunds). Vault events now precede outgoing calls. | `test_v52_payout_*`, `test_v52_vault_lock_*`, `test_v52_vault_spend_receiver_cannot_reenter` |
| L4 unbounded guardian loop | not exploitable (MAX_GUARDIANS = 5, fail fast) | Duplicate check by bitmap over the guardian index; every guardian loop bounded by `MAX_GUARDIANS`. | `test_qcai51_l4_*` |
| General | - | Drop and pool targets must be contracts (`_requireTarget`). Zero checks: vault `initialize` owner, factory implementation, router constructor (`ZeroAddress`). Custom errors only. NatSpec on every external function, constructor parameter and public state variable (checked by a script: 0 gaps). | `test_v52_vault_drop_and_pool_targets_must_be_contracts`, `test_v52_router_*` |

## Tests on the branch (LIVE runs on 26 Nov 2026)

| Profile | Result |
| --- | --- |
| default (`forge test`) | 217 / 217 passed (205 on main + 12 new) |
| realcrypto (real ML-DSA-87 via ffi) | 26 / 26 passed |
| live (Diana precompiles via eth_call) | 31 / 31 passed |
| ci (10,000 fuzz runs) | 217 / 217 passed |
| coverage (src) | 100% lines, statements, branches, functions |
| `export-abi --check` | 5 / 5 ABIs current |
| backend vitest | 220 passed, 9 skipped |

## Blast radius of a v5.2 deploy

- Every contract gets a new address: the vault implementation changes, so the factory, router, PocketDrop and DropPool
  must be redeployed (prod and lab sets). v5.1 contracts and their links keep working; existing v5.1 Pockets stay v5.1.
- Estimated cost (RECORDED, `deploy-v52.mjs --estimate`, 26 Nov 2026 03:45 Cairo): 18,875,042 gas, about 2.76 QOR
  (3.31 QOR with a 20% margin) for prod plus lab plus the shared counter, plus 0.1 QOR if a new relayer window is needed.
  A re-audit costs 150 QOR.
- Rewiring needed after a deploy:
  - `frontend/src/lib/actions.ts`: `finalizeRecovery` must sign the finalize authorization (owner, guardian or new owner key) before relaying.
  - `frontend/src/lib/abi4.ts`: regenerate from `contracts-v4/abi`.
  - `backend/src/qday.ts`: finalize ABI strings take `(address,uint256,bytes)`.
  - `contracts-v4/test/live/run.mjs`, `run-freeze.mjs`: pass the authorization.
  - `frontend/scripts/sync-v4.mjs`, `frontend/src/data/v4.json`, Vercel env: new addresses.
  - Relayer window targets: the new routers.
  - Explorer verification and the flattened-vs-chain check in `flatten-v52.mjs`.
