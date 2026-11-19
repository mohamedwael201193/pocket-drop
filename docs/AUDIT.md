# Pocket Drop v4 - QCAI audit

Two-stage QoreChain AI (QCAI) audit of the v4 contracts. This file covers **Stage 1**. Stage 2 is added after the Stage 1 follow-ups.

## Stage 1 run

| Item | Value |
|---|---|
| Audit ID | `QCAIA-1795130931306-3D8DAA40` |
| Public report | https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795130931306-3D8DAA40 |
| Run date (UTC) | 2026-11-19 (23:28) |
| Code | repo HEAD `ca9a5e7`, `contracts-v4/src/*.sol` |
| Source audited | `docs/audit/stage1/PocketDrop-v4-flattened.sol` (1601 lines, 70,031 bytes) |
| SHA-256 | `a4fdacc97a798149c6ce0b15e46b9944c94fb5ecb11ab68d235440692ad32cd4` |
| Blockchain setting | Ethereum (EVM/Solidity), to be reused unchanged in Stage 2 |
| Score / risk | 82 / MEDIUM |
| Quantum readiness | Not scored (expected on EVM, see below) |
| Cost shown by the dashboard | 150 QOR (testnet) |
| Reports | `docs/audit/stage1/QCAI-stage1-2026-11-19.pdf`, `docs/audit/stage1/QCAI-stage1-2026-11-19.json` |

The flattened file is the concatenation of IPocket (interfaces), PqcLib, Payout, PqGuard, PocketVault, PocketFactory, PocketRouter, PocketDrop and DropPool, with imports, repeated pragmas and SPDX lines removed. It compiles with `forge build` (solc 0.8.28, cancun). Finding locations below are line numbers in the flattened file.

The PDF was rendered from the public JSON report. The dashboard "Export PDF" button produced no download in the automated browser.

## Triage

| ID | Severity | Location | Claim | Verdict | Resolution |
|---|---|---|---|---|---|
| ETH-001 | HIGH | PocketVault `finalizeRecovery`, `finalizeRecoveryUnanimous` | Anyone can finalize recovery | **False positive** | Permissionless finalize is deliberate and says so in the NatSpec ("Anyone may call"). The caller chooses nothing: finalize only applies a proposal that was already authorised (threshold guardian signatures, or all guardians), only after the delay, and only if the new key still passes `PqcLib.requireKey`. The owner can veto a threshold proposal. Tests: `test_finalized_recovery_kills_queued_spends_and_pending_changes`, `test_finalize_fails_closed_if_new_key_disappears`, `test_threshold_recovery_stays_vetoable_by_the_owner`, `test_unanimous_finalize_kills_queue_and_pending_changes`, `testFuzz_unanimous_recovery_is_not_vetoable`. |
| ETH-002 | MEDIUM | PocketDrop `_validateCreate` (daily drip sum) | Unchecked overflow in `_dripSpent + drip` | **False positive** | Solidity 0.8.28 checked arithmetic reverts on overflow, and `drip` is capped by `MAX_DRIP` (<= uint96) before the sum, with the result bounded by `DAILY_DRIP_CAP`. No `unchecked` block is involved. Tests: `test_daily_drip_cap`, `testFuzz_drop_create_accounting`. |
| ETH-003 | MEDIUM | PocketVault `_send` | Return value of call not checked, reentrancy | **False positive** | `_send` reverts with `SendFailed` when the call fails. Every caller updates state (nonce, daily spend, queue state) before the call, so a reentrant call finds the nonce consumed and the allowance debited. PocketDrop, which holds escrow, uses a `nonReentrant` lock. Tests: `test_spend_to_self_and_send_failure`, `test_reentrant_pocket_is_blocked_by_the_lock`. |
| ETH-004 | LOW | PocketVault `_checkGuardianSigs` (nested loop) | Unbounded guardian loop, gas DoS | **Real, already bounded** | The loop is bounded by `MAX_GUARDIANS = 5` enforced in `_validateGuardians`, so the worst case is a handful of iterations. No code change. Tests: `test_max_five_guardians_accepted`, `test_bad_guardian_configs_revert`. Planned action: add a one-line comment at the loop pointing to the cap (documentation only, no logic change). |
| ETH-005 | INFO | PocketVault `isValidSignature` | ERC-1271 not fully compliant | **False positive** | The function returns the magic value `0x1626ba7e` for a valid ML-DSA-87 signature over the QoreX-prefixed message and `0xffffffff` otherwise, as the standard requires. The report names no concrete deviation. Test: `test_erc1271`. |

Counts: 5 findings (1 high, 2 medium, 1 low, 1 info). No code change was required by Stage 1. The planned action for ETH-004 is a comment only.

## Post-quantum design (why "Quantum readiness" is "Not scored")

The QCAI quantum-readiness score is only computed for QoreChain-native contracts, so it shows "Not scored" for an EVM-setting audit. This is expected and does not mean the contracts lack PQC.

- Every Pocket owner action is authorised by an ML-DSA-87 (FIPS 204) signature, verified through the chain's `pqcVerify` precompile (`PqcLib`). The signed message uses the QoreX prefix and binds chain id, vault address, action, nonce and deadline.
- Keys are registered on chain with a proof of possession. `PqcLib.requireKey` checks that the registered key exists and matches the pinned hash, and finalize paths fail closed if it does not.
- Guardian recovery (threshold, and unanimous for a lost or stolen key) also uses ML-DSA-87 signatures. Unanimous recovery freezes the Pocket and cannot be vetoed by the old key.
- ERC-1271 `isValidSignature` exposes the same ML-DSA-87 check, so other contracts can accept Pocket signatures.
- There is no ECDSA authority anywhere in the Pocket's spend or recovery path.

All of this runs on the Diana testnet (chain id 9800); the QOR has no monetary value.

## Stage 2

To be added after the follow-ups, using the same blockchain setting (Ethereum, EVM/Solidity) and a new flattened file under `docs/audit/stage2/`.
