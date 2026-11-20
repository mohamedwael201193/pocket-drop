# Pocket Drop v4 - QCAI audit

Two-stage QoreChain AI (QCAI) audit of the v4 contracts: Stage 1 (score 82) and Stage 2 (score 78, after a comment-only change).

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

### Change between the stages

One comment-only change to `contracts-v4/src/PocketVault.sol` (4 NatSpec lines above `_checkGuardianSigs`, commit `9c03147`) documenting the ETH-004 bound: `_guardians.length <= MAX_GUARDIANS` (5), enforced by `_validateGuardians` on both `initialize` and `setGuardians`, and a call with more than 5 signers reverts at the latest on the sixth entry (`NotGuardian` / `DuplicateSigner`). No logic change.

Bytecode check (`forge build --force`, solc 0.8.28, optimizer 200, `bytecode_hash = "none"`, `cbor_metadata = false`): the `deployedBytecode` of PocketVault, PocketFactory, PocketRouter, PocketDrop and DropPool is **byte-for-byte identical** before and after the comment, including the tail. Because the project is built without CBOR metadata, there is not even a metadata hash that changes; the deployed v4 contracts are therefore still valid for the Stage 2 source. (Had CBOR metadata been on, only the trailing metadata hash would differ.)

### Stage 2 run

| Item | Value |
|---|---|
| Audit ID | `QCAIA-1795138339351-F6A93427` |
| Public report | https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795138339351-F6A93427 |
| Created (UTC) | 2026-11-20T01:32:19Z |
| Source audited | `docs/audit/stage2/PocketDrop-v4-flattened.sol` (1605 lines, 70,505 bytes), same flattening as Stage 1 (the only diff to Stage 1 is the 4 comment lines) |
| SHA-256 (source) | `c4b19a8d00879b64417aece0d7dd65a20e1398285c4fbf895f19e78cdfe1b0cf` |
| SHA-256 (JSON) | `a1d587ebb749c6cd8601b47bbcf63f6cf4f5709e0b72f6168c114ba2eb30bbc7` |
| Blockchain setting | Ethereum (EVM/Solidity), same as Stage 1 |
| Score / risk | **78 / MEDIUM** (Stage 1: 82 / MEDIUM). The score went down by 4. |
| Findings | 5 (1 high, 2 medium, 1 low, 1 info), same counts as Stage 1 |
| Quantum readiness | Not scored (expected on EVM, see above) |
| Cost shown | 150 QOR (testnet), confirmed once |
| Reports | `docs/audit/stage2/QCAI-stage2-2026-11-20.json`, `docs/audit/stage2/QCAI-stage2-2026-11-20.pdf` |

The PDF was generated locally from the official JSON (the dashboard "Export PDF" was not used, as in Stage 1); a note on the first page says so and the content is unchanged.

Charge evidence: the confirm dialog showed 150 QOR and no wallet prompt appeared. The EVM balance of the paying address (`0x8ab5...bBDd`, `eth_getBalance` on evm-testnet.qore.host) read 405.825 QOR immediately before the run and 405.825 QOR after, so the charge is not visible as an on-chain balance change at that address (the dashboard may bill a separate account or ledger). The report was created and is listed in the dashboard under "My audits".

The score fell although the only change is a comment. The auditor is a model and its output varies between runs on near-identical input; the drop reflects that, not a code regression. Both scores are reported as they came.

Local test and coverage results on the Stage 2 source: `forge test` 167 passed, 0 failed, 0 skipped (14 suites). `forge coverage --report summary`: 100.00% lines, statements, branches and functions on every file under `src/` (PocketVault 258/258 lines, 324/324 statements, 60/60 branches, 42/42 functions; the "Total" row of 98.95% lines includes `test/` and `script/` files).

### Stage 1 findings vs Stage 2

| Stage 1 | Stage 2 | Status |
|---|---|---|
| ETH-001 HIGH, recovery finalize has no access control | ETH-001 HIGH, same claim | Still reported. **False positive**, unchanged triage (see Triage above). |
| ETH-002 MEDIUM, `_dripSpent + drip` overflow | ETH-002 MEDIUM, same claim | Still reported. **False positive**: checked arithmetic, `drip <= MAX_DRIP`, sum bounded by `DAILY_DRIP_CAP`. |
| ETH-003 MEDIUM, `PocketVault._send` return value | ETH-003 MEDIUM, now about `Payout._pay` raw call | Still reported, different target. **False positive**, see below. |
| ETH-004 LOW, guardian loop | ETH-004 LOW, same claim | Still reported even with the comment in the audited source. **Real, already bounded**; comment added as planned. Not resolved from the auditor's point of view. |
| ETH-005 INFO, ERC-1271 not fully compliant | ETH-005 INFO, now "missing ERC-165" | Claim changed. **Not a defect**, see below. |

New findings: none by count or severity. Two Stage 2 entries have a different subject than their Stage 1 namesakes (ETH-003, ETH-005), so they are triaged as new claims:

| ID | Claim | Verdict | Reasoning and tests |
|---|---|---|---|
| ETH-003 (S2) | `Payout._pay` uses a raw call without checking return values, reentrancy | **False positive** | The return value is checked: `_pay` tests `_rawSend` and, on failure, credits `pending[to]` and emits `PayoutDeferred` (pull payment) instead of reverting. The call is gas-capped (`SEND_GAS` = 100,000), copies no return data, and callers finish all state updates first and hold the `nonReentrant` lock in `Payout`. Tests: `test_reverting_pocket_defers_payout_and_withdraw_works_later` and `test_gas_burning_pocket_cannot_block_claim` and `test_hostile_sender_cancel_is_deferred` (test/PocketDrop.t.sol), `test_reverting_pocket_defers_pool_payout` (test/DropPool.t.sol), `test_reentrant_pocket_is_blocked_by_the_lock` (test/PocketDrop.t.sol). |
| ETH-005 (S2) | PocketVault implements ERC-1271 but not ERC-165 | **False positive / not required** | ERC-1271 does not require ERC-165, and nothing in `src/` calls `supportsInterface` on a Pocket. ERC-1271 behaviour is covered by `test_erc1271` (test/PocketVault.t.sol). No code change; adding ERC-165 would change bytecode for no security benefit. |

Other notes on the Stage 2 report: the cited line numbers do not match the audited file (for example flattened line 675 is a NatSpec line of the owner-veto function, not `finalizeRecovery`), the report cites `src/` paths rather than the flattened file, and its gas suggestions (a mapping for the 5-entry guardian list, assembly address compares) are not adopted because they would change audited, deployed code for negligible gain. Outcome: no new real issue, ETH-004 remains the only real one and stays bounded by `MAX_GUARDIANS = 5`.
