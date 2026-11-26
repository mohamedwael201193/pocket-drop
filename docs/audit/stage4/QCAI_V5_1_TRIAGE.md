# QCAI report on v5.1: triage

| | |
|---|---|
| Report | `QCAIA-1795655356279-BA1C1020`, created 2026-11-26 01:09:16 UTC (03:09 Cairo) |
| Public page | https://dashboard.qorechain.io/audits/QCAIA-1795655356279-BA1C1020 |
| Public JSON | https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795655356279-BA1C1020 (archived as [`QCAI-stage4-v5.1-api.json`](QCAI-stage4-v5.1-api.json), masked e-mail field removed) |
| Result | 82/100, risk HIGH. Critical 0, High 1, Medium 2, Low 1, Info 1. Quantum readiness: not scored for the EVM setting. Cost 150 QOR (testnet). |
| Source audited | [`PocketDrop-v5.1-flattened.sol`](PocketDrop-v5.1-flattened.sol), 1,944 lines, SHA-256 `22faf22b3aa59124a3cc19fa77f8dcc9d65e924a98ea147918deee02cdd61b8a` (= the deployed v5.1 code, checked by `node contracts-v4/script/flatten-v51.mjs --check`) |
| Artifacts | [`QCAI-stage4-v5.1.pdf`](QCAI-stage4-v5.1.pdf), [`QCAI-stage4-v5.1-summary.png`](QCAI-stage4-v5.1-summary.png), [`QCAI-stage4-v5.1-full.png`](QCAI-stage4-v5.1-full.png), structured record [`qcai-stage4-v5.1.json`](qcai-stage4-v5.1.json) |
| Evidence tests | [`contracts-v4/test/QcaiV51AuditRegression.t.sol`](../../../contracts-v4/test/QcaiV51AuditRegression.t.sol), 11 tests (3 fuzz at 1,000 runs), all pass against the unchanged v5.1 `src/` |

The same five titles appeared in Stage 1, 2 and 3 (78 to 85), although the code under them changed between runs. The report's line numbers do not point at the code they describe: in the flattened file, line 790 is `_checkNewOwner(...)` inside `proposeRecoveryUnanimous`, line 822 is a NatSpec line, line 410 is `contract PocketVault is IERC1271 {`, line 54 is a PqcLib comment and line 640 is a section banner. The functions themselves are at lines 826 / 880 (`finalizeRecovery*`), 1723 (drip check), 314 (`_pay`) and 1139 (`_checkGuardianSigs`).

Verdict types: **false positive** (the claim does not hold; a test shows it), **not exploitable** (the observation is true but bounded; a test shows the bound), **informational**.

## 1. HIGH, ETH-001: "Missing Access Control on Critical Functions" (finalizeRecovery, finalizeRecoveryUnanimous)

**Claim.** Anyone can call the two finalize functions, so "any attacker can take control of a Pocket".

**Verdict: false positive.** The callers are permissionless on purpose, but the caller chooses nothing:
- Who the new owner is was fixed in `proposeRecovery` / `proposeRecoveryUnanimous`, which need `threshold` (or all) distinct guardians' ML-DSA-87 signatures over a digest that binds the Pocket, the chain id, `recoveryNonce`, the deadline, `newOwner` and `newKeyHash`.
- `finalize*` takes no arguments. Its modifier (`onlyApprovedThresholdRecovery` / `onlyApprovedUnanimousRecovery`) requires a pending proposal and an elapsed timelock, and re-checks that the approved key is still registered and proven.
- The current owner key can veto a threshold recovery during the delay. The unanimous path cannot be vetoed by design (it is the lost-or-stolen-key path) and freezes the Pocket while pending.
- Finalize moves no value. It bumps `epoch` (kills queued spends of the old key) and clears pending changes.

Restricting the caller would not add security (the authority is the guardians' signatures, not `msg.sender`), and the relayer submits every transaction in this design. An attacker who calls finalize at the right time only completes what the guardians signed.

**Evidence** (all pass on v5.1):
- `test_qcai51_h1_attacker_cannot_propose_itself_with_guardian_sigs`: guardian signatures for OB do not approve the attacker; `BadSignature`, nothing changes.
- `test_qcai51_h1_third_party_finalize_reverts_without_pending_before_timelock_and_after_veto`: `NoRecoveryPending` with nothing pending, `TooEarly` one second before the timelock, `NoRecoveryPending` after the owner's veto; owner and epoch unchanged.
- `testFuzz_qcai51_h1_finalize_outcome_is_independent_of_caller` (1,000 random callers): owner = OB, key = OB's key, epoch 1, Pocket balance unchanged, caller balance unchanged.
- `testFuzz_qcai51_h1_unanimous_finalize_outcome_is_independent_of_caller` (1,000 random callers): same for the unanimous path, including `NoRecoveryPending` and `TooEarly` for each caller.
- `test_qcai51_h1_finalize_rechecks_the_approved_key`: if the approved key loses its proof of possession, finalize reverts and the owner stays.
- Existing: `test_stage3_random_caller_cannot_finalize_*`, `test_old_guardian_signatures_cannot_be_replayed_after_veto`, `test_finalize_fails_closed_if_new_key_disappears`, `test_finalized_recovery_kills_queued_spends_and_pending_changes`, `testFuzz_unanimous_recovery_is_not_vetoable`. Live on Diana: `test/live/run.mjs` "ATTACK finalize a vetoed recovery" and "ATTACK finalize before the recovery delay" both revert.

## 2. MEDIUM, ETH-002: "Potential Overflow in Daily Drip Calculation" (`spent + drip <= DAILY_DRIP_CAP`)

**Claim.** The sum can overflow; there is no explicit validation of `spent` and `drip`.

**Verdict: false positive.** The quoted expression is a comment. The code is a subtractive headroom check that is evaluated before any addition:
`if (spent > DAILY_DRIP_CAP || uint256(drip) > DAILY_DRIP_CAP - spent) revert DailyDripCapExceeded();` then `used = spent + drip`. So `used <= DAILY_DRIP_CAP` is proven before the sum exists, and Solidity 0.8.28 checked math is a second guard. `drip` is a `uint96` and is also bounded by `MAX_DRIP`; the constructor enforces `MAX_DRIP <= DAILY_DRIP_CAP` and `MAX_DRIP <= type(uint96).max`.

**Evidence:**
- `testFuzz_qcai51_m2_drip_sum_never_wraps_at_extreme_bounds` (1,000 runs, every limit = `type(uint96).max`): two drips either fit and are recorded exactly, or revert `DailyDripCapExceeded`; never a wrap, never a panic; `dripUsedToday <= DAILY_DRIP_CAP` always.
- `test_qcai51_m2_cap_is_exact_and_drip_is_bounded`: on the production parameters the cap can be reached exactly (10 QOR), one more wei reverts, a drip of `MAX_DRIP + 1` reverts `DripTooHigh`.
- Existing: `test_daily_drip_cap`, `test_stage3_daily_drip_checked_math_cannot_overflow_at_max_bounds`.

## 3. MEDIUM, ETH-003: "Reentrancy Vulnerability in Payout Contract" (`_pay`)

**Claim.** `_pay` uses a raw call; the pull-balance fallback "doesn't fully protect against reentrancy".

**Verdict: false positive.** Every external function that reaches `_pay` (`PocketDrop.create/bind/confirmRecipient/claim/cancel/refund`, `DropPool.create/claim/close`) carries `nonReentrant` from `Payout`, and finishes its state changes before paying (checks-effects-interactions). `withdraw` is `nonReentrant` and zeroes `pending` and `totalPending` before the value call. The raw call forwards at most 100,000 gas, copies no return data and cannot revert the caller; on failure the amount is credited to `pending` (no value leaves, so there is nothing to re-enter).

**Evidence:**
- `test_qcai51_m3_reentry_into_every_entry_point_is_refused`: a receiver re-enters `withdraw`, `claim`, `refund`, `cancel` and `confirmRecipient` during its payout; each re-entry fails with `Reentrancy`; the claim completes once; the receiver gets exactly 1 QOR and the contract loses exactly 1 QOR; `totalPending` stays 0.
- `test_qcai51_m3_deferred_balance_is_paid_exactly_once`: a reverting receiver is deferred to `pending`; later its `withdraw` re-enters `withdraw` and is refused; it is paid exactly once; `pending` and `totalPending` go to 0; a second withdraw reverts `NothingToWithdraw`.
- Existing: `test_reentrant_pocket_is_blocked_by_the_lock`, `test_reverting_pocket_defers_payout_and_withdraw_works_later`, `test_gas_burning_pocket_cannot_block_claim`, `test_reverting_pocket_defers_pool_payout`, and the invariants `invariant_drop_balance_equals_unpaid_plus_pending`, `invariant_a_link_pays_at_most_once` and `invariant_pool_balance_equals_unclaimed_plus_pending` in `V4.invariant.t.sol`.

## 4. LOW, ETH-004: "Potential Gas Limit Exceeded in Guardian Validation" (`_checkGuardianSigs`)

**Claim.** Nested loops could exceed the gas limit with large guardian sets.

**Verdict: not exploitable.** Guardian sets are capped at `MAX_GUARDIANS = 5` in `_validateGuardians`, which both `initialize` and `setGuardians` call. `_checkGuardianSigs` reverts up front when more than 5 signers are passed, and both loops are also bounded by `MAX_GUARDIANS`. The duplicate scan is at most 10 comparisons.

**Evidence:**
- `test_qcai51_l4_six_guardians_rejected_at_deploy`: a 6-guardian config reverts `InvalidConfig` at deployment.
- `test_qcai51_l4_worst_case_five_signer_check_is_bounded`: 5 of 5 guardians freeze; the whole `guardianFreeze` call uses 1,272,354 gas with the mock verifier (most of it is calldata for five 4,627-byte ML-DSA-87 signatures), far below the 100M test gas limit and Diana's block limit.
- Existing: `test_stage3_six_signers_always_revert_in_checkGuardianSigs`, the `setGuardians` validation tests in `PocketVault.t.sol`.

## 5. INFO, ETH-005: "ERC-1271 Implementation"

**Verdict: informational (positive).** The report confirms ERC-1271 is implemented correctly. Since v5.1 the approval is tagged and bound to the Pocket and chain (`test_v51_real_erc1271_is_domain_separated_from_intents` in the real-crypto suite).

## Result

No real vulnerability. Every finding is either a false positive or a bounded observation, and each has a test that runs against the deployed v5.1 code. The deployed v5.1 contracts stay as they are.

A v5.2 source (branch `v5.2-audit-hardening`, not deployed) makes the same guarantees explicit in the code (signed finalize authorization for owner, guardian or the approved new owner; explicit drip bounds; Payout lock assertion; bitmap duplicate check). See [`V5_2_CHANGES.md`](V5_2_CHANGES.md) on that branch.
