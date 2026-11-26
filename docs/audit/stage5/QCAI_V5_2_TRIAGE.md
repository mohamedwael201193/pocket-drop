# QCAI report on v5.2: triage

| | |
|---|---|
| Report | `QCAIA-1795664336974-576A1865`, created 2026-11-26 03:38:56 UTC (05:38 Cairo). Run from a separate QCAI account. |
| Public page | https://dashboard.qorechain.io/audits/QCAIA-1795664336974-576A1865 (the page title shows "Unknown contract"; the PDF names it "PocketDrop v5.2") |
| Public JSON | https://dashboard.qorechain.io/api/proxy/audits/QCAIA-1795664336974-576A1865 (archived as [`QCAI-stage5-v5.2-api.json`](QCAI-stage5-v5.2-api.json), e-mail field removed) |
| Result | 78/100, risk MEDIUM, 7 findings: High 1, Medium 3, Low 2, Info 1, Critical 0. Quantum readiness: not scored for the EVM setting (expected). Cost 150 QOR (testnet). |
| Source audited | [`PocketDrop-v5.2-flattened.sol`](PocketDrop-v5.2-flattened.sol), 2,168 lines, SHA-256 `ec71d762edfc5343d867a7c674a05ff06b5796ec85c4576f79067f8d2fa81b7d` (= the deployed v5.2 code; it is the plain concatenation of `contracts-v4/src`, checked by `node contracts-v4/script/flatten-v52.mjs --check`). |
| Artifacts | [`QCAI-stage5-v5.2.pdf`](QCAI-stage5-v5.2.pdf), structured record [`qcai-stage5-v5.2.json`](qcai-stage5-v5.2.json) (score, risk and the seven findings verbatim, with the verdict and test names) |
| Evidence tests | [`contracts-v4/test/QcaiV52AuditRegression.t.sol`](../../../contracts-v4/test/QcaiV52AuditRegression.t.sol), 24 tests (3 fuzz at 1,000 runs; also run at 10,000 runs in the CI profile), all pass against the unchanged v5.2 `src/`. |

The report names a file for each finding and no line numbers. Below, every citation gives the line in `contracts-v4/src` and the matching line in the flattened file that was audited (`flat`).

Four of the seven titles are the ones Stage 3 and Stage 4 reported on earlier versions (reentrancy in `_pay`, access control on `finalizeRecovery*`, daily drip overflow, guardian-loop gas) and one more (ERC-1271, info) is a positive note. Each was already answered in v5.2 code, in some cases by a check written for exactly that wording (`PayoutOutsideLock`, the signed finalize authorization, the subtractive drip headroom, the `MAX_GUARDIANS` fail-fast). The report still lists them, and in two cases the finding text asks for something the code already does. The report is not wrong that a guard on `_pay` itself is worth having; it is already there in the form of an assertion. The two findings that are new in this run (unchecked return values, freeze nonce front-running) were checked against the code line by line and do not hold either.

Verdict types: **false positive** (the claim does not hold; a test shows it), **not exploitable** (the observation is true but bounded; a test shows the bound), **informational**, **real** (a defect that can be exploited or that needs a code change). No finding is **real**.

## 1. HIGH: "Potential Reentrancy in Payout Contract" (`src/Payout.sol`)

> The _pay function is called from multiple external functions that are protected by nonReentrant modifiers, but the _pay function itself doesn't have a reentrancy guard. If a malicious contract receives funds through _pay and tries to re-enter the contract before the lock is released, it could potentially cause issues.
> Recommendation: Add a reentrancy guard to the _pay function to ensure it cannot be called recursively

**Verdict: false positive.** The first half is literally true: `_pay` does not take the lock. It does not need to, because it cannot run unless the lock is already held, and that is enforced:
- `Payout.sol:59-69` (flat `:366-376`): `_pay` starts with `if (_lock != _ENTERED) revert PayoutOutsideLock();`. Called from any path that did not enter `nonReentrant`, it reverts before any value moves. So a second guard inside `_pay` would add nothing: the lock it would check is the same variable.
- `Payout.sol:39-44` (flat `:346-351`): the lock modifier. A re-entrant call into any locked function hits `if (_lock != _NOT_ENTERED) revert Reentrancy();`.
- Every caller of `_pay` is `nonReentrant` and has finished its state changes first (checks-effects-interactions): `PocketDrop.bind` `PocketDrop.sol:205` (flat `:1765`) (pays at `PocketDrop.sol:235-236` (flat `:1795-1796`)), `claim` `PocketDrop.sol:259` (flat `:1819`) (pays at `PocketDrop.sol:280` (flat `:1840`)), `cancel` `PocketDrop.sol:285` (flat `:1845`) (pays at `PocketDrop.sol:295` (flat `:1855`)), `refund` `PocketDrop.sol:300` (flat `:1860`) (pays at `PocketDrop.sol:310` (flat `:1870`)); `DropPool.claim` `DropPool.sol:113` (flat `:2084`) (pays at `DropPool.sol:127` (flat `:2098`)) and `close` `DropPool.sol:132` (flat `:2103`) (pays at `DropPool.sol:141` (flat `:2112`)).
- `Payout.sol:48-55` (flat `:355-362`): `withdraw` is `nonReentrant` and zeroes `pending` and `totalPending` before its value call.
- `Payout.sol:72-76` (flat `:379-383`): the push forwards at most `SEND_GAS` = 100,000, copies no return data and never reverts; on failure the amount is credited to `pending` (no value left the contract, so there is nothing to re-enter).
- The vault has its own lock for the same reason: `PocketVault.sol:223-228` (flat `:654-659`), used by `spend` `PocketVault.sol:313-317` (flat `:744-748`), `executeQueued` `PocketVault.sol:335` (flat `:766`), `createDrop` `PocketVault.sol:705` (flat `:1136`), `confirmDrop` `PocketVault.sol:726` (flat `:1157`), `cancelDrop` `PocketVault.sol:738` (flat `:1169`), `createPool` `PocketVault.sol:762` (flat `:1193`) and `closePool` `PocketVault.sol:777` (flat `:1208`).

**Evidence** (all pass on v5.2):
- `test_qcai52_f1_pay_reverts_outside_lock_and_receiver_cannot_reenter_the_locked_path`: `_pay` without the lock reverts `PayoutOutsideLock`; a receiver that re-enters the locked payout path from its own `receive` gets `Reentrancy`, is paid exactly once, and the contract keeps nothing it should have paid out.
- `test_qcai52_f1_vault_spend_receiver_cannot_reenter_spend` and `test_qcai52_f1_vault_executeQueued_receiver_cannot_reenter`: a receiver re-enters `spend` / `executeQueued`; `Reentrancy`, one payment, one nonce used.
- `test_qcai52_f1_claim_receiver_cannot_reenter_and_payout_is_recorded_once`: a recipient re-enters `claim` during its payout; `Reentrancy`, the contract pays exactly the escrow once.
- Earlier suites still pass: `test_v52_payout_only_runs_under_the_lock`, `test_v52_vault_lock_refuses_every_locked_function_while_held`, `test_qcai51_m3_*`, and the invariants `invariant_drop_balance_equals_unpaid_plus_pending`, `invariant_a_link_pays_at_most_once`, `invariant_pool_balance_equals_unclaimed_plus_pending`.

## 2. MEDIUM: "Missing Access Control in Recovery Finalization" (`src/PocketVault.sol`)

> In the finalizeRecovery and finalizeRecoveryUnanimous functions, the access control logic allows the proposed new owner to finalize the recovery, but there's no explicit check that prevents the old owner from finalizing a recovery they're trying to veto. This could lead to privilege escalation if not properly handled.
> Recommendation: Add explicit checks to ensure that the old owner cannot finalize a recovery they've tried to veto

**Verdict: false positive.** The three claims in the text, taken one by one:
1. "The old owner can finalize a recovery they vetoed": no. `PocketVault.sol:470-474` (flat `:901-905`): `vetoRecovery` sets `recoveryAt = 0`. `PocketVault.sol:479-485` (flat `:910-916`): both finalize paths start with a modifier that reverts `NoRecoveryPending` when the pending timestamp is 0. A vetoed proposal cannot be finalized by anyone, with any signature, until guardians propose again (new `recoveryNonce`, new digest).
2. "The old owner can finalize on the unanimous path": no. `PocketVault.sol:564-580` (flat `:995-1011`) calls `_authorizeFinalize(..., ownerAllowed = false)` and the function at `PocketVault.sol:845-868` (flat `:1276-1299`) only accepts the approved new owner or a current guardian there; the old owner falls to `revert NotAuthorized()`. The unanimous path has no veto at all by design (it is the lost-or-stolen-key path), so "a recovery they're trying to veto" does not exist there.
3. "Privilege escalation": no. On the threshold path the current owner IS an accepted authorizer, on purpose (`PocketVault.sol:498-513` (flat `:929-944`) passes `ownerAllowed = true`). That means the owner can sign the completion of a recovery the guardians already approved, after the delay, instead of vetoing it. It cannot change the result: the new owner and key were fixed by the guardians' signatures in `proposeRecovery` (`PocketVault.sol:445-465` (flat `:876-896`)) and are read from storage, not from the finalize arguments. So an owner finalizing equals a guardian finalizing; nobody gets more than what the guardians signed. The one real limit is timing: an owner who wants to stop a threshold recovery must veto before the delay ends and before anyone finalizes. That is the veto window by design (documented in KNOWN_ISSUES section 3), not an access-control gap.

The authorization is an ML-DSA-87 signature over `finalizeDigest` (`PocketVault.sol:588-603` (flat `:1019-1034`)), which binds chain id, vault, `recoveryNonce`, new owner, new key, authorizer and deadline, so it cannot be reused for another proposal or another Pocket.

**Evidence:**
- `test_qcai52_f2_old_owner_cannot_finalize_a_recovery_it_vetoed`: after a veto the old owner's valid finalize signature reverts `NoRecoveryPending`; owner and epoch unchanged.
- `test_qcai52_f2_unanimous_path_never_accepts_the_old_owner`: the old owner's genuine signature reverts `TooEarly` before the delay and `NotAuthorized` after it, also when the old owner submits the transaction itself; the proposal stays pending.
- `testFuzz_qcai52_f2_unrelated_authorizer_is_refused` (1,000 random authorizers and submitters): `NotAuthorized`, nothing changes.
- `test_qcai52_f2_threshold_owner_finalize_only_completes_the_guardian_approved_target`: the honest boundary above. The owner's finalize on the threshold path ends with the guardian-approved owner and key, and the same signature cannot run twice.
- Earlier suites: `test_v52_finalize_unanimous_rejects_the_old_owner_and_accepts_guardian_or_new_owner`, `test_v52_finalize_by_unrelated_account_is_not_authorized`, `test_v52_finalize_authorization_is_bound_to_one_proposal`, `test_qcai51_h1_*`, `testFuzz_unanimous_recovery_is_not_vetoable`. Live on Diana (v5.2): the old owner on the unanimous path is refused (`NotAuthorized`), see [`docs/V5_2.md`](../../V5_2.md).

## 3. MEDIUM: "Potential Overflow in Daily Drip Calculation" (`src/PocketDrop.sol`)

> In PocketDrop.sol, the drip calculation uses unchecked arithmetic operations that could potentially overflow when adding drip values to daily totals. The code checks for overflow conditions but relies on explicit bounds checking rather than safe math operations.
> Recommendation: Use SafeMath or similar library for arithmetic operations to prevent integer overflow

**Verdict: false positive.** The report's own second sentence describes the design: explicit bounds, checked before the addition. SafeMath is not needed on Solidity 0.8.28, where `+` and `-` already revert on overflow, and there is no `unchecked` block anywhere in `contracts-v4/src` (`grep -c unchecked` returns 0 for every file, and for the flattened file). The calculation:
- `PocketDrop.sol:138-141` (flat `:1698-1701`): the constructor refuses a daily cap above `type(uint128).max`, a max drip above the cap, and a max drip above `type(uint96).max`. Every operand of the headroom arithmetic is therefore far below 2^256.
- `PocketDrop.sol:375` (flat `:1935`): `drip > MAX_DRIP` reverts `DripTooHigh`.
- `PocketDrop.sol:383-387` (flat `:1943-1947`): `spent` is read; `if (spent > DAILY_DRIP_CAP) revert`; `headroom = DAILY_DRIP_CAP - spent` (cannot underflow after the previous check); `if (drip > headroom) revert DailyDripCapExceeded()`; only then `used = spent + drip`. So `used <= DAILY_DRIP_CAP` is proven before the sum exists, and checked arithmetic is a second guard.
- `spent` only grows through this function, so it never exceeds the cap.

**Evidence:**
- `test_qcai52_f3_constructor_bounds_cap_to_uint128_and_maxdrip_to_cap`: a cap above uint128, a max drip above the cap and a max drip above uint96 are each refused with `InvalidConfig`; the widest legal configuration deploys.
- `testFuzz_qcai52_f3_exact_sum_up_to_the_cap_and_refusal_above` (1,000 random uint96 triples; the cap is their exact sum): the daily total is the exact uint256 sum, reaches the cap exactly, and one more wei of drip reverts `DailyDripCapExceeded`; never a wrap, never a panic.
- `test_qcai52_f3_allowance_is_per_sender_and_resets_daily`: allowance is per sender and per UTC day.
- Earlier: `testFuzz_qcai51_m2_drip_sum_never_wraps_at_extreme_bounds`, `test_qcai51_m2_cap_is_exact_and_drip_is_bounded`, `test_v52_drip_cap_constructor_bound_and_spent_above_cap_is_refused`, `test_stage3_daily_drip_checked_math_cannot_overflow_at_max_bounds`.

## 4. LOW: "Unchecked Return Values in External Calls" (`src/PocketVault.sol`)

> Several external calls in PocketVault.sol use low-level call syntax without proper return value checking. While some functions do check return values, others don't explicitly validate the success of external calls.
> Recommendation: Ensure all external calls have proper return value validation

**Verdict: false positive.** Checked against the code, not the wording: `PocketVault.sol` contains exactly **one** low-level call, and its result is checked.
- `PocketVault.sol:921-924` (flat `:1352-1355`): `_send` does `(bool ok,) = to.call{value: amount}(""); if (!ok) revert SendFailed();`. It is used by `spend` (`PocketVault.sol:324` (flat `:755`)) and `executeQueued` (`PocketVault.sol:344` (flat `:775`)) only. If the receiver refuses the payment the whole call reverts, so a state change cannot outlive a failed payment.
- The vault's other external calls are high-level interface calls to the drop and pool (`create`, `confirmRecipient`, `cancel`, `close`), at `PocketVault.sol:710` (flat `:1141`), `PocketVault.sol:730` (flat `:1161`), `PocketVault.sol:742` (flat `:1173`), `PocketVault.sol:768` (flat `:1199`), `PocketVault.sol:781` (flat `:1212`). A failed high-level call reverts and bubbles up; there is no return value to ignore.
- The other low-level calls in the code base are not in `PocketVault.sol` and all handle failure: the payout push in `Payout.sol:72-76` (flat `:379-383`) turns a failed push into a pull balance on purpose (`PayoutDeferred`); `PqcLib.verify` and `keyStatus` use `staticcall` and return false / an empty status unless the call succeeded and the data has exactly the expected shape (`PqcLib.sol:46-48` and `:60-62`); `PqGuard.isPqApproved` returns false on a failed or malformed `staticcall` (`PqGuard.sol:41-42`); the router's `_call` reverts with the target's own revert data (`PocketRouter.sol:76-83`).

**Evidence:**
- `test_qcai52_f4_failed_send_reverts_spend_and_changes_nothing`: a receiver that rejects QOR makes `spend` revert `SendFailed`; balance, nonce and spent-today are unchanged, and the same signed intent works once the receiver accepts.
- `test_qcai52_f4_failed_send_keeps_the_queued_spend_pending`: a failing `executeQueued` rolls back, the entry stays `Pending`, and it executes later.
- `test_qcai52_f4_refused_payout_is_deferred_not_lost`, `test_qcai52_f4_return_bomb_receiver_does_not_affect_the_claim`, `test_qcai52_f4_gas_burning_receiver_is_deferred`: on the drop side a refusing, return-bombing or gas-burning receiver never blocks a claim and never loses value.
- Earlier: `PrecompileConformance.t.sol`, `test_hostile_contract_accounts_are_false_not_reverts` (PqGuard), `test_gas_burning_pocket_cannot_block_claim`.

## 5. MEDIUM: "Potential Front-Running in Guardian Freeze" (`src/PocketVault.sol`)

> The guardian freeze functionality allows freezing based on a nonce that can be predicted. If an attacker knows the current freezeNonce, they could potentially front-run freeze proposals to disrupt legitimate guardian actions.
> Recommendation: Implement additional randomness or time-based elements to prevent predictable nonce usage

**Verdict: false positive.** The nonce is a replay counter, not a secret, and nothing depends on it being unpredictable. `PocketVault.sol:633-650` (flat `:1064-1081`):
- A freeze needs `threshold` guardians' ML-DSA-87 signatures over `freezeDigest(nonce, deadline)` (`PocketVault.sol:657-659` (flat `:1088-1090`)), which binds chain id, vault, nonce and deadline. An attacker who knows `freezeNonce` (`PocketVault.sol:151` (flat `:582`)) but not the guardians' keys cannot produce a valid signature: `BadSignature`.
- Front-running a *legitimate* freeze: anyone can submit guardian signatures they have seen (the relayer does, so a relayer outage does not stop guardians; KNOWN_ISSUES section 3). A front-runner can only deliver the freeze the guardians signed: the signers, nonce and deadline are in the signed digest, and the effect (`frozenUntil`, nonce + 1) does not depend on who submits. The guardians' own copy then reverts `BadNonce` (`PocketVault.sol:638` (flat `:1069`)) because the goal is already reached, and the spent signatures are dead afterwards, also after the freeze expires. No funds or ownership change.
- A wrong nonce reverts `BadNonce` before any signature work, so an attacker cannot skip or burn nonces: `freezeNonce` moves only on a valid, guardian-signed freeze (`PocketVault.sol:645-648` (flat `:1076-1079`)).
- Randomness or time elements in the nonce would not add security. The authority is the signatures; a random nonce would make guardians' off-line signing harder (they sign for a known next nonce) and would still be public after the first transaction.
- Honest residual: guardians can freeze the Pocket (denial of service by colluding guardians) and that is bounded by `MAX_FREEZE_STREAK`; this is documented in KNOWN_ISSUES section 3 and is not about the nonce.

**Evidence:**
- `test_qcai52_f5_attacker_who_knows_the_nonce_cannot_freeze`: junk signatures at the right nonce: `BadSignature`, no freeze, nonce unchanged.
- `test_qcai52_f5_front_running_the_signed_freeze_only_delivers_the_intended_freeze`: a third party submits the guardians' signatures; the result is the intended freeze (same end time, nonce 1, balance and owner unchanged); the guardians' own submission reverts `BadNonce`; after the freeze ends the old signatures still revert `BadNonce`.
- `testFuzz_qcai52_f5_wrong_nonce_is_refused_and_changes_nothing` (1,000 random nonces): `BadNonce`, no state change.
- `test_qcai52_f5_freeze_signature_is_bound_to_nonce_and_pocket`: the next nonce's signature, another Pocket's signature, or another deadline does not validate.
- Earlier: `test_freeze_signatures_cannot_be_replayed_and_cannot_stack_while_frozen`, `test_freeze_bad_inputs`, `test_freeze_streak_caps_back_to_back_renewals`.

## 6. LOW: "Potential Gas Limit Issues in Guardian Validation" (`src/PocketVault.sol`)

> The _checkGuardianSigs function performs linear scans through guardian arrays with a maximum of 5 elements, but in worst-case scenarios, this could approach gas limits for large arrays or complex validations.
> Recommendation: Consider implementing more efficient lookup mechanisms or limiting guardian set sizes further

**Verdict: not exploitable.** The finding itself states the bound (a maximum of 5) and then asks for it to be 'limited further'. The bound is enforced in three places:
- `PocketVault.sol:66` (flat `:497`): `MAX_GUARDIANS = 5`. `PocketVault.sol:952-967` (flat `:1383-1398`): `_validateGuardians` (called by `initialize` and `setGuardians`) rejects a set above 5 (and a set of exactly 1) with `InvalidConfig`, so a larger set cannot exist.
- `PocketVault.sol:891-901` (flat `:1322-1332`): `_checkGuardianSigs` reverts `NotGuardian` at once when more than 5 signers are passed (`PocketVault.sol:893` (flat `:1324`)), before any signature work; duplicates are caught with a bitmap, not a nested scan. Each signer costs one index lookup of at most 5 steps (`PocketVault.sol:944-949` (flat `:1375-1380`)) plus one precompile call.
- Shorter sets are cheaper; the largest check is 5 signers.

The cost that matters is the 5 ML-DSA-87 precompile calls and their 4,627-byte signatures in calldata, not the loops. It is measured: 5-of-5 `proposeRecoveryUnanimous` uses about 1.50M gas with the mock verifier (about 1.27M for a 5-of-5 freeze in the Stage 4 test), well below a block's limit. Further limiting the set to fewer than 5 guardians would be a product decision, not a security fix.

**Evidence:**
- `test_qcai52_f6_six_signers_revert_before_any_signature_work`: six signers revert `NotGuardian` using under 100,000 gas.
- `test_qcai52_f6_guardian_set_is_capped_at_deploy`: six guardians revert `InvalidConfig` at deployment.
- `test_qcai52_f6_five_of_five_unanimous_check_gas_is_bounded`: a duplicate signer in a 5-set reverts `DuplicateSigner`; the full 5-of-5 call stays under 2M gas.
- Earlier: `test_qcai51_l4_*`, `test_stage3_six_signers_always_revert_in_checkGuardianSigs`.

## 7. INFO: "ERC-1271 Implementation" (`src/PocketVault.sol`)

**Verdict: informational (positive).** The report confirms `PocketVault.sol:289-294` (flat `:720-725`) (`isValidSignature`) and `PocketVault.sol:299-301` (flat `:730-732`) (`erc1271Digest`). The approval is the owner's ML-DSA-87 signature over a tagged digest bound to this Pocket and the chain id, so it cannot double as an owner intent or be reused for another Pocket.

**Evidence:** `test_qcai52_f7_erc1271_accepts_only_the_owners_bound_approval` (owner's approval returns `0x1626ba7e`; another key, another hash, another Pocket's approval, an untagged one, another chain's, and an empty signature all return `0xffffffff` without reverting). Earlier: `test_erc1271`, `test_v51_real_erc1271_is_domain_separated_from_intents` (real crypto).

## Result

No real vulnerability. Of the seven findings: five are false positives (1 reentrancy, 2 access control, 3 drip overflow, 4 unchecked calls, 5 freeze front-running), one is a bounded observation (6, guardian loop gas) and one is informational (7, ERC-1271). Each has tests that run against the deployed v5.2 code, which is unchanged: no contract was edited or redeployed for this triage.

Three runs, three scores on the code that existed at the time: Stage 3 (v5) 85, Stage 4 (v5.1) 82, Stage 5 (v5.2) 78. The score went down while the code got stricter, and the same titles come back after the checks they ask for were written. The report text is generated per run (its line numbers and wording differ between runs), and the QoreChain FAQ states that the audit score is not fed into judging automatically; jurors read the reports with the team's explanations. This file is that explanation.
